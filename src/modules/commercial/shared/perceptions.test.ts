import { describe, expect, it } from 'vitest';

import {
  calculateOtherTaxes,
  derivePerceptionRate,
  perceptionLabel,
  toPerceptionRecords,
  totalPerceptions,
} from './perceptions';

/**
 * Los importes de la factura de La Anónima que adjunta el TSK-644:
 * Percep. NQN $1.832,43 · Percep. IVA $4.128,01 · IMP. INTERNOS $326,95
 * sobre netos de $91.957,84 (21%) y $91.284,86 (10,5%).
 */
const NETO_GRAVADO = 91957.84 + 91284.86; // 183242.70
const PERCEP_NQN = '1832.43';
const PERCEP_IVA = '4128.01';
const IMP_INTERNOS = '326.95';

describe('tasa derivada de una percepción', () => {
  it('deriva la alícuota de base y monto', () => {
    expect(derivePerceptionRate(1000, 30)).toBe(3);
    expect(derivePerceptionRate(1000, 15)).toBe(1.5);
  });

  it('redondea a tres decimales, la precisión del modelo', () => {
    // 1832.43 / 183242.70 = 0.9999...% → 1.000
    expect(derivePerceptionRate(NETO_GRAVADO, 1832.43)).toBe(1);
    expect(derivePerceptionRate(183242.7, 4128.01)).toBe(2.253);
  });

  it('devuelve cero si la base no es utilizable', () => {
    expect(derivePerceptionRate(0, 100)).toBe(0);
    expect(derivePerceptionRate(-500, 100)).toBe(0);
    expect(derivePerceptionRate(NaN, 100)).toBe(0);
    expect(derivePerceptionRate(1000, NaN)).toBe(0);
  });

  it('un monto de centavos sobre una base grande redondea a cero', () => {
    expect(derivePerceptionRate(1000, 0.01)).toBe(0.001);
    expect(derivePerceptionRate(1000000, 0.01)).toBe(0);
  });
});

describe('suma de percepciones', () => {
  it('suma los importes de la factura del ticket', () => {
    expect(
      totalPerceptions([{ amount: PERCEP_NQN }, { amount: PERCEP_IVA }])
    ).toBe(5960.44);
  });

  it('acepta importes numéricos además de texto', () => {
    expect(totalPerceptions([{ amount: 100.5 }, { amount: '200.25' }])).toBe(
      300.75
    );
  });

  it('ignora las entradas a medio tipear en vez de propagar NaN', () => {
    expect(totalPerceptions([{ amount: '' }, { amount: PERCEP_NQN }])).toBe(
      1832.43
    );
    expect(totalPerceptions([{ amount: '1832.' }])).toBe(1832);
  });

  it('sin percepciones vale cero', () => {
    expect(totalPerceptions([])).toBe(0);
  });
});

describe('otros tributos del comprobante', () => {
  it('suma percepciones e impuestos internos de la factura del ticket', () => {
    expect(
      calculateOtherTaxes(
        [{ amount: PERCEP_NQN }, { amount: PERCEP_IVA }],
        IMP_INTERNOS
      )
    ).toBe(6287.39);
  });

  it('reconstruye el total del comprobante del ticket', () => {
    const vatAmount = 19311.15 + 9584.91; // 28896.06
    const otherTaxes = calculateOtherTaxes(
      [{ amount: PERCEP_NQN }, { amount: PERCEP_IVA }],
      IMP_INTERNOS
    );
    const total = Math.round((NETO_GRAVADO + vatAmount + otherTaxes) * 100) / 100;

    // El ticket imprime $218.426,14: un centavo menos, por el redondeo del IVA
    // en el emisor. El sistema no fuerza el total al del comprobante.
    expect(total).toBe(218426.15);
  });

  it('sin impuestos internos devuelve solo las percepciones', () => {
    expect(calculateOtherTaxes([{ amount: PERCEP_NQN }], undefined)).toBe(
      1832.43
    );
    expect(calculateOtherTaxes([{ amount: PERCEP_NQN }], '')).toBe(1832.43);
    expect(calculateOtherTaxes([{ amount: PERCEP_NQN }], null)).toBe(1832.43);
  });

  it('sin tributos de ningún tipo vale cero', () => {
    expect(calculateOtherTaxes([], undefined)).toBe(0);
  });

  it('acepta impuestos internos sin percepciones', () => {
    expect(calculateOtherTaxes([], IMP_INTERNOS)).toBe(326.95);
  });
});

describe('percepciones listas para persistir', () => {
  it('convierte importes a número y deriva la tasa', () => {
    const records = toPerceptionRecords([
      {
        type: 'IIBB',
        jurisdiction: 'NQN',
        baseAmount: String(NETO_GRAVADO),
        amount: PERCEP_NQN,
      },
    ]);

    expect(records).toEqual([
      {
        type: 'IIBB',
        jurisdiction: 'NQN',
        rate: 1,
        baseAmount: NETO_GRAVADO,
        amount: 1832.43,
      },
    ]);
  });

  it('normaliza una jurisdicción vacía a null', () => {
    const [sinJurisdiccion] = toPerceptionRecords([
      { type: 'IVA', jurisdiction: '   ', baseAmount: '1000', amount: '30' },
    ]);

    expect(sinJurisdiccion.jurisdiction).toBeNull();
  });
});

describe('etiqueta de una percepción', () => {
  it('incluye la jurisdicción cuando existe', () => {
    expect(perceptionLabel({ type: 'IIBB', jurisdiction: 'NQN' })).toBe(
      'Percepción IIBB NQN'
    );
  });

  it('omite la jurisdicción cuando no hay', () => {
    expect(perceptionLabel({ type: 'IVA', jurisdiction: null })).toBe(
      'Percepción IVA'
    );
    expect(perceptionLabel({ type: 'MUNICIPAL' })).toBe('Percepción Municipal');
  });
});
