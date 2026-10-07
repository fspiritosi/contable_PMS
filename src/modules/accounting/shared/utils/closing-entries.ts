/**
 * Exclusión de los asientos que genera el cierre anual (TSK-760, Fase 9: B18, B19, H4;
 * diseño §3.3.8, decisión D7 "por exclusión").
 *
 * El sistema calcula saldos acumulando todo lo POSTED hasta una fecha, sin asiento de cierre
 * patrimonial. Por eso:
 * - La **apertura generada por el cierre** (`fiscal_years.opening_entry_id`) volvería a sumar
 *   los saldos patrimoniales del ejercicio cerrado (B18): se excluye de todo saldo acumulado
 *   y de los movimientos por mes (Balance, Sumas y Saldos, Mayor, plan de cuentas, IVA,
 *   diferencia de cambio, inflación, saldos del propio cierre). Se ve solo en el Diario.
 * - La **refundición** (`fiscal_years.closing_entry_id`) dejaría en cero el resultado del
 *   ejercicio cerrado (B19): se excluye del Estado de Resultados, del presupuesto y de los
 *   movimientos por centro de costo.
 *
 * Invariante: `openingEntryId` solo lo escribe `closeFiscalYear`. El saldo de apertura cargado
 * a mano (Saldos de Apertura) no lo usa y cuenta como cualquier otro asiento.
 *
 * Los fragmentos SQL suponen el alias `je` para `journal_entries`. Solo constantes: sin
 * `server-only` para no obligar a mockearlo en los tests de reportes; lo importan únicamente
 * archivos de servidor.
 */
import { Prisma } from '@/generated/prisma/client';

/** Excluye la apertura generada por un cierre (alias de journal_entries = je). */
export const NOT_CLOSE_GENERATED_OPENING_SQL: Prisma.Sql = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM fiscal_years fyo WHERE fyo.opening_entry_id = je.id)`;

/** Excluye la refundición (alias de journal_entries = je). */
export const NOT_CLOSING_ENTRY_SQL: Prisma.Sql = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM fiscal_years fyc WHERE fyc.closing_entry_id = je.id)`;

/** Ídem `NOT_CLOSE_GENERATED_OPENING_SQL` para consultas Prisma sobre `JournalEntry`. */
export const notCloseGeneratedOpeningWhere: Prisma.JournalEntryWhereInput = {
  fiscalYearAsOpeningEntry: { is: null },
};

/** Ídem `NOT_CLOSING_ENTRY_SQL` para consultas Prisma sobre `JournalEntry`. */
export const notClosingEntryWhere: Prisma.JournalEntryWhereInput = {
  fiscalYearAsClosingEntry: { is: null },
};
