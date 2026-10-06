import { describe, expect, it } from 'vitest';

import { expenseCategoryFormSchema } from './validators';

/** TSK-757: la categoría de gasto puede llevar una cuenta contable propia (opcional). */
describe('expenseCategoryFormSchema', () => {
  it('V1: el nombre es obligatorio', () => {
    const result = expenseCategoryFormSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('El nombre es requerido');
  });

  it('V2: sin accountId es válido (en la edición = no tocar)', () => {
    expect(expenseCategoryFormSchema.safeParse({ name: 'Alquiler' }).success).toBe(true);
  });

  it('V3: accountId null es válido (usar la cuenta por defecto)', () => {
    const result = expenseCategoryFormSchema.safeParse({ name: 'Alquiler', accountId: null });
    expect(result.success).toBe(true);
    expect(result.data?.accountId).toBeNull();
  });

  it('V4: accountId con un UUID válido', () => {
    const accountId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const result = expenseCategoryFormSchema.safeParse({ name: 'Alquiler', accountId });
    expect(result.success).toBe(true);
    expect(result.data?.accountId).toBe(accountId);
  });

  it('V5: accountId que no es UUID falla', () => {
    const result = expenseCategoryFormSchema.safeParse({ name: 'Alquiler', accountId: 'abc' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Cuenta contable inválida');
  });
});
