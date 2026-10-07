/**
 * Ayudas de período para tests de integración (TSK-760, fase 5).
 *
 * Solo para tests (no termina en `.test.ts`: Vitest no lo corre). Quien lo importe
 * tiene que mockear `server-only` (lo importa `period-lock.ts`).
 *
 * Cierran un mes por `AccountingPeriod.isClosed` **sin** tocar `lockedUntilDate`
 * (escenario B3: hoy las integraciones solo miraban `lockedUntilDate`), creando el
 * ejercicio y sus períodos con el núcleo si todavía no existen.
 */
import { prisma } from '@/shared/lib/prisma';

import { assertPeriodOpen } from '../utils/period-lock';

/**
 * Cierra el MONTHLY que contiene `date` (por día UTC) y devuelve la función que lo
 * reabre. El mes tiene que estar abierto (si no, `assertPeriodOpen` lanza).
 */
export async function closeMonthForTest(companyId: string, date: Date): Promise<() => Promise<void>> {
  const { periodId } = await prisma.$transaction((tx) => assertPeriodOpen(tx, companyId, date));
  await prisma.accountingPeriod.update({
    where: { id: periodId },
    data: { isClosed: true, closedAt: new Date(), closedBy: 'test' },
  });
  return async () => {
    await prisma.accountingPeriod.update({
      where: { id: periodId },
      data: { isClosed: false, closedAt: null, closedBy: null },
    });
  };
}

/** Contador de numeración de la empresa (para verificar que un rechazo no consume número). */
export async function readLastEntryNumber(companyId: string): Promise<number> {
  const settings = await prisma.accountingSettings.findUniqueOrThrow({
    where: { companyId },
    select: { lastEntryNumber: true },
  });
  return settings.lastEntryNumber;
}

/** Ejercicio y período de un asiento, con el mes del período para comparar. */
export async function readEntryPeriod(entryId: string) {
  const entry = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: entryId },
    select: {
      number: true,
      status: true,
      createdBy: true,
      fiscalYearId: true,
      periodId: true,
      period: { select: { year: true, month: true, type: true, fiscalYearId: true } },
    },
  });
  return entry;
}
