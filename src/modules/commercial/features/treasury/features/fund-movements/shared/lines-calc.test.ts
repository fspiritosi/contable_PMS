import { describe, expect, it } from 'vitest';

import {
  LINE_ERROR_MESSAGES,
  sumLines,
  validateLines,
  type FundMovementLineInput,
} from './lines-calc';

const CONCEPTO_A = '11111111-1111-4111-8111-111111111111';
const CONCEPTO_B = '22222222-2222-4222-8222-222222222222';

const linea = (over: Partial<FundMovementLineInput> = {}): FundMovementLineInput => ({
  conceptId: CONCEPTO_A,
  description: 'Sircreb IIBB',
  amount: '100.00',
  ...over,
});

describe('suma de los conceptos', () => {
  it('suma las líneas con centavos sin arrastrar error de punto flotante', () => {
    const lineas = [
      linea({ amount: '302574.16' }),
      linea({ amount: '1434154.28', conceptId: CONCEPTO_B }),
    ];

    // El caso real del ticket: 302.574,16 + 1.434.154,28 = 1.736.728,44
    expect(sumLines(lineas)).toBe(1736728.44);
  });

  it('una sola línea suma su propio importe', () => {
    expect(sumLines([linea({ amount: '1500.5' })])).toBe(1500.5);
  });

  it('sin líneas la suma es cero', () => {
    expect(sumLines([])).toBe(0);
  });
});

describe('validación de los conceptos', () => {
  it('acepta líneas completas', () => {
    expect(validateLines([linea(), linea({ conceptId: CONCEPTO_B })])).toBeNull();
  });

  it('exige al menos una línea', () => {
    expect(validateLines([])).toEqual({ index: -1, error: 'NO_LINES' });
  });

  it('exige concepto, y dice en qué línea falta (TSK-791)', () => {
    expect(validateLines([linea(), linea({ conceptId: '' })])).toEqual({
      index: 1,
      error: 'MISSING_CONCEPT',
    });
    expect(LINE_ERROR_MESSAGES.MISSING_CONCEPT).toBe('Elegí el concepto');
  });

  it('el detalle es opcional: una línea sin detalle es válida (TSK-791)', () => {
    expect(validateLines([linea({ description: '' }), linea({ description: '   ' })])).toBeNull();
  });

  it('exige importe mayor a cero', () => {
    expect(validateLines([linea({ amount: '0' })])).toEqual({
      index: 0,
      error: 'NON_POSITIVE_AMOUNT',
    });
  });

  it('rechaza un importe negativo: una devolución del banco no es una línea negativa', () => {
    expect(validateLines([linea({ amount: '-50' })])).toEqual({
      index: 0,
      error: 'NON_POSITIVE_AMOUNT',
    });
  });

  it('devuelve el primer problema, no todos', () => {
    const resultado = validateLines([linea({ amount: '0' }), linea({ conceptId: '' })]);

    expect(resultado).toEqual({ index: 0, error: 'NON_POSITIVE_AMOUNT' });
  });
});
