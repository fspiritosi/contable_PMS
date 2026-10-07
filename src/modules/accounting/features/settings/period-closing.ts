/**
 * Cierre y reapertura de meses (TSK-760, Fase 8: A1, B3, B5, B22, D2; diseño §3.1.4 y §3.3.5).
 *
 * - Solo se cierra el primer MONTHLY abierto y solo se reabre el último cerrado.
 * - Nunca se toca un mes de un ejercicio cerrado (piso, B5): sus meses cuentan como cerrados.
 * - `lockedUntilDate` es derivado (`syncLockedUntilDateTx`) y se recalcula en la misma tx.
 * - Con borradores en el mes: sin `postDrafts` se rechaza; con `postDrafts` se registran
 *   todos o ninguno (D2), y el mensaje nombra el borrador que falló.
 * - Todo por `{ year, month }` y día UTC (B22): no depende de la zona del servidor.
 *
 * Funciones con el cliente transaccional del llamador (sin permisos ni `$transaction`).
 * Sin `'use server'` (H7): no son endpoints.
 */
import 'server-only';

import { BusinessError } from '@/shared/lib/action-result';

import { getEntryDocumentLink } from '../../shared/utils/entry-document-link';
import { postJournalEntryTx } from '../../shared/utils/journal-entry-tx';
import type { IsoDay, Tx, YearMonth } from '../../shared/utils/journal-entry-types';
import {
  ensureFiscalYearTx,
  ensurePeriodsTx,
  listMonthlyPeriodsTx,
  lockAccountingSettingsTx,
  syncLockedUntilDateTx,
  type MonthlyPeriodRow,
} from '../../shared/utils/period-lock';
import {
  endOfMonthUtc,
  formatMonth,
  formatMonthLabel,
  monthKeyUtc,
  monthsBetweenUtc,
  startOfMonthUtc,
  toUtcDay,
} from '../../shared/utils/utc-month';

import {
  draftsPendingMessage,
  type PeriodLockFiscalYear,
  type PeriodLockStatus,
  type PeriodMonthStatus,
} from './period-lock-common';

const sameMonth = (a: YearMonth, b: YearMonth) => a.year === b.year && a.month === b.month;

/** Valida el `{ year, month }` que llega del cliente. */
export function parseYearMonth(input: YearMonth): YearMonth {
  const { year, month } = input;
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    year < 1900
  ) {
    throw new BusinessError(`Mes inválido: ${year}-${month}.`);
  }
  return { year, month };
}

/** Primer mes abierto (un ejercicio cerrado cuenta como todo cerrado). */
function firstOpenMonth(months: readonly MonthlyPeriodRow[]) {
  return months.find((m) => !m.isClosed && !m.fiscalYearClosed) ?? null;
}

/** Último mes cerrado que se puede reabrir (de un ejercicio abierto). */
function lastReopenableMonth(months: readonly MonthlyPeriodRow[]) {
  return months.findLast((m) => m.isClosed && !m.fiscalYearClosed) ?? null;
}

function findMonth(months: readonly MonthlyPeriodRow[], ym: YearMonth): MonthlyPeriodRow {
  const month = months.find((m) => sameMonth(m, ym));
  if (!month)
    throw new BusinessError(`No existe el mes ${formatMonth(ym)} en los ejercicios de la empresa.`);
  return month;
}

/**
 * Meses de la empresa, reparando lo que falte: sin ejercicios crea el FY 1 desde Ajustes
 * (la migración de la Fase 3 todavía no corrió) y completa períodos de los FY abiertos.
 */
async function loadMonthsTx(tx: Tx, companyId: string): Promise<MonthlyPeriodRow[]> {
  const settings = await lockAccountingSettingsTx(tx, companyId);
  const fiscalYears = await tx.fiscalYear.findMany({
    where: { companyId, isClosed: false },
    select: { id: true, number: true, startDate: true, endDate: true, isClosed: true },
  });
  if (fiscalYears.length === 0 && (await tx.fiscalYear.count({ where: { companyId } })) === 0) {
    await ensureFiscalYearTx(tx, settings, settings.fiscalYearStart);
  }
  for (const fiscalYear of fiscalYears) await ensurePeriodsTx(tx, fiscalYear);
  return listMonthlyPeriodsTx(tx, companyId);
}

async function draftsOfMonthTx(tx: Tx, companyId: string, ym: YearMonth) {
  return tx.journalEntry.findMany({
    where: {
      companyId,
      status: 'DRAFT',
      date: { gte: startOfMonthUtc(ym), lte: endOfMonthUtc(ym) },
    },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, createdBy: true },
  });
}

/** Sugerencia para un borrador manual trabado (C6): se puede eliminar desde Asientos. */
async function deleteHintTx(tx: Tx, companyId: string, entry: { id: string; createdBy: string }) {
  if (entry.createdBy === 'system') return '';
  if (await getEntryDocumentLink(tx, companyId, entry.id)) return '';
  return 'Si es un asiento manual que ya no sirve, podés eliminarlo desde Asientos.';
}

export interface CloseMonthTxInput extends YearMonth {
  companyId: string;
  userId: string;
  postDrafts: boolean;
}

export async function closeMonthTx(
  tx: Tx,
  input: CloseMonthTxInput
): Promise<{ lockedUntil: IsoDay; postedDrafts: number }> {
  const { companyId, userId } = input;
  const ym = parseYearMonth(input);
  const months = await loadMonthsTx(tx, companyId);
  const target = findMonth(months, ym);

  const first = firstOpenMonth(months);
  if (!first)
    throw new BusinessError('No hay meses abiertos para cerrar en los ejercicios vigentes.');
  if (first.periodId !== target.periodId) {
    throw new BusinessError(`Solo se puede cerrar el primer mes abierto: ${formatMonth(first)}.`);
  }

  const drafts = await draftsOfMonthTx(tx, companyId, ym);
  if (drafts.length > 0 && !input.postDrafts) {
    throw new BusinessError(
      draftsPendingMessage(
        ym,
        drafts.map((d) => d.number)
      )
    );
  }
  for (const entry of drafts) {
    try {
      await postJournalEntryTx(tx, { companyId, entryId: entry.id, userId });
    } catch (error) {
      if (!(error instanceof BusinessError)) throw error;
      const cause = `No se cerró ${formatMonth(ym)}: el borrador N° ${entry.number} no se puede registrar. ${error.message}`;
      const hint = await deleteHintTx(tx, companyId, entry);
      throw new BusinessError(hint ? `${cause}${cause.endsWith('.') ? '' : '.'} ${hint}` : cause);
    }
  }

  await tx.accountingPeriod.update({
    where: { id: target.periodId },
    data: { isClosed: true, closedAt: new Date(), closedBy: userId },
  });
  const lockedUntil = await syncLockedUntilDateTx(tx, companyId);

  return { lockedUntil: toUtcDay(lockedUntil ?? endOfMonthUtc(ym)), postedDrafts: drafts.length };
}

export async function reopenMonthTx(
  tx: Tx,
  input: YearMonth & { companyId: string }
): Promise<{ lockedUntil: IsoDay | null }> {
  const { companyId } = input;
  const ym = parseYearMonth(input);
  const months = await loadMonthsTx(tx, companyId);
  const target = findMonth(months, ym);

  if (target.fiscalYearClosed) {
    throw new BusinessError(
      `No se puede reabrir ${formatMonth(ym)}: pertenece al ejercicio N° ${target.fiscalYearNumber}, que está cerrado.`
    );
  }
  const last = lastReopenableMonth(months);
  if (!last) throw new BusinessError('No hay meses cerrados para reabrir.');
  if (last.periodId !== target.periodId) {
    throw new BusinessError(`Solo se puede reabrir el último mes cerrado: ${formatMonth(last)}.`);
  }

  await tx.accountingPeriod.update({
    where: { id: target.periodId },
    data: { isClosed: false, closedAt: null, closedBy: null },
  });
  const lockedUntil = await syncLockedUntilDateTx(tx, companyId);
  return { lockedUntil: lockedUntil ? toUtcDay(lockedUntil) : null };
}

/** Cantidad de borradores por mes UTC ('YYYY-M') dentro del rango. */
async function draftCountsByMonth(tx: Tx, companyId: string, from: Date, to: Date) {
  const drafts = await tx.journalEntry.findMany({
    where: { companyId, status: 'DRAFT', date: { gte: from, lte: to } },
    select: { date: true },
  });
  const counts = new Map<string, number>();
  for (const { date } of drafts) {
    const { year, month } = monthKeyUtc(date);
    const key = `${year}-${month}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Estado del panel "Bloqueo de Períodos": FY abierto más antiguo y el siguiente si existe,
 * desde `AccountingPeriod` (solo lectura; sin ejercicios, se arma desde Ajustes).
 */
export async function buildPeriodLockStatusTx(
  tx: Tx,
  companyId: string
): Promise<PeriodLockStatus | null> {
  const settings = await tx.accountingSettings.findUnique({
    where: { companyId },
    select: { fiscalYearStart: true, fiscalYearEnd: true, lockedUntilDate: true },
  });
  if (!settings) return null;

  const fiscalYears = await tx.fiscalYear.findMany({
    where: { companyId },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, startDate: true, endDate: true, isClosed: true },
  });
  const lockedUntil = settings.lockedUntilDate ? toUtcDay(settings.lockedUntilDate) : null;
  const lastClosed = fiscalYears.findLast((fy) => fy.isClosed);
  const lastClosedFiscalYear = lastClosed
    ? { number: lastClosed.number, endDay: toUtcDay(lastClosed.endDate) }
    : null;

  if (fiscalYears.length === 0) {
    const counts = await draftCountsByMonth(
      tx,
      companyId,
      startOfMonthUtc(monthKeyUtc(settings.fiscalYearStart)),
      endOfMonthUtc(monthKeyUtc(settings.fiscalYearEnd))
    );
    const months = monthsBetweenUtc(settings.fiscalYearStart, settings.fiscalYearEnd).map(
      (ym, i): PeriodMonthStatus => ({
        ...ym,
        label: formatMonthLabel(ym),
        isClosed: false,
        draftCount: counts.get(`${ym.year}-${ym.month}`) ?? 0,
        action: i === 0 ? 'close' : null,
      })
    );
    const fy: PeriodLockFiscalYear = {
      id: null,
      number: 1,
      startDay: toUtcDay(settings.fiscalYearStart),
      endDay: toUtcDay(settings.fiscalYearEnd),
      months,
    };
    return { fiscalYears: [fy], lockedUntil, lastClosedFiscalYear };
  }

  const oldestOpenIndex = fiscalYears.findIndex((fy) => !fy.isClosed);
  const shown = oldestOpenIndex < 0 ? [] : fiscalYears.slice(oldestOpenIndex, oldestOpenIndex + 2);
  const allMonths = await listMonthlyPeriodsTx(tx, companyId);
  const first = firstOpenMonth(allMonths);
  const last = lastReopenableMonth(allMonths);
  const counts =
    shown.length > 0
      ? await draftCountsByMonth(
          tx,
          companyId,
          shown[0]!.startDate,
          shown[shown.length - 1]!.endDate
        )
      : new Map<string, number>();

  return {
    fiscalYears: shown.map((fy) => ({
      id: fy.id,
      number: fy.number,
      startDay: toUtcDay(fy.startDate),
      endDay: toUtcDay(fy.endDate),
      months: allMonths
        .filter((m) => m.fiscalYearId === fy.id)
        .map((m) => ({
          year: m.year,
          month: m.month,
          label: formatMonthLabel(m),
          isClosed: m.isClosed || m.fiscalYearClosed,
          draftCount: counts.get(`${m.year}-${m.month}`) ?? 0,
          action:
            m.periodId === first?.periodId
              ? 'close'
              : m.periodId === last?.periodId
                ? 'reopen'
                : null,
        })),
    })),
    lockedUntil,
    lastClosedFiscalYear,
  };
}
