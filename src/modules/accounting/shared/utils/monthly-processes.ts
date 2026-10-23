/**
 * Procesos mensuales registrados que dependen de los comprobantes de un mes (TSK-792, §5).
 *
 * La liquidación de IVA, el ajuste por inflación y la diferencia de cambio se calculan sobre
 * los comprobantes del mes: corregir uno de esos comprobantes los deja desactualizados. El
 * motor de corrección los busca acá para avisarlo en la propuesta.
 *
 * Sin `'use server'`: no es un endpoint invocable desde el navegador.
 */
import 'server-only';

import type { JournalEntryProcess } from '@/generated/prisma/enums';

import type { Tx, YearMonth } from './journal-entry-types';
import { compareYearMonth, endOfMonthUtc, monthKeyUtc, startOfMonthUtc } from './utc-month';

export interface MonthlyProcessEntry {
  id: string;
  number: number;
  process: JournalEntryProcess;
  date: Date;
  description: string;
}

/** Meses UTC distintos de las fechas, en orden. */
function distinctMonths(dates: readonly Date[]): YearMonth[] {
  const byKey = new Map<string, YearMonth>();
  for (const date of dates) {
    const ym = monthKeyUtc(date);
    byKey.set(`${ym.year}-${ym.month}`, ym);
  }
  return [...byKey.values()].sort(compareYearMonth);
}

/**
 * Asientos POSTED con `process` no nulo, de la empresa, cuyo mes (día de negocio UTC)
 * coincide con alguno de `dates`. Los anulados (REVERSED) y los borradores no cuentan.
 * Ordenados por fecha y número.
 */
export async function findMonthlyProcessEntriesTx(
  tx: Tx,
  companyId: string,
  dates: readonly Date[]
): Promise<MonthlyProcessEntry[]> {
  const months = distinctMonths(dates);
  if (months.length === 0) return [];

  const entries = await tx.journalEntry.findMany({
    where: {
      companyId,
      status: 'POSTED',
      process: { not: null },
      OR: months.map((ym) => ({ date: { gte: startOfMonthUtc(ym), lte: endOfMonthUtc(ym) } })),
    },
    select: { id: true, number: true, process: true, date: true, description: true },
    orderBy: [{ date: 'asc' }, { number: 'asc' }],
  });

  // `process: { not: null }` no estrecha el tipo: se filtra para que el resultado lo refleje.
  return entries.flatMap((entry) => (entry.process ? [{ ...entry, process: entry.process }] : []));
}
