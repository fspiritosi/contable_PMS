import { describe, expect, it } from 'vitest';

import { valuationSchema } from './validators';

const FY = '11111111-1111-4111-8111-111111111111';
const H1 = '22222222-2222-4222-8222-222222222222';
const H2 = '33333333-3333-4333-8333-333333333333';

const messages = (input: unknown) => {
  const result = valuationSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('valuationSchema (TSK-793)', () => {
  it('acepta una línea con valor al cierre y otra con precio por nominal', () => {
    const result = valuationSchema.safeParse({
      fiscalYearId: FY,
      lines: [
        { holdingId: H1, valuedAmount: '1200.50' },
        { holdingId: H2, unitPrice: '9.123456' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('trata los campos vacíos como no cargados', () => {
    const result = valuationSchema.safeParse({
      fiscalYearId: FY,
      lines: [{ holdingId: H1, valuedAmount: '', unitPrice: '9' }],
    });
    expect(result.success && result.data.lines[0]).toEqual({ holdingId: H1, unitPrice: '9' });
  });

  it('admite valor al cierre 0 (la tenencia no vale nada)', () => {
    expect(messages({ fiscalYearId: FY, lines: [{ holdingId: H1, valuedAmount: '0' }] })).toEqual(
      []
    );
  });

  it('exige uno de los dos valores en cada línea', () => {
    expect(messages({ fiscalYearId: FY, lines: [{ holdingId: H1 }] })).toEqual([
      'Cargá el valor al cierre o el precio por nominal',
    ]);
  });

  it('rechaza las dos cosas a la vez', () => {
    expect(
      messages({ fiscalYearId: FY, lines: [{ holdingId: H1, valuedAmount: '10', unitPrice: '1' }] })
    ).toEqual(['Cargá el valor al cierre o el precio por nominal']);
  });

  it('valida el formato del valor (2 decimales) y del precio (6 decimales)', () => {
    expect(
      messages({ fiscalYearId: FY, lines: [{ holdingId: H1, valuedAmount: '10.123' }] })
    ).toEqual(['Valor al cierre inválido']);
    expect(messages({ fiscalYearId: FY, lines: [{ holdingId: H1, unitPrice: '-1' }] })).toEqual([
      'Precio por nominal inválido',
    ]);
  });

  it('rechaza tenencias repetidas y ids inválidos', () => {
    expect(
      messages({
        fiscalYearId: FY,
        lines: [
          { holdingId: H1, valuedAmount: '10' },
          { holdingId: H1, valuedAmount: '20' },
        ],
      })
    ).toEqual(['Hay tenencias repetidas']);
    expect(messages({ fiscalYearId: 'x', lines: [] })).toEqual(['Elegí el ejercicio']);
  });
});
