/**
 * Conversión entre el valor de `<input type="date">` ('YYYY-MM-DD') y `Date` (TSK-782).
 *
 * Mientras un segmento está a medio tipear, el navegador reporta `''`. Convertir ese `''` en
 * `new Date('T12:00:00')` da una fecha inválida que vacía el input: por eso acá un texto vacío,
 * incompleto o que no es un día real devuelve `null`, nunca un `Date` inválido.
 *
 * Dos convenciones conviven y ninguna se cambia:
 * - `'local'`: ese día a las 12:00 locales (formularios comerciales).
 * - `'utc'`: ese día a las 00:00:00.000Z (núcleo contable, D8 de TSK-760).
 */
import moment from 'moment';

import { todayBusinessDay } from './business-day';

export type DateInputMode = 'local' | 'utc';

const INPUT_FORMAT = 'YYYY-MM-DD';

/** Fecha → 'YYYY-MM-DD' para `<input type="date">`; '' si no hay fecha o es inválida. */
export function toDateInputValue(date: Date | null | undefined, mode: DateInputMode = 'local'): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  return (mode === 'utc' ? moment.utc(date) : moment(date)).format(INPUT_FORMAT);
}

/** 'YYYY-MM-DD' del input → fecha; null si está vacío, incompleto o no es un día real. */
export function fromDateInputValue(value: string, mode: DateInputMode = 'local'): Date | null {
  if (!value) return null;
  if (mode === 'utc') {
    const day = moment.utc(value, INPUT_FORMAT, true);
    return day.isValid() ? day.toDate() : null;
  }
  const day = moment(value, INPUT_FORMAT, true);
  return day.isValid() ? day.hour(12).toDate() : null;
}

/**
 * "Hoy" en Argentina con la convención del modo, para la fecha por defecto de un formulario.
 * No usar `new Date()`: guarda la hora actual y, desde las 21:00 de Argentina, en UTC ya es el
 * día siguiente (el asiento queda fechado mañana; a fin de mes, en el período siguiente).
 */
export function businessToday(mode: DateInputMode = 'local', now: Date = new Date()): Date {
  return fromDateInputValue(todayBusinessDay(now), mode) as Date;
}
