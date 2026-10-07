/**
 * Validación pura de las líneas de un asiento (TSK-760, C5/B21, diseño §3.3.4).
 *
 * La misma regla para DRAFT y POSTED: ≥ 2 líneas, cada línea con importe en un
 * solo lado, sin negativos ni no finitos, y balance con tolerancia de 0,01. Las
 * sumas se hacen con `Decimal` (no con coma flotante). Puro: usable en cliente.
 */
import type { Prisma as PrismaTypes } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/browser';
import { BusinessError } from '@/shared/lib/action-result';

import type { Amount } from './journal-entry-types';

export interface JournalEntryLineDraft {
  accountId: string;
  debit: Amount;
  credit: Amount;
  description?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  costCenterId?: string | null; // TSK-583/719
  currency?: string; // default 'ARS'
  originalAmount?: Amount | null;
  exchangeRate?: Amount | null;
}

export interface LineTotals {
  debit: PrismaTypes.Decimal;
  credit: PrismaTypes.Decimal;
}

const BALANCE_TOLERANCE = new Prisma.Decimal('0.01');

/**
 * `Amount` → `Decimal`. Un `Decimal` de otra copia del runtime (cliente vs.
 * navegador) no pasa el `instanceof` de decimal.js: se reconstruye desde su texto.
 */
function toDecimal(amount: Amount): PrismaTypes.Decimal {
  return typeof amount === 'number' ? new Prisma.Decimal(amount) : new Prisma.Decimal(amount.toString());
}

/** Suma con `Decimal`. Lanza `BusinessError` con el primer problema. */
export function validateEntryLines(lines: readonly JournalEntryLineDraft[]): LineTotals {
  if (lines.length < 2) {
    throw new BusinessError('Un asiento debe tener al menos 2 líneas.');
  }

  let debitTotal = new Prisma.Decimal(0);
  let creditTotal = new Prisma.Decimal(0);

  lines.forEach((line, index) => {
    const n = index + 1;
    const debit = toDecimal(line.debit);
    const credit = toDecimal(line.credit);

    if (!debit.isFinite() || !credit.isFinite() || debit.isNegative() || credit.isNegative()) {
      throw new BusinessError(
        `La línea ${n} tiene un importe inválido: los montos deben ser números positivos.`
      );
    }
    if (debit.gt(0) && credit.gt(0)) {
      throw new BusinessError(
        `La línea ${n} tiene importe en el Debe y en el Haber; cada línea va en uno solo.`
      );
    }
    if (debit.isZero() && credit.isZero()) {
      throw new BusinessError(`La línea ${n} no tiene importe en el Debe ni en el Haber.`);
    }

    debitTotal = debitTotal.plus(debit);
    creditTotal = creditTotal.plus(credit);
  });

  const difference = debitTotal.minus(creditTotal).abs();
  if (difference.gte(BALANCE_TOLERANCE)) {
    throw new BusinessError(
      `El asiento no está balanceado. Debe: $${debitTotal.toFixed(2)}, ` +
        `Haber: $${creditTotal.toFixed(2)}, Diferencia: $${difference.toFixed(2)}`
    );
  }

  return { debit: debitTotal, credit: creditTotal };
}

/** Invierte debe/haber conservando todas las demás columnas (reversión). */
export function invertLines(lines: readonly JournalEntryLineDraft[]): JournalEntryLineDraft[] {
  return lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit }));
}
