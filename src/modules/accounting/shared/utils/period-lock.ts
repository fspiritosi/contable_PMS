/**
 * Control de período del núcleo contable (TSK-760, A2/D1/D8/D12, diseño §3.3.3).
 *
 * Una sola definición de "período cerrado" para todos los caminos que crean,
 * registran o anulan asientos. Todas las funciones reciben el cliente
 * transaccional del llamador: no abren `$transaction` ni verifican permisos.
 *
 * Regla de lock (§3.1.1): toda operación que crea, registra o anula asientos, o
 * cambia el estado de un período, toma PRIMERO la fila de `accounting_settings`
 * de la empresa con `SELECT … FOR UPDATE` y recién después lee ejercicios y
 * períodos. Así la creación de un asiento y el cierre de su mes se serializan
 * por empresa.
 *
 * Sin `'use server'` (H7): no son endpoints invocables desde el navegador.
 */
import 'server-only';

import moment from 'moment';

import { BusinessError } from '@/shared/lib/action-result';

import type { EntryPeriodType, IsoDay, Tx, YearMonth } from './journal-entry-types';
import { buildPeriodClosedMessage, evaluatePeriodClosure } from './period-closure';
import {
  endOfDayUtc,
  endOfMonthUtc,
  formatDayUtc,
  isOnOrBeforeDayUtc,
  monthKeyUtc,
  monthsBetweenUtc,
  startOfDayUtc,
  toUtcDay,
} from './utc-month';

export const NO_SETTINGS_MESSAGE =
  'No se encontró configuración contable para la empresa. Configurala en Contabilidad → Configuración.';

export interface LockedAccountingSettings {
  id: string;
  companyId: string;
  fiscalYearStart: Date;
  fiscalYearEnd: Date;
  lockedUntilDate: Date | null;
}

export interface FiscalYearRef {
  id: string;
  number: number;
  startDate: Date;
  endDate: Date;
  isClosed: boolean;
}

export interface OpenPeriodRef {
  fiscalYearId: string;
  fiscalYearNumber: number;
  periodId: string;
}

export interface AssertPeriodOpenOptions {
  periodType?: EntryPeriodType;
  subject?: string;
}

export interface MonthlyPeriodRow extends YearMonth {
  periodId: string;
  isClosed: boolean;
  fiscalYearId: string;
  fiscalYearNumber: number;
  fiscalYearClosed: boolean;
}

const FISCAL_YEAR_SELECT = {
  id: true,
  number: true,
  startDate: true,
  endDate: true,
  isClosed: true,
} as const;

/**
 * `SELECT … FROM accounting_settings WHERE company_id = $1 FOR UPDATE`.
 * Reentrante dentro de la misma tx. Sin fila → `BusinessError` NO_SETTINGS.
 */
export async function lockAccountingSettingsTx(
  tx: Tx,
  companyId: string
): Promise<LockedAccountingSettings> {
  const rows = await tx.$queryRaw<LockedAccountingSettings[]>`
    SELECT id, company_id AS "companyId", fiscal_year_start AS "fiscalYearStart",
           fiscal_year_end AS "fiscalYearEnd", locked_until_date AS "lockedUntilDate"
    FROM accounting_settings WHERE company_id = ${companyId}::uuid
    FOR UPDATE`;
  const settings = rows[0];
  if (!settings) throw new BusinessError(NO_SETTINGS_MESSAGE);
  return settings;
}

/** FY cuyo rango contiene el día UTC de la fecha (fechas normalizadas, D8). */
export async function findFiscalYearForDateTx(
  tx: Tx,
  companyId: string,
  date: Date
): Promise<FiscalYearRef | null> {
  return tx.fiscalYear.findFirst({
    where: {
      companyId,
      startDate: { lte: endOfDayUtc(date) },
      endDate: { gte: startOfDayUtc(date) },
    },
    orderBy: { number: 'asc' },
    select: FISCAL_YEAR_SELECT,
  });
}

/** Períodos que debe tener un FY: OPENING (mes de inicio), un MONTHLY por mes y CLOSING (mes de fin). */
function expectedPeriods(fiscalYear: FiscalYearRef) {
  const opening = monthKeyUtc(fiscalYear.startDate);
  const closing = monthKeyUtc(fiscalYear.endDate);
  return [
    { ...opening, type: 'OPENING' as const },
    ...monthsBetweenUtc(fiscalYear.startDate, fiscalYear.endDate).map((ym) => ({
      ...ym,
      type: 'MONTHLY' as const,
    })),
    { ...closing, type: 'CLOSING' as const },
  ];
}

/**
 * Crea los períodos faltantes de un FY existente (autorreparación). OPENING y
 * CLOSING solo si el FY no tiene ninguno de ese tipo (un FY tiene exactamente uno).
 */
export async function ensurePeriodsTx(tx: Tx, fiscalYear: FiscalYearRef): Promise<void> {
  const existing = await tx.accountingPeriod.findMany({
    where: { fiscalYearId: fiscalYear.id },
    select: { year: true, month: true, type: true },
  });
  const has = (p: { year: number; month: number; type: string }) =>
    existing.some((e) =>
      p.type === 'MONTHLY'
        ? e.type === 'MONTHLY' && e.year === p.year && e.month === p.month
        : e.type === p.type
    );

  const missing = expectedPeriods(fiscalYear).filter((p) => !has(p));
  if (missing.length === 0) return;

  await tx.accountingPeriod.createMany({
    data: missing.map((p) => ({ fiscalYearId: fiscalYear.id, year: p.year, month: p.month, type: p.type })),
    skipDuplicates: true,
  });
}

/** Crea el FY (inicio 00:00Z, fin 23:59:59.999Z, D8) con OPENING + un MONTHLY por mes + CLOSING. */
export async function createFiscalYearWithPeriodsTx(
  tx: Tx,
  input: { companyId: string; number: number; startDay: IsoDay; endDay: IsoDay }
): Promise<FiscalYearRef> {
  const fiscalYear = await tx.fiscalYear.create({
    data: {
      companyId: input.companyId,
      number: input.number,
      startDate: startOfDayUtc(input.startDay),
      endDate: endOfDayUtc(input.endDay),
    },
    select: FISCAL_YEAR_SELECT,
  });
  await ensurePeriodsTx(tx, fiscalYear);
  return fiscalYear;
}

/**
 * D1. Devuelve el FY que contiene la fecha, creándolo si corresponde. Recibe los
 * Ajustes ya bloqueados (prueba de que el llamador tiene el lock).
 * - Sin FY en la empresa → crea FY 1 con el rango de Ajustes (por día UTC) y lo
 *   usa si la fecha cae dentro; si no, sigue con las reglas de abajo.
 * - Fecha anterior al inicio del primer FY → BusinessError BEFORE_FIRST_FY.
 * - Fecha posterior al último FY y dentro del inmediato siguiente (inicio = día
 *   siguiente al fin, 12 meses) → lo crea con createFiscalYearWithPeriodsTx.
 * - Más allá del siguiente → BusinessError TOO_FAR_AHEAD.
 */
export async function ensureFiscalYearTx(
  tx: Tx,
  settings: LockedAccountingSettings,
  date: Date
): Promise<FiscalYearRef> {
  const companyId = settings.companyId;
  let fiscalYears: FiscalYearRef[] = await tx.fiscalYear.findMany({
    where: { companyId },
    orderBy: { number: 'asc' },
    select: FISCAL_YEAR_SELECT,
  });

  if (fiscalYears.length === 0) {
    const first = await createFiscalYearWithPeriodsTx(tx, {
      companyId,
      number: 1,
      startDay: toUtcDay(settings.fiscalYearStart),
      endDay: toUtcDay(settings.fiscalYearEnd),
    });
    fiscalYears = [first];
  }

  const day = toUtcDay(date);
  const containing = fiscalYears.find(
    (fy) => toUtcDay(fy.startDate) <= day && day <= toUtcDay(fy.endDate)
  );
  if (containing) return containing;

  const first = fiscalYears[0];
  const last = fiscalYears[fiscalYears.length - 1];

  if (day < toUtcDay(first.startDate)) {
    throw new BusinessError(
      `La fecha ${formatDayUtc(date)} es anterior al inicio del primer ejercicio ` +
        `(${formatDayUtc(first.startDate)}); cargala como saldo de apertura.`
    );
  }

  if (day > toUtcDay(last.endDate)) {
    const nextStart = moment.utc(toUtcDay(last.endDate)).add(1, 'day');
    const nextEnd = nextStart.clone().add(12, 'months').subtract(1, 'day');
    if (day <= nextEnd.format('YYYY-MM-DD')) {
      return createFiscalYearWithPeriodsTx(tx, {
        companyId,
        number: last.number + 1,
        startDay: nextStart.format('YYYY-MM-DD'),
        endDay: nextEnd.format('YYYY-MM-DD'),
      });
    }
    throw new BusinessError(
      `La fecha ${formatDayUtc(date)} está más de un ejercicio por delante del último ejercicio ` +
        `(N° ${last.number}, hasta ${formatDayUtc(last.endDate)}).`
    );
  }

  // Hueco entre ejercicios: no debería existir (los FY se crean contiguos).
  throw new BusinessError(
    `La fecha ${formatDayUtc(date)} no pertenece a ningún ejercicio. Revisá los ejercicios en Contabilidad → Configuración.`
  );
}

async function findPeriodTx(tx: Tx, fiscalYearId: string, date: Date, periodType: EntryPeriodType) {
  const where =
    periodType === 'MONTHLY'
      ? { fiscalYearId, type: periodType, ...monthKeyUtc(date) }
      : { fiscalYearId, type: periodType };
  return tx.accountingPeriod.findFirst({ where, select: { id: true, isClosed: true } });
}

/**
 * A2 + D12. Una sola definición de período cerrado. Pasos:
 * 1. settings = lockAccountingSettingsTx (lock FOR UPDATE de la fila de la empresa,
 *    la misma que actualiza nextEntryNumberTx).
 * 2. fy = findFiscalYearForDateTx; si no hay:
 *      MONTHLY y lockedUntilDate cubre la fecha (por día UTC) → BusinessError LOCKED_UNTIL
 *      si no → fy = ensureFiscalYearTx(tx, settings, date)
 * 3. period = MONTHLY {fy, monthKeyUtc(date)} | {fy, type} para OPENING/CLOSING;
 *    si falta → ensurePeriodsTx y se relee.
 * 4. evaluatePeriodClosure → BusinessError(buildPeriodClosedMessage(…)).
 * 5. Devuelve { fiscalYearId, fiscalYearNumber, periodId }.
 */
export async function assertPeriodOpen(
  tx: Tx,
  companyId: string,
  date: Date,
  opts?: AssertPeriodOpenOptions
): Promise<OpenPeriodRef> {
  const periodType = opts?.periodType ?? 'MONTHLY';
  const settings = await lockAccountingSettingsTx(tx, companyId);

  let fiscalYear = await findFiscalYearForDateTx(tx, companyId, date);
  if (!fiscalYear) {
    if (
      periodType === 'MONTHLY' &&
      settings.lockedUntilDate &&
      isOnOrBeforeDayUtc(date, settings.lockedUntilDate)
    ) {
      throw new BusinessError(
        buildPeriodClosedMessage({
          date,
          reason: 'LOCKED_UNTIL',
          periodType,
          fiscalYearNumber: 0,
          lockedUntilDate: settings.lockedUntilDate,
          subject: opts?.subject,
        })
      );
    }
    fiscalYear = await ensureFiscalYearTx(tx, settings, date);
  }

  let period = await findPeriodTx(tx, fiscalYear.id, date, periodType);
  if (!period) {
    await ensurePeriodsTx(tx, fiscalYear);
    period = await findPeriodTx(tx, fiscalYear.id, date, periodType);
  }
  if (!period) {
    throw new Error(`No se pudo resolver el período ${periodType} del ejercicio ${fiscalYear.id}`);
  }

  const closure = evaluatePeriodClosure({
    date,
    periodType,
    fiscalYear,
    period,
    lockedUntilDate: settings.lockedUntilDate,
  });
  if (closure.closed) {
    throw new BusinessError(
      buildPeriodClosedMessage({
        date,
        reason: closure.reason,
        periodType,
        fiscalYearNumber: fiscalYear.number,
        lockedUntilDate: settings.lockedUntilDate,
        subject: opts?.subject,
      })
    );
  }

  return { fiscalYearId: fiscalYear.id, fiscalYearNumber: fiscalYear.number, periodId: period.id };
}

/** Lista ordenada (FY.number, year, month) de MONTHLY con su FY. */
export async function listMonthlyPeriodsTx(tx: Tx, companyId: string): Promise<MonthlyPeriodRow[]> {
  const periods = await tx.accountingPeriod.findMany({
    where: { type: 'MONTHLY', fiscalYear: { companyId } },
    orderBy: [{ fiscalYear: { number: 'asc' } }, { year: 'asc' }, { month: 'asc' }],
    select: {
      id: true,
      year: true,
      month: true,
      isClosed: true,
      fiscalYear: { select: { id: true, number: true, isClosed: true } },
    },
  });
  return periods.map((p) => ({
    periodId: p.id,
    year: p.year,
    month: p.month,
    isClosed: p.isClosed,
    fiscalYearId: p.fiscalYear.id,
    fiscalYearNumber: p.fiscalYear.number,
    fiscalYearClosed: p.fiscalYear.isClosed,
  }));
}

/**
 * lockedUntilDate = endOfMonthUtc del último MONTHLY de la racha cerrada desde el
 * primer mes del primer FY (FY cerrado cuenta como todo cerrado), o NULL.
 * Escribe solo si cambia. Toma el lock (reentrante).
 */
export async function syncLockedUntilDateTx(tx: Tx, companyId: string): Promise<Date | null> {
  const settings = await lockAccountingSettingsTx(tx, companyId);
  const months = await listMonthlyPeriodsTx(tx, companyId);

  let lastClosed: MonthlyPeriodRow | null = null;
  for (const month of months) {
    if (!month.isClosed && !month.fiscalYearClosed) break;
    lastClosed = month;
  }
  const lockedUntilDate = lastClosed ? endOfMonthUtc(lastClosed) : null;

  if ((settings.lockedUntilDate?.getTime() ?? null) !== (lockedUntilDate?.getTime() ?? null)) {
    await tx.accountingSettings.update({ where: { companyId }, data: { lockedUntilDate } });
  }
  return lockedUntilDate;
}
