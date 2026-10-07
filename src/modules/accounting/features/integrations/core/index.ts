/**
 * Núcleo contable para otros módulos (TSK-760, D9, diseño §3.1.1).
 *
 * `commercial/` (tesorería) y `equipment/` (depreciación) importan de acá, igual
 * que hoy importan de `integrations/commercial` y `integrations/equipment`, sin
 * depender de la estructura interna de `accounting/shared/utils`.
 *
 * Solo servidor: los helpers reciben el cliente transaccional del llamador.
 */
export {
  createJournalEntryTx,
  postJournalEntryTx,
  type CreateJournalEntryTxInput,
  type CreatedJournalEntry,
  type PostJournalEntryTxInput,
} from '@/modules/accounting/shared/utils/journal-entry-tx';
export {
  assertPeriodOpen,
  type AssertPeriodOpenOptions,
  type OpenPeriodRef,
} from '@/modules/accounting/shared/utils/period-lock';
export type { JournalEntryLineDraft } from '@/modules/accounting/shared/utils/journal-entry-lines';
export type { EntryPeriodType, Tx } from '@/modules/accounting/shared/utils/journal-entry-types';
