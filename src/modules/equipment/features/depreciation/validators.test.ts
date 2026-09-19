import { describe, expect, it } from 'vitest';

import { depreciationAccountsSchema, depreciationConfigSchema } from './validators';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('depreciationAccountsSchema (TSK-724c)', () => {
  it('acepta las tres cuentas como UUID, null o ausentes y normaliza a null', () => {
    const parsed = depreciationAccountsSchema.parse({
      fixedAssetAccountId: null,
      accumulatedDepreciationAccountId: UUID,
      depreciationExpenseAccountId: undefined,
    });
    expect(parsed).toEqual({
      fixedAssetAccountId: null,
      accumulatedDepreciationAccountId: UUID,
      depreciationExpenseAccountId: null,
    });
  });

  it('rechaza un id que no es UUID con un mensaje en español', () => {
    const result = depreciationAccountsSchema.safeParse({ fixedAssetAccountId: 'no-es-uuid' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toBe('La cuenta contable seleccionada no es válida');
  });
});

describe('depreciationConfigSchema (regresión)', () => {
  it('sigue aceptando la configuración sin cuentas', () => {
    const result = depreciationConfigSchema.safeParse({
      method: 'STRAIGHT_LINE',
      grossValue: 120000,
      salvageValue: 0,
      usefulLifeMonths: 12,
      startDate: '2026-01-01',
      depreciationRate: null,
    });
    expect(result.success).toBe(true);
  });
});
