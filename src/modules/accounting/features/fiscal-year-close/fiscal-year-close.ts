/**
 * Cierre anual (TSK-760, Fase 9: B1, B4, B18–B21, B24, C4, C7, D12; diseño §3.1.5 y §3.3.9).
 *
 * - Se cierra solo el ejercicio abierto más antiguo, con todos sus meses cerrados (B1) y sin
 *   borradores con fecha en su rango (A5/B4).
 * - La vista previa y el cierre usan el mismo cálculo (`computeClosePreviewTx`): saldos
 *   acumulados al fin del ejercicio, sin filtro de cuenta activa (C4/H5) y sin la apertura
 *   generada por cierres anteriores (B18). Sin resultados → `BusinessError` (B20).
 * - Refundición POSTED en el período CLOSING (D12, el ejercicio todavía abierto); ejercicio
 *   siguiente con `ensureFiscalYearTx` (reutiliza el existente, B24; meses en UTC); apertura
 *   POSTED en su OPENING, calculada después de la refundición y verificada (B21); el OPENING
 *   queda cerrado (C7).
 *
 * Funciones con el cliente transaccional del llamador (sin permisos ni `$transaction`).
 * Sin `'use server'` (H7): no son endpoints.
 */
import 'server-only';

import moment from 'moment';

import { Prisma } from '@/generated/prisma/client';
import { BusinessError } from '@/shared/lib/action-result';

import { NOT_CLOSE_GENERATED_OPENING_SQL } from '../../shared/utils/closing-entries';
import {
  buildClosingLines,
  buildOpeningLines,
  summarizeResults,
  type AccountBalanceRow,
  type AccountRef,
  type ClosingLine,
} from '../../shared/utils/fiscal-year-close-math';
import { validateEntryLines, type JournalEntryLineDraft } from '../../shared/utils/journal-entry-lines';
import { createJournalEntryTx } from '../../shared/utils/journal-entry-tx';
import type { Tx } from '../../shared/utils/journal-entry-types';
import {
  ensureFiscalYearTx,
  ensurePeriodsTx,
  lockAccountingSettingsTx,
  syncLockedUntilDateTx,
  type FiscalYearRef,
} from '../../shared/utils/period-lock';
import {
  endOfDayUtc,
  formatDayUtc,
  formatMonth,
  monthKeyUtc,
  monthsBetweenUtc,
  startOfDayUtc,
  todayBusinessDay,
  toUtcDay,
} from '../../shared/utils/utc-month';

import type { ClosePreview, FiscalYearCloseStatus, PendingDraftsMonth } from './fiscal-year-close-common';

export const NO_RESULT_ACCOUNT_MESSAGE =
  'Configurá la cuenta de Resultado del Ejercicio en Contabilidad → Configuración antes de cerrar.';

const FISCAL_YEAR_SELECT = {
  id: true,
  number: true,
  startDate: true,
  endDate: true,
  isClosed: true,
} as const;

const MAX_NUMBERS_PER_MONTH = 5;

/** Cuenta Resultado del Ejercicio de Ajustes (exista o no la fila de Ajustes, NO_SETTINGS lo maneja el lock). */
async function resultAccountTx(tx: Tx, companyId: string): Promise<AccountRef> {
  const settings = await tx.accountingSettings.findUnique({
    where: { companyId },
    select: { resultAccount: { select: { id: true, code: true, name: true } } },
  });
  if (!settings?.resultAccount) throw new BusinessError(NO_RESULT_ACCOUNT_MESSAGE);
  return settings.resultAccount;
}

/** Sumas por cuenta de lo POSTED hasta el fin del ejercicio (sin aperturas generadas, B18). */
async function balancesTx(
  tx: Tx,
  companyId: string,
  fiscalYear: FiscalYearRef,
  kind: 'results' | 'patrimonial'
): Promise<AccountBalanceRow[]> {
  const types =
    kind === 'results'
      ? Prisma.sql`a.type IN ('REVENUE', 'EXPENSE')`
      : Prisma.sql`a.type IN ('ASSET', 'LIABILITY', 'EQUITY')`;
  return tx.$queryRaw<AccountBalanceRow[]>`
    SELECT a.id AS "accountId", a.code, a.name, a.type::text AS type,
           COALESCE(SUM(jel.debit), 0)::numeric AS debit,
           COALESCE(SUM(jel.credit), 0)::numeric AS credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE je.company_id = ${companyId}::uuid
      AND a.company_id = ${companyId}::uuid
      AND je.status = 'POSTED'
      AND je.date <= ${endOfDayUtc(fiscalYear.endDate)}
      AND ${types}
      AND ${NOT_CLOSE_GENERATED_OPENING_SQL}
    GROUP BY a.id, a.code, a.name, a.type
    ORDER BY a.code`;
}

const summaryOf = (fy: FiscalYearRef) => ({
  id: fy.id,
  number: fy.number,
  startDay: toUtcDay(fy.startDate),
  endDay: toUtcDay(fy.endDate),
});

const nextDayOf = (fy: FiscalYearRef) =>
  moment.utc(toUtcDay(fy.endDate)).add(1, 'day').toDate();

/** Mismo cálculo para la vista previa (con `prisma`) y para el cierre (con `tx`, tras el lock). */
export async function computeClosePreviewTx(
  tx: Tx,
  companyId: string,
  fiscalYear: FiscalYearRef,
  resultAccount: AccountRef
): Promise<ClosePreview> {
  const results = await balancesTx(tx, companyId, fiscalYear, 'results');
  const closingLines = buildClosingLines(results, resultAccount);
  if (closingLines.length === 0) {
    throw new BusinessError(
      `No hay asientos registrados con resultado en el ejercicio N° ${fiscalYear.number}: ` +
        'registrá los borradores antes de cerrar.'
    );
  }
  const patrimonial = await balancesTx(tx, companyId, fiscalYear, 'patrimonial');
  return {
    fiscalYear: summaryOf(fiscalYear),
    openingDay: toUtcDay(nextDayOf(fiscalYear)),
    closingLines,
    openingLines: buildOpeningLines(patrimonial, closingLines, resultAccount),
    ...summarizeResults(results),
  };
}

/** Meses del ejercicio sin su MONTHLY cerrado ('MM/YYYY'); un mes sin período cuenta como abierto. */
async function openMonthsTx(tx: Tx, start: Date, end: Date, fiscalYearId: string | null) {
  const closed = fiscalYearId
    ? await tx.accountingPeriod.findMany({
        where: { fiscalYearId, type: 'MONTHLY', isClosed: true },
        select: { year: true, month: true },
      })
    : [];
  return monthsBetweenUtc(start, end)
    .filter((ym) => !closed.some((p) => p.year === ym.year && p.month === ym.month))
    .map(formatMonth);
}

/** Borradores con fecha (día UTC) en el rango, agrupados por mes. */
async function pendingDraftsTx(
  tx: Tx,
  companyId: string,
  start: Date,
  end: Date
): Promise<PendingDraftsMonth[]> {
  const drafts = await tx.journalEntry.findMany({
    where: { companyId, status: 'DRAFT', date: { gte: startOfDayUtc(start), lte: endOfDayUtc(end) } },
    orderBy: [{ date: 'asc' }, { number: 'asc' }],
    select: { number: true, date: true },
  });
  const byMonth = new Map<string, number[]>();
  for (const draft of drafts) {
    const key = formatMonth(monthKeyUtc(draft.date));
    byMonth.set(key, [...(byMonth.get(key) ?? []), draft.number]);
  }
  return [...byMonth.entries()].map(([month, numbers]) => ({
    month,
    count: numbers.length,
    numbers: [...numbers].sort((a, b) => a - b).slice(0, MAX_NUMBERS_PER_MONTH),
  }));
}

function draftsBlockingMessage(fiscalYearNumber: number, groups: PendingDraftsMonth[]): string {
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  const detail = groups
    .map((g) => `${g.month}: N° ${g.numbers.join(', ')}${g.count > g.numbers.length ? ', …' : ''}`)
    .join('; ');
  const what = total === 1 ? 'hay 1 borrador sin registrar' : `hay ${total} borradores sin registrar`;
  return (
    `No se puede cerrar el ejercicio N° ${fiscalYearNumber}: ${what} (${detail}). ` +
    'Reabrí esos meses y registralos antes de cerrar.'
  );
}

/** Estado de la pantalla de cierre (solo lectura). `null` = empresa sin Ajustes. */
export async function buildFiscalYearStatusTx(
  tx: Tx,
  companyId: string
): Promise<FiscalYearCloseStatus | null> {
  const settings = await tx.accountingSettings.findUnique({
    where: { companyId },
    select: {
      fiscalYearStart: true,
      fiscalYearEnd: true,
      resultAccount: { select: { name: true } },
    },
  });
  if (!settings) return null;

  const fiscalYears = await tx.fiscalYear.findMany({
    where: { companyId },
    orderBy: { number: 'asc' },
    select: {
      ...FISCAL_YEAR_SELECT,
      closedAt: true,
      closingEntry: { select: { number: true } },
      openingEntry: { select: { number: true } },
    },
  });
  const lastClosedFy = fiscalYears.findLast((fy) => fy.isClosed);
  const nextOfLastClosed = lastClosedFy
    ? fiscalYears.find((fy) => fy.number === lastClosedFy.number + 1)
    : undefined;
  const lastClosed = lastClosedFy
    ? {
        number: lastClosedFy.number,
        closingEntryNumber: lastClosedFy.closingEntry?.number ?? null,
        openingEntryNumber: nextOfLastClosed?.openingEntry?.number ?? null,
        // Instante real del cierre: se muestra el día de Argentina (D5 revisado), no el UTC.
        closedAt: lastClosedFy.closedAt ? todayBusinessDay(lastClosedFy.closedAt) : null,
      }
    : null;

  // Sin ejercicios (la migración de la Fase 3 todavía no corrió): el FY 1 desde Ajustes.
  const open = fiscalYears.find((fy) => !fy.isClosed);
  const range =
    open ?? (fiscalYears.length === 0
      ? { id: null, number: 1, startDate: settings.fiscalYearStart, endDate: settings.fiscalYearEnd }
      : null);

  const base = { lastClosed, resultAccountName: settings.resultAccount?.name ?? null };
  if (!range) return { ...base, fiscalYear: null, openMonths: [], pendingDrafts: [], canClose: false };

  const openMonths = await openMonthsTx(tx, range.startDate, range.endDate, range.id);
  const pendingDrafts = await pendingDraftsTx(tx, companyId, range.startDate, range.endDate);
  return {
    ...base,
    fiscalYear: {
      id: range.id,
      number: range.number,
      startDay: toUtcDay(range.startDate),
      endDay: toUtcDay(range.endDate),
    },
    openMonths,
    pendingDrafts,
    canClose:
      range.id !== null &&
      base.resultAccountName !== null &&
      openMonths.length === 0 &&
      pendingDrafts.length === 0,
  };
}

/** Ejercicio de la empresa por id, para la vista previa (debe existir y estar abierto). */
export async function findOpenFiscalYearTx(
  tx: Tx,
  companyId: string,
  fiscalYearId: string
): Promise<FiscalYearRef> {
  const fiscalYear = await tx.fiscalYear.findFirst({
    where: { id: fiscalYearId, companyId },
    select: FISCAL_YEAR_SELECT,
  });
  if (!fiscalYear) throw new BusinessError('Ejercicio no encontrado.');
  if (fiscalYear.isClosed) {
    throw new BusinessError(`El ejercicio N° ${fiscalYear.number} ya está cerrado.`);
  }
  return fiscalYear;
}

const toDraftLines = (lines: readonly ClosingLine[], label: string): JournalEntryLineDraft[] =>
  lines.map((line) => ({
    accountId: line.accountId,
    debit: line.debit,
    credit: line.credit,
    description: `${label} — ${line.accountName}`,
  }));

export interface CloseFiscalYearTxInput {
  companyId: string;
  userId: string;
  fiscalYearId: string;
}

export interface CloseFiscalYearTxResult {
  closingEntryNumber: number;
  openingEntryNumber: number | null;
  nextFiscalYearNumber: number;
}

export async function closeFiscalYearTx(
  tx: Tx,
  input: CloseFiscalYearTxInput
): Promise<CloseFiscalYearTxResult> {
  const { companyId, userId } = input;
  const settings = await lockAccountingSettingsTx(tx, companyId);

  const fiscalYear = await findOpenFiscalYearTx(tx, companyId, input.fiscalYearId);
  const oldestOpen = await tx.fiscalYear.findFirst({
    where: { companyId, isClosed: false },
    orderBy: { number: 'asc' },
    select: { id: true, number: true },
  });
  if (oldestOpen && oldestOpen.id !== fiscalYear.id) {
    throw new BusinessError(
      `Solo se puede cerrar el ejercicio abierto más antiguo (N° ${oldestOpen.number}).`
    );
  }

  await ensurePeriodsTx(tx, fiscalYear);
  const openMonths = await openMonthsTx(tx, fiscalYear.startDate, fiscalYear.endDate, fiscalYear.id);
  if (openMonths.length > 0) {
    throw new BusinessError(
      `No se puede cerrar el ejercicio N° ${fiscalYear.number}: faltan cerrar los meses ` +
        `${openMonths.join(', ')}. Cerralos en orden desde Contabilidad → Configuración → Bloqueo de Períodos.`
    );
  }
  const drafts = await pendingDraftsTx(tx, companyId, fiscalYear.startDate, fiscalYear.endDate);
  if (drafts.length > 0) throw new BusinessError(draftsBlockingMessage(fiscalYear.number, drafts));

  const resultAccount = await resultAccountTx(tx, companyId);
  const preview = await computeClosePreviewTx(tx, companyId, fiscalYear, resultAccount);
  const range = `${formatDayUtc(fiscalYear.startDate)} al ${formatDayUtc(fiscalYear.endDate)}`;

  // 1. Refundición, con el ejercicio todavía abierto (D12: CLOSING exige FY no cerrado).
  const closing = await createJournalEntryTx(tx, {
    companyId,
    date: startOfDayUtc(fiscalYear.endDate),
    description: `Refundición de resultados — Ejercicio N° ${fiscalYear.number} (${range})`,
    lines: toDraftLines(preview.closingLines, 'Refundición'),
    status: 'POSTED',
    createdBy: userId,
    periodType: 'CLOSING',
    source: `fiscal-year-close:${fiscalYear.id}`,
  });

  // 2. Ejercicio siguiente: se reutiliza si ya existe (B24).
  const next = await ensureFiscalYearTx(tx, settings, nextDayOf(fiscalYear));
  await ensurePeriodsTx(tx, next);

  // 3. Apertura (B21): saldos patrimoniales + resultado de la refundición, verificada.
  let opening: { id: string; number: number } | null = null;
  if (preview.openingLines.length > 0) {
    const lines = toDraftLines(preview.openingLines, 'Apertura');
    try {
      validateEntryLines(lines);
    } catch (error) {
      if (error instanceof BusinessError) {
        throw new BusinessError(`El asiento de apertura no balancea. ${error.message}`);
      }
      throw error;
    }
    opening = await createJournalEntryTx(tx, {
      companyId,
      date: startOfDayUtc(next.startDate),
      description:
        `Asiento de apertura — Ejercicio N° ${next.number} ` +
        `(${formatDayUtc(next.startDate)} al ${formatDayUtc(next.endDate)})`,
      lines,
      status: 'POSTED',
      createdBy: userId,
      periodType: 'OPENING',
      source: `fiscal-year-opening:${next.id}`,
    });
  }

  // 4. Estado: ejercicio y todos sus períodos cerrados; OPENING del siguiente cerrado (C7).
  const now = new Date();
  await tx.fiscalYear.update({
    where: { id: fiscalYear.id },
    data: { isClosed: true, closedAt: now, closedBy: userId, closingEntryId: closing.id },
  });
  await tx.accountingPeriod.updateMany({
    where: { fiscalYearId: fiscalYear.id, isClosed: false },
    data: { isClosed: true, closedAt: now, closedBy: userId },
  });
  if (opening) {
    await tx.fiscalYear.update({ where: { id: next.id }, data: { openingEntryId: opening.id } });
  }
  await tx.accountingPeriod.updateMany({
    where: { fiscalYearId: next.id, type: 'OPENING', isClosed: false },
    data: { isClosed: true, closedAt: now, closedBy: userId },
  });

  // 5. Bloqueo derivado y Ajustes al ejercicio abierto más antiguo.
  await syncLockedUntilDateTx(tx, companyId);
  const newOldest = await tx.fiscalYear.findFirst({
    where: { companyId, isClosed: false },
    orderBy: { number: 'asc' },
    select: { startDate: true, endDate: true },
  });
  if (newOldest) {
    await tx.accountingSettings.update({
      where: { companyId },
      data: { fiscalYearStart: newOldest.startDate, fiscalYearEnd: newOldest.endDate },
    });
  }

  return {
    closingEntryNumber: closing.number,
    openingEntryNumber: opening?.number ?? null,
    nextFiscalYearNumber: next.number,
  };
}
