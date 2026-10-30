import { describe, expect, it } from 'vitest';

import { salesGlobalDiscountFactor, salesVatByRate } from './sales-vat-by-rate';

const line = (vatRate: number, subtotal: number, vatAmount: number) => ({ vatRate, subtotal, vatAmount });

describe('salesVatByRate (TSK-762)', () => {
  it('sin descuento global: agrupa las líneas por alícuota', () => {
    expect(
      salesVatByRate({
        netTaxed: 1500,
        vatAmount: 262.5,
        lines: [line(21, 1000, 210), line(10.5, 500, 52.5)],
      })
    ).toEqual([
      { rate: 21, base: 1000, vat: 210 },
      { rate: 10.5, base: 500, vat: 52.5 },
    ]);
  });

  it('sin descuento, el IVA redondeado por línea se ajusta al del comprobante (dos de $1,07 al 21%)', () => {
    expect(
      salesVatByRate({
        netTaxed: 2.14,
        vatAmount: 0.45,
        lines: [line(21, 1.07, 0.22), line(21, 1.07, 0.22)],
      })
    ).toEqual([{ rate: 21, base: 2.14, vat: 0.45 }]);
  });

  it('descuento global del 10% sobre dos alícuotas: base e IVA con descuento', () => {
    expect(
      salesVatByRate({
        netTaxed: 1350,
        vatAmount: 236.25,
        globalDiscountPercent: 10,
        lines: [line(21, 1000, 210), line(10.5, 500, 52.5)],
      })
    ).toEqual([
      { rate: 21, base: 900, vat: 189 },
      { rate: 10.5, base: 450, vat: 47.25 },
    ]);
  });

  it('descuento en monto que no divide exacto: las bases suman el neto y los IVA el IVA del comprobante', () => {
    const result = salesVatByRate({
      netTaxed: 1400,
      vatAmount: 245,
      globalDiscountAmount: 100,
      lines: [line(21, 1000, 210), line(10.5, 500, 52.5)],
    });
    expect(result).toEqual([
      { rate: 21, base: 933.33, vat: 196 },
      { rate: 10.5, base: 466.67, vat: 49 },
    ]);
  });

  it('tres líneas de $333,33 con 7%: el centavo de redondeo va a la alícuota', () => {
    expect(
      salesVatByRate({
        netTaxed: 929.99,
        vatAmount: 195.3,
        globalDiscountPercent: 7,
        lines: [line(21, 333.33, 70), line(21, 333.33, 70), line(21, 333.33, 70)],
      })
    ).toEqual([{ rate: 21, base: 929.99, vat: 195.3 }]);
  });

  it('solo cuenta las líneas gravadas', () => {
    expect(
      salesVatByRate({
        netTaxed: 1000,
        vatAmount: 210,
        lines: [line(21, 1000, 210), { lineType: 'EXEMPT', vatRate: 0, subtotal: 300, vatAmount: 0 }],
      })
    ).toEqual([{ rate: 21, base: 1000, vat: 210 }]);
  });

  it('una diferencia que no es redondeo no se absorbe (dato inconsistente: se ve, no se esconde)', () => {
    expect(
      salesVatByRate({ netTaxed: 1000, vatAmount: 300, lines: [line(21, 1000, 210)] })
    ).toEqual([{ rate: 21, base: 1000, vat: 210 }]);
  });
});

describe('salesGlobalDiscountFactor (TSK-762)', () => {
  it('sin descuento global es 1, aunque el neto difiera por redondeo', () => {
    expect(salesGlobalDiscountFactor({ netTaxed: 2.14, lines: [line(21, 1.07, 0.22), line(21, 1.07, 0.22)] })).toBe(1);
  });

  it('con descuento es neto del comprobante / suma de netos de línea', () => {
    expect(
      salesGlobalDiscountFactor({ netTaxed: 1350, globalDiscountPercent: 10, lines: [line(21, 1500, 315)] })
    ).toBe(0.9);
  });
});
