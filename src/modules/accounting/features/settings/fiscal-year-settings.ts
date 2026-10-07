/**
 * Ejercicio fiscal en Ajustes (TSK-760, Fase 3: B23, D11, C3).
 *
 * - Guardar Ajustes por primera vez (o en una empresa con Ajustes y sin ejercicios) crea el
 *   ejercicio N° 1 con sus períodos: ya no nacen empresas sin `FiscalYear` (B2/B23).
 * - Las fechas solo se pueden cambiar mientras la empresa no tenga asientos ni meses o
 *   ejercicios cerrados (C3); en ese caso se regeneran los períodos del ejercicio N° 1 en la
 *   misma transacción y se descartan los ejercicios siguientes (vacíos).
 * - `accounting_settings.fiscal_year_start/end` queda siempre igual al ejercicio abierto más
 *   antiguo (D11).
 *
 * `server-only`, sin `'use server'` (H7): la lógica no queda expuesta como endpoint.
 */
import 'server-only';

import { BusinessError } from '@/shared/lib/action-result';

import type { IsoDay, Tx } from '../../shared/utils/journal-entry-types';
import {
  createFiscalYearWithPeriodsTx,
  ensurePeriodsTx,
  lockAccountingSettingsTx,
} from '../../shared/utils/period-lock';
import { endOfDayUtc, startOfDayUtc, toUtcDay } from '../../shared/utils/utc-month';
import { validateFiscalYearRange, type FiscalYearSettingsView } from './validators';

const FY_SELECT = {
  id: true,
  number: true,
  startDate: true,
  endDate: true,
  isClosed: true,
} as const;

/** Sin asientos, sin meses cerrados y sin ejercicios cerrados (C3/D11). */
async function datesEditableTx(tx: Tx, companyId: string): Promise<boolean> {
  const [entries, closedPeriods, closedYears] = await Promise.all([
    tx.journalEntry.count({ where: { companyId } }),
    tx.accountingPeriod.count({ where: { fiscalYear: { companyId }, isClosed: true } }),
    tx.fiscalYear.count({ where: { companyId, isClosed: true } }),
  ]);
  return entries === 0 && closedPeriods === 0 && closedYears === 0;
}

/** Vista del formulario: ejercicio abierto más antiguo (o el rango de Ajustes si no hay). */
export async function buildFiscalYearSettingsTx(
  tx: Tx,
  companyId: string
): Promise<FiscalYearSettingsView | null> {
  const settings = await tx.accountingSettings.findUnique({
    where: { companyId },
    select: { fiscalYearStart: true, fiscalYearEnd: true },
  });
  if (!settings) return null;

  const fiscalYears = await tx.fiscalYear.findMany({
    where: { companyId },
    orderBy: { number: 'asc' },
    select: FY_SELECT,
  });
  const current = fiscalYears.find((fy) => !fy.isClosed) ?? fiscalYears.at(-1);
  return {
    fiscalYearNumber: current?.number ?? 1,
    startDay: toUtcDay(current?.startDate ?? settings.fiscalYearStart),
    endDay: toUtcDay(current?.endDate ?? settings.fiscalYearEnd),
    datesEditable: await datesEditableTx(tx, companyId),
  };
}

/**
 * Guarda las fechas del ejercicio. Valida el rango (C3), toma el lock de Ajustes (se
 * serializa con la creación de asientos) y:
 * - sin ejercicios → crea el N° 1 (con asientos viejos también: todavía no tienen ejercicio);
 * - mismas fechas que el ejercicio abierto más antiguo → no cambia nada;
 * - fechas nuevas → solo si `datesEditableTx`; si no, `BusinessError`.
 */
export async function saveFiscalYearSettingsTx(
  tx: Tx,
  input: { companyId: string; startDay: IsoDay; endDay: IsoDay }
): Promise<{ fiscalYearNumber: number }> {
  const { companyId, startDay, endDay } = input;
  const invalid = validateFiscalYearRange(startDay, endDay);
  if (invalid) throw new BusinessError(invalid);

  const range = { fiscalYearStart: startOfDayUtc(startDay), fiscalYearEnd: endOfDayUtc(endDay) };
  await tx.accountingSettings.upsert({
    where: { companyId },
    create: { companyId, ...range },
    update: {},
  });
  await lockAccountingSettingsTx(tx, companyId);

  const fiscalYears = await tx.fiscalYear.findMany({
    where: { companyId },
    orderBy: { number: 'asc' },
    select: FY_SELECT,
  });

  if (fiscalYears.length === 0) {
    await createFiscalYearWithPeriodsTx(tx, { companyId, number: 1, startDay, endDay });
    await tx.accountingSettings.update({ where: { companyId }, data: range });
    return { fiscalYearNumber: 1 };
  }

  const current = fiscalYears.find((fy) => !fy.isClosed) ?? fiscalYears[fiscalYears.length - 1];
  if (toUtcDay(current.startDate) === startDay && toUtcDay(current.endDate) === endDay) {
    await tx.accountingSettings.update({
      where: { companyId },
      data: { fiscalYearStart: current.startDate, fiscalYearEnd: current.endDate },
    });
    return { fiscalYearNumber: current.number };
  }

  if (!(await datesEditableTx(tx, companyId))) {
    throw new BusinessError(
      `No se pueden cambiar las fechas del ejercicio N° ${current.number}: la empresa ya tiene ` +
        'asientos o meses cerrados. Las fechas cambian solas al cerrar el ejercicio.'
    );
  }

  // Sin asientos ni cierres: el N° 1 toma las fechas nuevas y se regeneran sus períodos;
  // los siguientes (vacíos, p. ej. creados por la migración) se descartan.
  const [first, ...rest] = fiscalYears;
  await tx.fiscalYear.deleteMany({ where: { id: { in: rest.map((fy) => fy.id) } } });
  await tx.accountingPeriod.deleteMany({ where: { fiscalYearId: first.id } });
  const updated = await tx.fiscalYear.update({
    where: { id: first.id },
    data: { startDate: range.fiscalYearStart, endDate: range.fiscalYearEnd },
    select: FY_SELECT,
  });
  await ensurePeriodsTx(tx, updated);
  await tx.accountingSettings.update({ where: { companyId }, data: range });
  return { fiscalYearNumber: updated.number };
}
