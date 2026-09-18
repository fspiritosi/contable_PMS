import { describe, expect, it } from 'vitest';

import { partnerSchema } from './validators';

/**
 * TSK-717: cuenta contable de aportes por socio. El campo es opcional y
 * admite `null` (el `AccountCombobox` emite `null` al limpiar, no `''`).
 */
describe('partnerSchema', () => {
  const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  it('acepta un socio solo con nombre, sin cuenta de aportes', () => {
    const result = partnerSchema.safeParse({ name: 'Socia fundadora' });

    expect(result.success).toBe(true);
    expect(result.data?.contributionsAccountId).toBeUndefined();
  });

  it('acepta contributionsAccountId en null (usar la cuenta por defecto)', () => {
    const result = partnerSchema.safeParse({
      name: 'Socia fundadora',
      contributionsAccountId: null,
    });

    expect(result.success).toBe(true);
    expect(result.data?.contributionsAccountId).toBeNull();
  });

  it('acepta un uuid válido como cuenta de aportes', () => {
    const result = partnerSchema.safeParse({
      name: 'Socia fundadora',
      contributionsAccountId: uuid,
    });

    expect(result.success).toBe(true);
    expect(result.data?.contributionsAccountId).toBe(uuid);
  });

  it('rechaza una cuenta de aportes que no es uuid', () => {
    const result = partnerSchema.safeParse({
      name: 'Socia fundadora',
      contributionsAccountId: 'abc',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['contributionsAccountId']);
    expect(result.error?.issues[0]?.message).toBe('Cuenta contable inválida');
  });

  it('sigue rechazando un socio sin nombre (regresión)', () => {
    const result = partnerSchema.safeParse({ name: '', contributionsAccountId: uuid });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['name']);
    expect(result.error?.issues[0]?.message).toBe('El nombre es requerido');
  });
});
