/**
 * Definición pura de "período cerrado" (TSK-760, A2/D12, diseño §3.3.2).
 *
 * Una sola regla para todos los creadores de asientos: el OR de las tres
 * condiciones (ejercicio cerrado, período cerrado, `lockedUntilDate`). La usa
 * `assertPeriodOpen` (`period-lock.ts`) después de leer los datos con el lock
 * tomado. Puro: se puede usar en cliente.
 */
import type { EntryPeriodType } from './journal-entry-types';
import { formatDayUtc, formatMonth, isOnOrBeforeDayUtc, monthKeyUtc } from './utc-month';

export type PeriodClosureReason = 'FISCAL_YEAR' | 'PERIOD' | 'LOCKED_UNTIL';
export type PeriodClosure = { closed: false } | { closed: true; reason: PeriodClosureReason };

export interface PeriodClosureInput {
  date: Date;
  periodType: EntryPeriodType;
  fiscalYear: { number: number; isClosed: boolean };
  period: { isClosed: boolean };
  lockedUntilDate: Date | null;
}

/**
 * Precedencia: FY cerrado > período cerrado > lockedUntilDate. Con OPENING/CLOSING
 * (D12) solo cuentan FY y período de ese tipo; lockedUntilDate se ignora.
 * `lockedUntilDate` se compara por día calendario UTC.
 */
export function evaluatePeriodClosure(input: PeriodClosureInput): PeriodClosure {
  if (input.fiscalYear.isClosed) return { closed: true, reason: 'FISCAL_YEAR' };
  if (input.period.isClosed) return { closed: true, reason: 'PERIOD' };
  if (
    input.periodType === 'MONTHLY' &&
    input.lockedUntilDate &&
    isOnOrBeforeDayUtc(input.date, input.lockedUntilDate)
  ) {
    return { closed: true, reason: 'LOCKED_UNTIL' };
  }
  return { closed: false };
}

export interface PeriodClosedMessageInput {
  date: Date;
  reason: PeriodClosureReason;
  periodType: EntryPeriodType;
  fiscalYearNumber: number;
  lockedUntilDate: Date | null;
  /** Sujeto de la frase. Por defecto: `No se puede registrar con fecha DD/MM/YYYY`. */
  subject?: string;
}

const REOPEN_HINT = ' Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.';

/** Texto del rechazo. Siempre contiene "el período está cerrado" (lo afirman tests existentes). */
export function buildPeriodClosedMessage(input: PeriodClosedMessageInput): string {
  const subject = input.subject ?? `No se puede registrar con fecha ${formatDayUtc(input.date)}`;
  const n = input.fiscalYearNumber;

  let cause: string;
  let hint = '';
  if (input.reason === 'FISCAL_YEAR') {
    cause = `ejercicio N° ${n} cerrado`;
  } else if (input.reason === 'LOCKED_UNTIL') {
    cause = `bloqueado hasta ${input.lockedUntilDate ? formatDayUtc(input.lockedUntilDate) : '-'}`;
    hint = REOPEN_HINT;
  } else if (input.periodType === 'OPENING') {
    cause = `apertura del ejercicio N° ${n} cerrada`;
  } else if (input.periodType === 'CLOSING') {
    cause = `cierre del ejercicio N° ${n} cerrado`;
  } else {
    cause = `mes ${formatMonth(monthKeyUtc(input.date))} cerrado`;
    hint = REOPEN_HINT;
  }

  return `${subject}: el período está cerrado (${cause}).${hint}`;
}
