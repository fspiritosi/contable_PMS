/**
 * Tipos y textos del cierre y la reapertura de meses (TSK-760, Fase 8, diseño §3.3.5).
 *
 * Puro y sin `server-only`: lo usan las actions, el núcleo de cierre y los
 * componentes cliente del panel "Bloqueo de Períodos".
 */
import type { IsoDay, YearMonth } from '../../shared/utils/journal-entry-types';
import { formatMonth } from '../../shared/utils/utc-month';

export interface PeriodMonthStatus extends YearMonth {
  /** 'mar 2026' */
  label: string;
  isClosed: boolean;
  draftCount: number;
  /** Solo el primer mes abierto se cierra y solo el último cerrado (de un ejercicio abierto) se reabre. */
  action: 'close' | 'reopen' | null;
}

export interface PeriodLockFiscalYear {
  /** `null` cuando la empresa todavía no tiene ejercicios: se arma desde Ajustes y se crea al cerrar. */
  id: string | null;
  number: number;
  startDay: IsoDay;
  endDay: IsoDay;
  months: PeriodMonthStatus[];
}

export interface PeriodLockStatus {
  /** Ejercicio abierto más antiguo y el siguiente si existe. */
  fiscalYears: PeriodLockFiscalYear[];
  lockedUntil: IsoDay | null;
  /** Piso de B5: último ejercicio cerrado (sus meses no se pueden reabrir). */
  lastClosedFiscalYear: { number: number; endDay: IsoDay } | null;
}

export const PERIOD_LOCK_STATUS_QUERY_KEY = ['accounting', 'periodLockStatus'] as const;

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** 'marzo 2026'. */
export function formatMonthLong(ym: YearMonth): string {
  return `${MONTH_NAMES[ym.month - 1]} ${ym.year}`;
}

/** Texto del botón de D2: "Registrar los 4 borradores y cerrar". */
export function postDraftsLabel(count: number): string {
  return count === 1
    ? 'Registrar el borrador y cerrar'
    : `Registrar los ${count} borradores y cerrar`;
}

const MAX_LISTED_NUMBERS = 5;

/**
 * `El mes 03/2026 tiene 4 borradores sin registrar (N° 12, 15, 18, 20). Registralos o elegí
 * "Registrar los 4 borradores y cerrar".` (hasta 5 números y `…`).
 */
export function draftsPendingMessage(ym: YearMonth, numbers: readonly number[]): string {
  const count = numbers.length;
  const listed = numbers.slice(0, MAX_LISTED_NUMBERS).join(', ');
  const more = count > MAX_LISTED_NUMBERS ? ', …' : '';
  const noun = count === 1 ? 'borrador sin registrar' : 'borradores sin registrar';
  const verb = count === 1 ? 'Registralo' : 'Registralos';
  return (
    `El mes ${formatMonth(ym)} tiene ${count} ${noun} (N° ${listed}${more}). ` +
    `${verb} o elegí "${postDraftsLabel(count)}".`
  );
}
