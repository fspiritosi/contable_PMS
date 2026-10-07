/**
 * Mes y día calendario en UTC (TSK-760, D8/B22, diseño §3.3.1).
 *
 * Todo cálculo de mes, rango y comparación de días del núcleo contable se hace
 * en UTC con `moment.utc`, para que el resultado no dependa de la zona horaria
 * del servidor (dev en UTC-3, producción en UTC). Puro: se puede usar en cliente.
 */
import moment from 'moment';

import { BusinessError } from '@/shared/lib/action-result';

import type { IsoDay, YearMonth } from './journal-entry-types';

const ISO_DAY_FORMAT = 'YYYY-MM-DD';
const ISO_DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function toUtcMoment(date: Date | IsoDay): moment.Moment {
  return typeof date === 'string' ? moment.utc(parseIsoDay(date)) : moment.utc(date);
}

/** Día calendario UTC de la fecha: 'YYYY-MM-DD'. */
export function toUtcDay(date: Date): IsoDay {
  return moment.utc(date).format(ISO_DAY_FORMAT);
}

/** 'YYYY-MM-DD' → 00:00:00.000Z. Lanza `BusinessError` si el día no es válido. */
export function parseIsoDay(day: IsoDay): Date {
  const parsed = moment.utc(day, ISO_DAY_FORMAT, true);
  if (!ISO_DAY_REGEX.test(day) || !parsed.isValid()) {
    throw new BusinessError(`Fecha inválida: ${day}. Usá el formato AAAA-MM-DD.`);
  }
  return parsed.toDate();
}

/** 00:00:00.000Z del día UTC. */
export function startOfDayUtc(date: Date | IsoDay): Date {
  return toUtcMoment(date).startOf('day').toDate();
}

/** 23:59:59.999Z del día UTC. */
export function endOfDayUtc(date: Date | IsoDay): Date {
  return toUtcMoment(date).endOf('day').toDate();
}

/** Mes calendario UTC de la fecha. */
export function monthKeyUtc(date: Date): YearMonth {
  const m = moment.utc(date);
  return { year: m.year(), month: m.month() + 1 };
}

/** Día 1 del mes, 00:00:00.000Z. */
export function startOfMonthUtc(ym: YearMonth): Date {
  return moment.utc({ year: ym.year, month: ym.month - 1, day: 1 }).toDate();
}

/** Último día del mes, 23:59:59.999Z. */
export function endOfMonthUtc(ym: YearMonth): Date {
  return moment.utc({ year: ym.year, month: ym.month - 1, day: 1 }).endOf('month').toDate();
}

/** Suma (o resta, con `n` negativo) meses calendario. */
export function addMonths(ym: YearMonth, n: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + n;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/** < 0 si `a` es anterior a `b`, 0 si es el mismo mes, > 0 si es posterior. */
export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

/** Meses calendario UTC entre dos fechas, ambos extremos incluidos (FY irregulares incluidos). */
export function monthsBetweenUtc(start: Date, end: Date): YearMonth[] {
  const last = monthKeyUtc(end);
  const months: YearMonth[] = [];
  for (let ym = monthKeyUtc(start); compareYearMonth(ym, last) <= 0; ym = addMonths(ym, 1)) {
    months.push(ym);
  }
  return months;
}

/** `a` cae el mismo día UTC que `b` o antes (ignora la hora). */
export function isOnOrBeforeDayUtc(a: Date, b: Date): boolean {
  return toUtcDay(a) <= toUtcDay(b);
}

/** 'MM/YYYY'. */
export function formatMonth(ym: YearMonth): string {
  return `${String(ym.month).padStart(2, '0')}/${ym.year}`;
}

/** 'mar 2026'. */
export function formatMonthLabel(ym: YearMonth): string {
  return `${MONTH_LABELS[ym.month - 1]} ${ym.year}`;
}

/** 'DD/MM/YYYY' del día UTC. */
export function formatDayUtc(date: Date | IsoDay): string {
  return toUtcMoment(date).format('DD/MM/YYYY');
}
