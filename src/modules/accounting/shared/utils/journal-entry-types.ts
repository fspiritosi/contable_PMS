/**
 * Tipos comunes del núcleo de asientos (TSK-760, diseño §3.3).
 *
 * Sin `server-only`: se pueden usar desde componentes cliente.
 */
import type { Prisma } from '@/generated/prisma/client';
import type { AccountingPeriodType, JournalEntryStatus } from '@/generated/prisma/enums';

/** Cliente transaccional. `prisma` también es asignable (para lecturas fuera de tx). */
export type Tx = Prisma.TransactionClient;

/** 'YYYY-MM-DD' (día calendario UTC). Es lo que viaja entre cliente y servidor. */
export type IsoDay = string;

/** Mes calendario; `month` va de 1 a 12. */
export interface YearMonth {
  year: number;
  month: number;
}

/** Tipos de período en los que se registran asientos (ADJUSTMENT no se usa). */
export type EntryPeriodType = Extract<AccountingPeriodType, 'MONTHLY' | 'OPENING' | 'CLOSING'>;

/** Estados con los que nace un asiento. */
export type CreatableEntryStatus = Extract<JournalEntryStatus, 'DRAFT' | 'POSTED'>;

/** Importe de una línea: número o `Decimal` de Prisma. */
export type Amount = number | Prisma.Decimal;
