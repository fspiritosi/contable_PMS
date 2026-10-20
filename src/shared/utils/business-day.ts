/**
 * "Hoy" en la zona del negocio (TSK-760, D5 revisado; llevado a shared en TSK-782).
 *
 * El día calendario lo define Argentina, no la zona del proceso: producción corre en UTC y,
 * desde las 21:00 de Argentina, `new Date()` ya cae en el día siguiente en UTC. Puro: se puede
 * usar en cliente y en servidor.
 */

/** Zona horaria del negocio. Única fuente de esta constante. */
export const BUSINESS_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const businessDayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Día calendario de "hoy" en la zona del negocio ('YYYY-MM-DD'), sin depender de la
 * zona del proceso: a las 23:30 en Argentina (02:30Z del día siguiente) sigue siendo hoy.
 */
export function todayBusinessDay(now: Date = new Date()): string {
  const parts = businessDayFormatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
