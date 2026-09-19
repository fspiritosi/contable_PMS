import { describe, expect, it } from 'vitest';

import { vehicleTypeSchema } from './validators';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

const base = { name: 'Camión', hasHitch: false, isTractorUnit: false };

describe('vehicleTypeSchema (TSK-724c)', () => {
  it('rechaza un nombre de menos de 2 caracteres', () => {
    const result = vehicleTypeSchema.safeParse({ ...base, name: 'C' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['name']);
      expect(result.error.issues[0].message).toBe('El nombre debe tener al menos 2 caracteres');
    }
  });

  it('las tres cuentas son opcionales: ausentes quedan undefined', () => {
    const result = vehicleTypeSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fixedAssetAccountId).toBeUndefined();
      expect(result.data.accumulatedDepreciationAccountId).toBeUndefined();
      expect(result.data.depreciationExpenseAccountId).toBeUndefined();
    }
  });

  it('las tres cuentas aceptan null y lo conservan (sin asignar)', () => {
    const result = vehicleTypeSchema.safeParse({
      ...base,
      fixedAssetAccountId: null,
      accumulatedDepreciationAccountId: null,
      depreciationExpenseAccountId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fixedAssetAccountId).toBeNull();
      expect(result.data.accumulatedDepreciationAccountId).toBeNull();
      expect(result.data.depreciationExpenseAccountId).toBeNull();
    }
  });

  it('acepta las tres cuentas como UUID', () => {
    const result = vehicleTypeSchema.safeParse({
      ...base,
      fixedAssetAccountId: UUID_A,
      accumulatedDepreciationAccountId: UUID_B,
      depreciationExpenseAccountId: UUID_C,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fixedAssetAccountId).toBe(UUID_A);
      expect(result.data.accumulatedDepreciationAccountId).toBe(UUID_B);
      expect(result.data.depreciationExpenseAccountId).toBe(UUID_C);
    }
  });

  it.each([
    'fixedAssetAccountId',
    'accumulatedDepreciationAccountId',
    'depreciationExpenseAccountId',
  ] as const)('rechaza un valor que no es UUID en %s y lo señala en ese campo', (field) => {
    const result = vehicleTypeSchema.safeParse({ ...base, [field]: 'no-es-uuid' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual([field]);
    }
  });

  it('hasHitch e isTractorUnit siguen siendo booleanos obligatorios', () => {
    const sinHitch = vehicleTypeSchema.safeParse({ name: 'Camión', isTractorUnit: false });
    expect(sinHitch.success).toBe(false);
    if (!sinHitch.success) expect(sinHitch.error.issues[0].path).toEqual(['hasHitch']);

    const sinTractor = vehicleTypeSchema.safeParse({ name: 'Camión', hasHitch: false });
    expect(sinTractor.success).toBe(false);
    if (!sinTractor.success) expect(sinTractor.error.issues[0].path).toEqual(['isTractorUnit']);

    const conString = vehicleTypeSchema.safeParse({ ...base, hasHitch: 'si' });
    expect(conString.success).toBe(false);
  });
});
