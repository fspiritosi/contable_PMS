import { describe, expect, it } from 'vitest';

import { accountField, commercialIntegrationSchema } from './validators';

const CUENTA = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** Todos los campos del formulario, en su forma "sin asignar". */
const vacio = Object.fromEntries(
  Object.keys(commercialIntegrationSchema.shape).map((key) => [key, null])
);

describe('accountField', () => {
  it('conserva el id de la cuenta elegida', () => {
    expect(accountField.parse(CUENTA)).toBe(CUENTA);
  });

  it('normaliza a null los valores que significan "sin asignar"', () => {
    expect(accountField.parse('__clear__')).toBeNull();
    expect(accountField.parse('')).toBeNull();
    expect(accountField.parse(null)).toBeNull();
  });

  /**
   * Regresión de TSK-492: con `nullable()` un campo ausente hacía fallar la
   * validación de todo el formulario y, como no hay FormMessage, el botón
   * "Guardar" no hacía absolutamente nada ni mostraba error.
   */
  it('acepta un campo ausente en lugar de invalidar el formulario', () => {
    expect(accountField.parse(undefined)).toBeNull();
  });
});

describe('commercialIntegrationSchema', () => {
  it('valida el formulario completo', () => {
    expect(commercialIntegrationSchema.safeParse(vacio).success).toBe(true);
  });

  it('guarda las cuentas elegidas y limpia las vaciadas', () => {
    const result = commercialIntegrationSchema.parse({
      ...vacio,
      salesAccountId: CUENTA,
      partnerContributionsAccountId: CUENTA,
      purchasesAccountId: '__clear__',
    });

    expect(result.salesAccountId).toBe(CUENTA);
    expect(result.partnerContributionsAccountId).toBe(CUENTA);
    expect(result.purchasesAccountId).toBeNull();
  });

  it('no se rompe si faltan las cuentas de activos fijos (TSK-492)', () => {
    const ausentes = [
      'fixedAssetAccountId',
      'accumulatedDepreciationAccountId',
      'depreciationExpenseAccountId',
      'assetDisposalGainLossAccountId',
    ];
    const sinActivosFijos = Object.fromEntries(
      Object.entries(vacio).filter(([key]) => !ausentes.includes(key))
    );

    const result = commercialIntegrationSchema.safeParse({
      ...sinActivosFijos,
      partnerContributionsAccountId: CUENTA,
    });

    expect(result.success).toBe(true);
    expect(result.data?.fixedAssetAccountId).toBeNull();
    expect(result.data?.partnerContributionsAccountId).toBe(CUENTA);
  });

  it('cubre las 23 cuentas configurables', () => {
    expect(Object.keys(commercialIntegrationSchema.shape)).toHaveLength(23);
  });
});
