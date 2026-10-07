import { describe, expect, it } from 'vitest';

import { reconcileDocumentEntryAmounts } from './document-entry-rounding';

const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

describe('reconcileDocumentEntryAmounts (TSK-760, R-1)', () => {
  it('sin diferencia devuelve los mismos importes', () => {
    const result = reconcileDocumentEntryAmounts({
      documentTotal: 1210,
      documentVat: 210,
      net: [1000],
      vat: [210],
      other: [],
      documentLineCount: 1,
    });
    expect(result).toEqual({ net: [1000], vat: [210] });
  });

  it('dos líneas de $1,07 al 21%: el IVA del asiento pasa de 0,44 a 0,45 (el del comprobante)', () => {
    const result = reconcileDocumentEntryAmounts({
      documentTotal: 2.59,
      documentVat: 0.45,
      net: [2.14],
      vat: [0.44],
      other: [],
      documentLineCount: 2,
    });
    expect(result.vat).toEqual([0.45]);
    expect(result.net).toEqual([2.14]);
  });

  it('dos alícuotas: la diferencia va a la línea de IVA de mayor importe', () => {
    const result = reconcileDocumentEntryAmounts({
      documentTotal: 2.48,
      documentVat: 0.34,
      net: [2.14],
      vat: [0.11, 0.22], // 10,5% y 21%
      other: [],
      documentLineCount: 2,
    });
    expect(result.vat).toEqual([0.11, 0.23]);
    expect(sum(result.vat)).toBe(0.34);
  });

  it('diferencia negativa: también descuenta de la de mayor importe', () => {
    const result = reconcileDocumentEntryAmounts({
      documentTotal: 100.0,
      documentVat: 17.35,
      net: [82.65],
      vat: [10.0, 7.36],
      other: [],
      documentLineCount: 3,
    });
    expect(result.vat).toEqual([9.99, 7.36]);
  });

  it('respeta percepciones e impuestos internos sin tocarlos', () => {
    const result = reconcileDocumentEntryAmounts({
      documentTotal: 2.59 + 1.5 + 0.3,
      documentVat: 0.45,
      net: [2.14],
      vat: [0.44],
      other: [1.5, 0.3],
      documentLineCount: 2,
    });
    expect(result.vat).toEqual([0.45]);
    expect(result.net).toEqual([2.14]);
  });

  it('el neto absorbe el redondeo del subtotal (cantidades fraccionarias en compras), en la línea mayor', () => {
    // Dos líneas de 0,5 × $1,01 = 0,505 → 0,51 cada una en la línea; el
    // comprobante suma antes de redondear: subtotal y total 1,01.
    const result = reconcileDocumentEntryAmounts({
      documentTotal: 1.01,
      documentVat: 0,
      net: [0.51, 0.51],
      vat: [],
      other: [],
      documentLineCount: 2,
    });
    expect(result.net).toEqual([0.5, 0.51]);
    expect(sum(result.net)).toBe(1.01);
  });

  it('IVA y neto a la vez: el asiento suma exactamente el total', () => {
    const result = reconcileDocumentEntryAmounts({
      documentTotal: 1.23,
      documentVat: 0.21,
      net: [0.51, 0.51],
      vat: [0.22],
      other: [],
      documentLineCount: 2,
    });
    expect(result.vat).toEqual([0.21]);
    expect(sum([...result.net, ...result.vat])).toBe(1.23);
  });

  it('una diferencia mayor que el redondeo posible no se absorbe (la rechaza el núcleo)', () => {
    // P. ej. un descuento global que el asiento no contempla: no es redondeo.
    const input = {
      documentTotal: 108.9,
      documentVat: 18.9,
      net: [100],
      vat: [21],
      other: [],
      documentLineCount: 2,
    };
    expect(reconcileDocumentEntryAmounts(input)).toEqual({ net: [100], vat: [21] });
  });

  it('no deja una línea de IVA en cero o negativa', () => {
    const result = reconcileDocumentEntryAmounts({
      documentTotal: 1.0,
      documentVat: 0,
      net: [1.0],
      vat: [0.01],
      other: [],
      documentLineCount: 1,
    });
    expect(result.vat).toEqual([0.01]);
  });

  it('sin líneas de IVA no inventa una', () => {
    const result = reconcileDocumentEntryAmounts({
      documentTotal: 2.14,
      documentVat: 0,
      net: [2.14],
      vat: [],
      other: [],
      documentLineCount: 2,
    });
    expect(result).toEqual({ net: [2.14], vat: [] });
  });
});
