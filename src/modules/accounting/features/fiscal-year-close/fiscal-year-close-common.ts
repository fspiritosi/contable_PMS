/**
 * Tipos y claves del cierre anual compartidos entre servidor y cliente (TSK-760, Fase 9,
 * diseño §3.3.9). Puro: sin `server-only`.
 */
import type { ClosingLine } from '../../shared/utils/fiscal-year-close-math';
import type { IsoDay } from '../../shared/utils/journal-entry-types';

export type { ClosingLine };

export interface FiscalYearSummary {
  id: string;
  number: number;
  startDay: IsoDay;
  endDay: IsoDay;
}

export interface ClosePreview {
  fiscalYear: FiscalYearSummary;
  /** Fecha de la apertura (día siguiente al fin del ejercicio). */
  openingDay: IsoDay;
  closingLines: ClosingLine[];
  openingLines: ClosingLine[];
  totalRevenue: number;
  totalExpense: number;
  netResult: number;
}

export interface PendingDraftsMonth {
  /** 'MM/YYYY'. */
  month: string;
  count: number;
  /** Primeros 5 números del mes. */
  numbers: number[];
}

export interface FiscalYearCloseStatus {
  /** Ejercicio abierto más antiguo. `id: null` = empresa todavía sin ejercicios (desde Ajustes). */
  fiscalYear: (Omit<FiscalYearSummary, 'id'> & { id: string | null }) | null;
  lastClosed: {
    number: number;
    closingEntryNumber: number | null;
    openingEntryNumber: number | null;
    closedAt: IsoDay | null;
  } | null;
  resultAccountName: string | null;
  /** Meses del ejercicio todavía abiertos, 'MM/YYYY' en orden. */
  openMonths: string[];
  pendingDrafts: PendingDraftsMonth[];
  canClose: boolean;
}

export const FISCAL_YEAR_CLOSE_PREVIEW_QUERY_KEY = ['accounting', 'fiscalYearClosePreview'] as const;

export const PERIOD_LOCK_HREF = '/dashboard/company/accounting/settings#bloqueo-periodos';
export const ENTRIES_HREF = '/dashboard/company/accounting/entries';
