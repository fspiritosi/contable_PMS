/**
 * Tests de la validación pura de líneas de asiento (TSK-760, C5, diseño §3.3.4).
 *
 * La validación es la misma para DRAFT y POSTED: ≥ 2 líneas, cada línea con
 * importe en un solo lado, sin negativos ni no finitos, y balance con tolerancia
 * de 0,01 calculado con `Decimal` (no con coma flotante).
 */
import { describe, expect, it } from 'vitest';

import { Prisma } from '@/generated/prisma/browser';
import type { Amount } from './journal-entry-types';

import { invertLines, validateEntryLines, type JournalEntryLineDraft } from './journal-entry-lines';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

const debit = (amount: Amount, accountId = A): JournalEntryLineDraft => ({
  accountId,
  debit: amount,
  credit: 0,
});
const credit = (amount: Amount, accountId = B): JournalEntryLineDraft => ({
  accountId,
  debit: 0,
  credit: amount,
});

describe('validateEntryLines', () => {
  it('asiento balanceado → devuelve los totales', () => {
    const totals = validateEntryLines([debit(1500), credit(1000), credit(500)]);
    expect(totals.debit.toFixed(2)).toBe('1500.00');
    expect(totals.credit.toFixed(2)).toBe('1500.00');
  });

  it('una sola línea → rechaza', () => {
    expect(() => validateEntryLines([debit(100)])).toThrow('Un asiento debe tener al menos 2 líneas.');
  });

  it('sin líneas → rechaza', () => {
    expect(() => validateEntryLines([])).toThrow('Un asiento debe tener al menos 2 líneas.');
  });

  it('línea 0/0 → rechaza nombrando la línea', () => {
    expect(() => validateEntryLines([debit(100), credit(100), { accountId: A, debit: 0, credit: 0 }])).toThrow(
      'La línea 3 no tiene importe en el Debe ni en el Haber.'
    );
  });

  it('importe negativo → rechaza nombrando la línea', () => {
    expect(() => validateEntryLines([debit(100), credit(100), debit(-5)])).toThrow(
      'La línea 3 tiene un importe inválido: los montos deben ser números positivos.'
    );
  });

  it('NaN o Infinity → rechaza nombrando la línea', () => {
    expect(() => validateEntryLines([debit(Number.NaN), credit(100)])).toThrow(
      'La línea 1 tiene un importe inválido: los montos deben ser números positivos.'
    );
    expect(() => validateEntryLines([debit(100), credit(Number.POSITIVE_INFINITY)])).toThrow(
      'La línea 2 tiene un importe inválido: los montos deben ser números positivos.'
    );
  });

  it('importe en ambos lados → rechaza nombrando la línea', () => {
    expect(() =>
      validateEntryLines([debit(100), credit(100), { accountId: A, debit: 10, credit: 10 }])
    ).toThrow('La línea 3 tiene importe en el Debe y en el Haber; cada línea va en uno solo.');
  });

  it('desbalance → texto actual con Debe, Haber y Diferencia', () => {
    expect(() => validateEntryLines([debit(1500), credit(1499)])).toThrow(
      'El asiento no está balanceado. Debe: $1500.00, Haber: $1499.00, Diferencia: $1.00'
    );
  });

  it('desbalance de 0,01 rechaza y de 0,009 pasa', () => {
    expect(() => validateEntryLines([debit(100.01), credit(100)])).toThrow(/no está balanceado/);
    expect(() => validateEntryLines([debit(100.009), credit(100)])).not.toThrow();
  });

  it('0.1 + 0.2 contra 0.3 balancea (Decimal, sin error de coma flotante)', () => {
    const totals = validateEntryLines([debit(0.1), debit(0.2), credit(0.3)]);
    expect(totals.debit.equals(totals.credit)).toBe(true);
  });

  it('acepta Decimal de Prisma como importe', () => {
    expect(() =>
      validateEntryLines([debit(new Prisma.Decimal('250.50')), credit(new Prisma.Decimal('250.50'))])
    ).not.toThrow();
  });

  it('los errores son BusinessError (llegan legibles al usuario)', () => {
    try {
      validateEntryLines([debit(1)]);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).name).toBe('BusinessError');
    }
  });
});

describe('invertLines', () => {
  it('invierte Debe y Haber conservando auxiliares, centro de costo y moneda', () => {
    const lines: JournalEntryLineDraft[] = [
      {
        accountId: A,
        debit: 1200,
        credit: 0,
        description: 'Venta USD',
        customerId: 'cust-1',
        supplierId: null,
        costCenterId: 'cc-1',
        currency: 'USD',
        originalAmount: 1,
        exchangeRate: 1200,
      },
      {
        accountId: B,
        debit: 0,
        credit: 1200,
        description: null,
        customerId: null,
        supplierId: 'sup-1',
        costCenterId: null,
      },
    ];

    const inverted = invertLines(lines);

    expect(inverted).toEqual([
      { ...lines[0], debit: 0, credit: 1200 },
      { ...lines[1], debit: 1200, credit: 0 },
    ]);
    // No muta la entrada.
    expect(lines[0].debit).toBe(1200);
  });
});
