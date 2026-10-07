/**
 * Creador único de asientos (TSK-760, A3/C1/C5, diseño §3.3.4).
 *
 * Todos los caminos que crean o registran asientos pasan por acá, dentro de la
 * transacción del llamador (sin `$transaction` ni `checkPermission` propios):
 * valida líneas y cuentas, controla el período con el lock de la empresa
 * (`assertPeriodOpen`), numera (`nextEntryNumberTx`) y crea el asiento con
 * `fiscalYearId`/`periodId` y todas las columnas de línea.
 *
 * Sin `'use server'` (H7): no son endpoints invocables desde el navegador.
 */
import 'server-only';

import { BusinessError } from '@/shared/lib/action-result';
import { logger } from '@/shared/lib/logger';

import { invertLines, validateEntryLines, type JournalEntryLineDraft } from './journal-entry-lines';
import type { CreatableEntryStatus, EntryPeriodType, Tx } from './journal-entry-types';
import { assertPeriodOpen, NO_SETTINGS_MESSAGE } from './period-lock';
import { formatDayUtc } from './utc-month';

export interface CreateJournalEntryTxInput {
  companyId: string;
  date: Date;
  description: string;
  lines: readonly JournalEntryLineDraft[];
  status: CreatableEntryStatus;
  /** userId o 'system' (se conserva lo de cada creador, 1.2.5). */
  createdBy: string;
  periodType?: EntryPeriodType; // default MONTHLY
  originalEntryId?: string; // solo reversiones
  /** Etiqueta del origen para el log (p. ej. 'sales-invoice:<id>'); no se persiste. */
  source?: string;
}

export interface CreatedJournalEntry {
  id: string;
  number: number;
  fiscalYearId: string;
  periodId: string;
  status: CreatableEntryStatus;
}

export interface PostJournalEntryTxInput {
  companyId: string;
  entryId: string;
  userId: string;
}

export interface ReverseJournalEntryTxInput {
  companyId: string;
  entryId: string;
  /** Fecha de la reversión (se valida su período, además del del original). */
  date: Date;
  /** userId de quien anula (también va a `reversedBy`). */
  createdBy: string;
  /**
   * Tipo del período de la reversión (default MONTHLY). La edición de saldos de
   * apertura (B25) revierte con la misma fecha en el período OPENING.
   */
  periodType?: EntryPeriodType;
  /** Etiqueta del origen para el log; no se persiste. */
  source?: string;
}

export interface ReversedJournalEntry {
  original: { id: string; number: number };
  reversal: CreatedJournalEntry;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  POSTED: 'Registrado',
  REVERSED: 'Anulado',
};

/** Tipo de período guardado → tipo con el que se valida (sin período: MONTHLY). */
function toEntryPeriodType(stored: string | null | undefined): EntryPeriodType {
  return stored === 'OPENING' || stored === 'CLOSING' ? stored : 'MONTHLY';
}

/**
 * Cuentas de la empresa y hojas (1 query). Defensa en profundidad: no reemplaza las
 * pre-validaciones de cada documento (TSK-717/721/757).
 */
export async function assertAccountsUsableTx(
  tx: Tx,
  companyId: string,
  accountIds: readonly string[]
): Promise<void> {
  const ids = [...new Set(accountIds)];
  const accounts = await tx.account.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, code: true, isLeaf: true },
  });
  if (accounts.length !== ids.length) {
    throw new BusinessError('Una o más cuentas del asiento no existen o no pertenecen a la empresa.');
  }
  for (const id of ids) {
    const account = accounts.find((a) => a.id === id);
    if (account && !account.isLeaf) {
      throw new BusinessError(`La cuenta ${account.code} no es imputable (tiene subcuentas).`);
    }
  }
}

/**
 * Siguiente número libre (C1): avanza el contador y, si el siguiente está ocupado
 * (datos viejos o un número aislado), salta al primer libre después de la racha
 * ocupada. Un solo statement sobre la fila de `accounting_settings`; el lock ya lo
 * tomó `assertPeriodOpen`. Las referencias a `s.last_entry_number` se evalúan
 * sobre la versión vigente de la fila.
 */
export async function nextEntryNumberTx(tx: Tx, companyId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ lastEntryNumber: number }[]>`
    UPDATE accounting_settings s
    SET last_entry_number = CASE
          WHEN NOT EXISTS (SELECT 1 FROM journal_entries j
                           WHERE j.company_id = s.company_id AND j.number = s.last_entry_number + 1)
            THEN s.last_entry_number + 1
          ELSE (SELECT min(j.number) + 1 FROM journal_entries j
                WHERE j.company_id = s.company_id AND j.number > s.last_entry_number
                  AND NOT EXISTS (SELECT 1 FROM journal_entries k
                                  WHERE k.company_id = s.company_id AND k.number = j.number + 1))
        END,
        updated_at = now()
    WHERE s.company_id = ${companyId}::uuid
    RETURNING s.last_entry_number AS "lastEntryNumber"`;
  const row = rows[0];
  if (!row) throw new BusinessError(NO_SETTINGS_MESSAGE);
  return row.lastEntryNumber;
}

/**
 * validateEntryLines → assertAccountsUsableTx → assertPeriodOpen → nextEntryNumberTx → create.
 * El balance se valida siempre (también DRAFT, C5). Sin checkPermission ni $transaction.
 */
export async function createJournalEntryTx(
  tx: Tx,
  input: CreateJournalEntryTxInput
): Promise<CreatedJournalEntry> {
  const { companyId, lines, status } = input;

  validateEntryLines(lines);
  await assertAccountsUsableTx(
    tx,
    companyId,
    lines.map((line) => line.accountId)
  );
  const period = await assertPeriodOpen(tx, companyId, input.date, { periodType: input.periodType });
  const number = await nextEntryNumberTx(tx, companyId);

  const entry = await tx.journalEntry.create({
    data: {
      companyId,
      number,
      date: input.date,
      description: input.description,
      status,
      postDate: status === 'POSTED' ? new Date() : null,
      fiscalYearId: period.fiscalYearId,
      periodId: period.periodId,
      originalEntryId: input.originalEntryId ?? null,
      createdBy: input.createdBy,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          description: line.description ?? null,
          customerId: line.customerId ?? null,
          supplierId: line.supplierId ?? null,
          costCenterId: line.costCenterId ?? null,
          currency: line.currency ?? 'ARS',
          originalAmount: line.originalAmount ?? null,
          exchangeRate: line.exchangeRate ?? null,
        })),
      },
    },
    select: { id: true, number: true },
  });

  logger.debug('Asiento creado', {
    data: { companyId, entryId: entry.id, number, status, source: input.source },
  });

  return {
    id: entry.id,
    number: entry.number,
    fiscalYearId: period.fiscalYearId,
    periodId: period.periodId,
    status,
  };
}

/**
 * DRAFT → POSTED: assertPeriodOpen(entry.date, tipo de su período) + validateEntryLines +
 * assertAccountsUsableTx; actualiza fiscalYearId/periodId (corrige datos viejos).
 */
export async function postJournalEntryTx(
  tx: Tx,
  input: PostJournalEntryTxInput
): Promise<{ id: string; number: number }> {
  const { companyId, entryId } = input;

  const entry = await tx.journalEntry.findFirst({
    where: { id: entryId, companyId },
    select: {
      id: true,
      number: true,
      status: true,
      date: true,
      period: { select: { type: true } },
      lines: { select: { accountId: true, debit: true, credit: true } },
    },
  });
  if (!entry) throw new BusinessError('Asiento no encontrado.');
  if (entry.status !== 'DRAFT') {
    throw new BusinessError(`El asiento N° ${entry.number} ya no está en borrador.`);
  }

  const periodType = toEntryPeriodType(entry.period?.type);
  const period = await assertPeriodOpen(tx, companyId, entry.date, { periodType });

  validateEntryLines(entry.lines);
  await assertAccountsUsableTx(
    tx,
    companyId,
    entry.lines.map((line) => line.accountId)
  );

  // El estado se leyó antes del lock: si otra tx lo registró mientras esperábamos, el
  // UPDATE condicionado no toca nada (en vez de chocar con el trigger de inmutabilidad).
  const { count } = await tx.journalEntry.updateMany({
    where: { id: entry.id, status: 'DRAFT' },
    data: {
      status: 'POSTED',
      postDate: new Date(),
      fiscalYearId: period.fiscalYearId,
      periodId: period.periodId,
    },
  });
  if (count === 0) throw new BusinessError(`El asiento N° ${entry.number} ya no está en borrador.`);

  logger.debug('Asiento registrado', {
    data: { companyId, entryId: entry.id, number: entry.number, userId: input.userId },
  });

  return { id: entry.id, number: entry.number };
}

/**
 * Anula un asiento POSTED (A4, diseño §3.1.6): valida el período del original (con el
 * tipo de su período) y el de la fecha de reversión, crea la reversión POSTED con
 * todas las columnas de línea invertidas (auxiliares, centro de costo, moneda) y pasa
 * el original a REVERSED en un solo UPDATE (el trigger solo admite esa transición).
 *
 * Puro: sin checkPermission ni $transaction propios, y sin mirar si el asiento
 * pertenece a un documento (eso lo decide el llamador). Lo usan la edición de saldos
 * de apertura (Fase 7, B25) y la anulación desde Asientos (Fase 10).
 */
export async function reverseJournalEntryTx(
  tx: Tx,
  input: ReverseJournalEntryTxInput
): Promise<ReversedJournalEntry> {
  const { companyId, entryId } = input;

  const original = await tx.journalEntry.findFirst({
    where: { id: entryId, companyId },
    select: {
      id: true,
      number: true,
      status: true,
      date: true,
      description: true,
      period: { select: { type: true } },
      lines: {
        select: {
          accountId: true,
          debit: true,
          credit: true,
          description: true,
          customerId: true,
          supplierId: true,
          costCenterId: true,
          currency: true,
          originalAmount: true,
          exchangeRate: true,
        },
      },
    },
  });
  if (!original) throw new BusinessError('Asiento no encontrado.');
  if (original.status !== 'POSTED') {
    throw new BusinessError(
      `Solo se pueden anular asientos registrados; el N° ${original.number} está en estado ` +
        `${STATUS_LABELS[original.status] ?? original.status}.`
    );
  }

  await assertPeriodOpen(tx, companyId, original.date, {
    periodType: toEntryPeriodType(original.period?.type),
    subject: `No se puede anular el asiento N° ${original.number} (fecha ${formatDayUtc(original.date)})`,
  });

  const reversal = await createJournalEntryTx(tx, {
    companyId,
    date: input.date,
    description: `Anulación del asiento N° ${original.number} - ${original.description}`,
    lines: invertLines(original.lines),
    status: 'POSTED',
    createdBy: input.createdBy,
    periodType: input.periodType,
    originalEntryId: original.id,
    source: input.source ?? `reversal:${original.id}`,
  });

  // Ídem registrar: si otra tx lo anuló mientras esperábamos el lock, no se toca y se
  // aborta (la reversión recién creada se revierte con la tx).
  const { count } = await tx.journalEntry.updateMany({
    where: { id: original.id, status: 'POSTED' },
    data: {
      status: 'REVERSED',
      reversalEntryId: reversal.id,
      reversedBy: input.createdBy,
      reversedAt: new Date(),
    },
  });
  if (count === 0) {
    throw new BusinessError(
      `Solo se pueden anular asientos registrados; el N° ${original.number} está en estado Anulado.`
    );
  }

  logger.debug('Asiento anulado', {
    data: { companyId, entryId: original.id, reversalId: reversal.id, number: reversal.number },
  });

  return { original: { id: original.id, number: original.number }, reversal };
}
