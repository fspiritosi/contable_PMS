/**
 * Tests del cálculo puro del cierre anual (TSK-760, Fase 9: B20, B21, C4, H5; diseño §3.3.9).
 *
 * - Refundición: cada cuenta de resultado con saldo va al lado contrario y la diferencia
 *   a la cuenta Resultado del Ejercicio, que se omite cuando da 0 (ingresos = gastos, H5).
 * - Apertura: saldos patrimoniales más el efecto de la refundición sobre Resultado (B21):
 *   siempre balancea.
 * - Sumas con `Decimal` y redondeo a centavos.
 */
import { describe, expect, it } from 'vitest';

import { Prisma } from '@/generated/prisma/browser';

import {
  buildClosingLines,
  buildOpeningLines,
  summarizeResults,
  type AccountBalanceRow,
  type AccountRef,
  type ClosingLine,
} from './fiscal-year-close-math';
import { validateEntryLines } from './journal-entry-lines';

const RESULT: AccountRef = { id: 'res', code: '3.2.1', name: 'Resultado del Ejercicio' };

const row = (
  accountId: string,
  code: string,
  type: AccountBalanceRow['type'],
  debit: number | string,
  credit: number | string
): AccountBalanceRow => ({
  accountId,
  code,
  name: `Cuenta ${code}`,
  type,
  debit: typeof debit === 'string' ? new Prisma.Decimal(debit) : debit,
  credit: typeof credit === 'string' ? new Prisma.Decimal(credit) : credit,
});

const simplify = (lines: ClosingLine[]) =>
  lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit }));

const sum = (lines: ClosingLine[], side: 'debit' | 'credit') =>
  Math.round(lines.reduce((s, l) => s + l[side], 0) * 100) / 100;

describe('buildClosingLines (refundición)', () => {
  it('ganancia: ingresos al Debe, gastos al Haber y el resultado al Haber de Resultado', () => {
    const lines = buildClosingLines(
      [row('ventas', '4.1', 'REVENUE', 0, 1000), row('cmv', '5.1', 'EXPENSE', 600, 0)],
      RESULT
    );

    expect(simplify(lines)).toEqual([
      { accountId: 'ventas', debit: 1000, credit: 0 },
      { accountId: 'cmv', debit: 0, credit: 600 },
      { accountId: 'res', debit: 0, credit: 400 },
    ]);
    expect(lines[0]).toMatchObject({ accountCode: '4.1', accountName: 'Cuenta 4.1' });
    expect(lines[2]).toMatchObject({ accountCode: '3.2.1', accountName: 'Resultado del Ejercicio' });
    expect(() => validateEntryLines(lines)).not.toThrow();
  });

  it('pérdida: el resultado va al Debe de Resultado', () => {
    const lines = buildClosingLines(
      [row('ventas', '4.1', 'REVENUE', 0, 300), row('gastos', '5.2', 'EXPENSE', 500, 0)],
      RESULT
    );

    expect(simplify(lines)).toEqual([
      { accountId: 'ventas', debit: 300, credit: 0 },
      { accountId: 'gastos', debit: 0, credit: 500 },
      { accountId: 'res', debit: 200, credit: 0 },
    ]);
    expect(() => validateEntryLines(lines)).not.toThrow();
  });

  it('ingresos = gastos: sin línea de Resultado (nunca una línea 0/0, H5/B20)', () => {
    const lines = buildClosingLines(
      [row('ventas', '4.1', 'REVENUE', 0, 500), row('gastos', '5.2', 'EXPENSE', 500, 0)],
      RESULT
    );

    expect(simplify(lines)).toEqual([
      { accountId: 'ventas', debit: 500, credit: 0 },
      { accountId: 'gastos', debit: 0, credit: 500 },
    ]);
    expect(lines.every((l) => l.debit > 0 || l.credit > 0)).toBe(true);
    expect(() => validateEntryLines(lines)).not.toThrow();
  });

  it('sin resultados: devuelve [] (sin línea suelta de Resultado, B20)', () => {
    expect(buildClosingLines([], RESULT)).toEqual([]);
  });

  it('cuentas con saldo 0 (movimientos que se compensan) no generan línea', () => {
    expect(
      buildClosingLines(
        [row('ventas', '4.1', 'REVENUE', 250, 250), row('gastos', '5.2', 'EXPENSE', '10.00', '10.00')],
        RESULT
      )
    ).toEqual([]);
  });

  it('ignora cuentas patrimoniales aunque vengan en la lista', () => {
    const lines = buildClosingLines(
      [row('caja', '1.1', 'ASSET', 900, 0), row('ventas', '4.1', 'REVENUE', 0, 100)],
      RESULT
    );
    expect(lines.map((l) => l.accountId)).toEqual(['ventas', 'res']);
  });

  it('un ingreso con saldo deudor (devoluciones) se cancela al Haber', () => {
    const lines = buildClosingLines(
      [row('ventas', '4.1', 'REVENUE', 0, 1000), row('devol', '4.9', 'REVENUE', 80, 0)],
      RESULT
    );
    expect(simplify(lines)).toEqual([
      { accountId: 'ventas', debit: 1000, credit: 0 },
      { accountId: 'devol', debit: 0, credit: 80 },
      { accountId: 'res', debit: 0, credit: 920 },
    ]);
  });

  it('ordena por código de cuenta', () => {
    const lines = buildClosingLines(
      [row('b', '5.2', 'EXPENSE', 10, 0), row('a', '4.1', 'REVENUE', 0, 30), row('c', '5.1', 'EXPENSE', 5, 0)],
      RESULT
    );
    expect(lines.map((l) => l.accountCode)).toEqual(['4.1', '5.1', '5.2', '3.2.1']);
  });

  it('redondeo: suma con Decimal (0,1 + 0,2 = 0,3) y residuos menores a medio centavo no generan línea', () => {
    const lines = buildClosingLines(
      [
        row('ventas', '4.1', 'REVENUE', 0, '0.30'),
        row('gastos', '5.2', 'EXPENSE', 0.1 + 0.2, 0), // 0.30000000000000004 en float
      ],
      RESULT
    );
    expect(simplify(lines)).toEqual([
      { accountId: 'ventas', debit: 0.3, credit: 0 },
      { accountId: 'gastos', debit: 0, credit: 0.3 },
    ]);
  });

  it('importes con centavos: los totales balancean exacto', () => {
    const lines = buildClosingLines(
      [
        row('v1', '4.1', 'REVENUE', 0, '1234.56'),
        row('v2', '4.2', 'REVENUE', '0.01', '99.99'),
        row('g1', '5.1', 'EXPENSE', '333.33', 0),
        row('g2', '5.2', 'EXPENSE', '0.07', 0),
      ],
      RESULT
    );
    expect(lines.find((l) => l.accountId === 'res')).toMatchObject({ debit: 0, credit: 1001.14 });
    expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'));
  });
});

describe('buildOpeningLines (apertura, B21)', () => {
  const patrimonial = [
    row('caja', '1.1', 'ASSET', 2000, 600),
    row('capital', '3.1', 'EQUITY', 0, 1000),
  ];

  it('suma el resultado de la refundición a la cuenta Resultado y balancea', () => {
    const closing = buildClosingLines(
      [row('ventas', '4.1', 'REVENUE', 0, 1000), row('cmv', '5.1', 'EXPENSE', 600, 0)],
      RESULT
    );
    const opening = buildOpeningLines(patrimonial, closing, RESULT);

    expect(simplify(opening)).toEqual([
      { accountId: 'caja', debit: 1400, credit: 0 },
      { accountId: 'capital', debit: 0, credit: 1000 },
      { accountId: 'res', debit: 0, credit: 400 },
    ]);
    expect(() => validateEntryLines(opening)).not.toThrow();
  });

  it('pérdida: Resultado queda deudor en la apertura', () => {
    const closing = buildClosingLines(
      [row('ventas', '4.1', 'REVENUE', 0, 300), row('gastos', '5.2', 'EXPENSE', 500, 0)],
      RESULT
    );
    const opening = buildOpeningLines(
      [row('caja', '1.1', 'ASSET', 1300, 500), row('capital', '3.1', 'EQUITY', 0, 1000)],
      closing,
      RESULT
    );
    expect(simplify(opening)).toEqual([
      { accountId: 'caja', debit: 800, credit: 0 },
      { accountId: 'capital', debit: 0, credit: 1000 },
      { accountId: 'res', debit: 200, credit: 0 },
    ]);
    expect(() => validateEntryLines(opening)).not.toThrow();
  });

  it('Resultado con saldo previo (resultados anteriores) se fusiona en una sola línea', () => {
    const closing = buildClosingLines(
      [row('ventas', '4.1', 'REVENUE', 0, 400)],
      RESULT
    );
    const opening = buildOpeningLines(
      [
        row('caja', '1.1', 'ASSET', 1500, 0),
        row('capital', '3.1', 'EQUITY', 0, 1000),
        row('res', '3.2.1', 'EQUITY', 0, 100),
      ],
      closing,
      RESULT
    );
    expect(simplify(opening)).toEqual([
      { accountId: 'caja', debit: 1500, credit: 0 },
      { accountId: 'capital', debit: 0, credit: 1000 },
      { accountId: 'res', debit: 0, credit: 500 },
    ]);
    expect(() => validateEntryLines(opening)).not.toThrow();
  });

  it('resultado 0: sin línea de Resultado y sin cuentas en cero', () => {
    const closing = buildClosingLines(
      [row('ventas', '4.1', 'REVENUE', 0, 500), row('gastos', '5.2', 'EXPENSE', 500, 0)],
      RESULT
    );
    const opening = buildOpeningLines(
      [
        row('caja', '1.1', 'ASSET', 1000, 0),
        row('banco', '1.2', 'ASSET', 300, 300),
        row('capital', '3.1', 'EQUITY', 0, 1000),
      ],
      closing,
      RESULT
    );
    expect(simplify(opening)).toEqual([
      { accountId: 'caja', debit: 1000, credit: 0 },
      { accountId: 'capital', debit: 0, credit: 1000 },
    ]);
  });

  it('ignora cuentas de resultado que vengan en la lista patrimonial', () => {
    const opening = buildOpeningLines(
      [row('caja', '1.1', 'ASSET', 100, 0), row('ventas', '4.1', 'REVENUE', 0, 100)],
      [],
      RESULT
    );
    expect(opening.map((l) => l.accountId)).toEqual(['caja']);
  });

  it('sin saldos patrimoniales ni refundición: []', () => {
    expect(buildOpeningLines([], [], RESULT)).toEqual([]);
  });

  it('ordena por código e incluye Resultado aunque no tenga saldo previo', () => {
    const closing = buildClosingLines([row('ventas', '4.1', 'REVENUE', 0, 50)], RESULT);
    const opening = buildOpeningLines(
      [row('caja', '1.1', 'ASSET', 50, 0), row('a', '2.1', 'LIABILITY', 0, 0)],
      closing,
      RESULT
    );
    expect(opening.map((l) => l.accountCode)).toEqual(['1.1', '3.2.1']);
    expect(opening[1]).toMatchObject({ accountName: 'Resultado del Ejercicio', credit: 50 });
  });
});

describe('summarizeResults', () => {
  it('ingresos y gastos netos, y resultado', () => {
    expect(
      summarizeResults([
        row('ventas', '4.1', 'REVENUE', 0, 1000),
        row('devol', '4.9', 'REVENUE', 80, 0),
        row('cmv', '5.1', 'EXPENSE', 600, 0),
        row('caja', '1.1', 'ASSET', 999, 0),
      ])
    ).toEqual({ totalRevenue: 920, totalExpense: 600, netResult: 320 });
  });

  it('sin resultados: todo en cero', () => {
    expect(summarizeResults([])).toEqual({ totalRevenue: 0, totalExpense: 0, netResult: 0 });
  });
});
