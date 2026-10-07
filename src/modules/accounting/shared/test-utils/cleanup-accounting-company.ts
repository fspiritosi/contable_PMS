/**
 * Limpieza contable de una empresa de test (TSK-760, R7, diseño §3.7.1).
 *
 * Solo para tests de integración (no termina en `.test.ts`: Vitest no lo corre).
 *
 * Los asientos POSTED/REVERSED son inmutables por trigger
 * (`trg_journal_entry_immutable`) y, desde TSK-760, el primer asiento de una
 * empresa crea su ejercicio y sus períodos (`ensureFiscalYearTx`). Borrar la
 * empresa directamente dispararía el `SET NULL` de `journal_entries.fiscal_year_id`
 * sobre asientos POSTED y el trigger lo rechazaría. Por eso, en una transacción
 * con `SET LOCAL session_replication_role = 'replica'` (alcance: esta conexión y
 * este bloque), se borran líneas, asientos, períodos y ejercicios de la empresa.
 *
 * Con `replica` tampoco corren las cascadas de FK: por eso se borra explícitamente
 * cada tabla, de hijos a padres. El llamador borra después los documentos que
 * apuntan a asientos (antes de llamar), Ajustes, cuentas y la empresa.
 */
import { prisma } from '@/shared/lib/prisma';

export async function cleanupAccountingCompany(companyId: string): Promise<void> {
  // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
  if (!companyId) return;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.journalEntryLine.deleteMany({ where: { entry: { companyId } } });
    await tx.journalEntry.deleteMany({ where: { companyId } });
    await tx.accountingPeriod.deleteMany({ where: { fiscalYear: { companyId } } });
    await tx.fiscalYear.deleteMany({ where: { companyId } });
  });
}
