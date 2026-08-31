import { describe, expect, it } from 'vitest';

import { sumLines, validateLines, type FundMovementLineInput } from './lines-calc';

const CUENTA_A = '11111111-1111-4111-8111-111111111111';
const CUENTA_B = '22222222-2222-4222-8222-222222222222';

const linea = (over: Partial<FundMovementLineInput> = {}): FundMovementLineInput => ({
  accountId: CUENTA_A,
  description: 'Sircreb IIBB',
  amount: '100.00',
  ...over,
});

describe('suma de los conceptos', () => {
  it('suma las líneas con centavos sin arrastrar error de punto flotante', () => {
    const lineas = [
      linea({ amount: '302574.16' }),
      linea({ amount: '1434154.28', accountId: CUENTA_B }),
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
    expect(validateLines([linea(), linea({ accountId: CUENTA_B })])).toBeNull();
  });

  it('exige al menos una línea', () => {
    expect(validateLines([])).toEqual({ index: -1, error: 'NO_LINES' });
  });

  it('exige cuenta, y dice en qué línea falta', () => {
    expect(validateLines([linea(), linea({ accountId: '' })])).toEqual({
      index: 1,
      error: 'MISSING_ACCOUNT',
    });
  });

  it('exige descripción', () => {
    expect(validateLines([linea({ description: '' })])).toEqual({
      index: 0,
      error: 'MISSING_DESCRIPTION',
    });
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
    const resultado = validateLines([linea({ description: '' }), linea({ accountId: '' })]);

    expect(resultado).toEqual({ index: 0, error: 'MISSING_DESCRIPTION' });
  });
});
