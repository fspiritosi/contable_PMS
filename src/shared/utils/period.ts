/**
 * Lleva una fecha al primer día de su mes, en UTC.
 *
 * El período de un índice es un mes, no un día. Guardarlo siempre como el día 1
 * es lo que hace que el unique `(indexId, period)` impida cargar dos veces el
 * mismo mes.
 */
export function toPeriodStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
