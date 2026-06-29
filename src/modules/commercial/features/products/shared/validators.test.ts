import { describe, expect, it } from 'vitest';
import { createProductSchema, updateProductSchema } from './validators';

describe('createProductSchema', () => {
  const baseProduct = {
    name: 'Producto de prueba',
    type: 'PRODUCT' as const,
    costPrice: 100,
    salePrice: 150,
  };

  it('valida un producto basico sin campos contables', () => {
    const result = createProductSchema.safeParse(baseProduct);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultExpenseAccountId).toBeUndefined();
      expect(result.data.defaultIncomeAccountId).toBeUndefined();
      expect(result.data.defaultCostCenterId).toBeUndefined();
      expect(result.data.defaultWarehouseId).toBeUndefined();
      expect(result.data.defaultSupplierId).toBeUndefined();
    }
  });

  it('acepta campos contables opcionales con UUIDs validos', () => {
    const expenseId = '550e8400-e29b-41d4-a716-446655440001';
    const incomeId = '550e8400-e29b-41d4-a716-446655440002';
    const costCenterId = '550e8400-e29b-41d4-a716-446655440003';
    const warehouseId = '550e8400-e29b-41d4-a716-446655440004';
    const supplierId = '550e8400-e29b-41d4-a716-446655440005';

    const result = createProductSchema.safeParse({
      ...baseProduct,
      defaultExpenseAccountId: expenseId,
      defaultIncomeAccountId: incomeId,
      defaultCostCenterId: costCenterId,
      defaultWarehouseId: warehouseId,
      defaultSupplierId: supplierId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultExpenseAccountId).toBe(expenseId);
      expect(result.data.defaultIncomeAccountId).toBe(incomeId);
      expect(result.data.defaultCostCenterId).toBe(costCenterId);
      expect(result.data.defaultWarehouseId).toBe(warehouseId);
      expect(result.data.defaultSupplierId).toBe(supplierId);
    }
  });

  it('rechaza UUIDs invalidos en campos contables', () => {
    const result = createProductSchema.safeParse({
      ...baseProduct,
      defaultExpenseAccountId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('transforma strings vacios a undefined en campos contables', () => {
    const result = createProductSchema.safeParse({
      ...baseProduct,
      defaultExpenseAccountId: '',
      defaultIncomeAccountId: '',
      defaultCostCenterId: '',
      defaultWarehouseId: '',
      defaultSupplierId: '',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultExpenseAccountId).toBeUndefined();
      expect(result.data.defaultIncomeAccountId).toBeUndefined();
      expect(result.data.defaultCostCenterId).toBeUndefined();
      expect(result.data.defaultWarehouseId).toBeUndefined();
      expect(result.data.defaultSupplierId).toBeUndefined();
    }
  });

  it('acepta combinacion parcial de campos contables', () => {
    const expenseId = '550e8400-e29b-41d4-a716-446655440001';
    const result = createProductSchema.safeParse({
      ...baseProduct,
      defaultExpenseAccountId: expenseId,
      // Otros campos contables no proporcionados
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultExpenseAccountId).toBe(expenseId);
      expect(result.data.defaultIncomeAccountId).toBeUndefined();
    }
  });
});

describe('updateProductSchema', () => {
  it('permite actualizar solo campos contables', () => {
    const expenseId = '550e8400-e29b-41d4-a716-446655440001';
    const result = updateProductSchema.safeParse({
      defaultExpenseAccountId: expenseId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultExpenseAccountId).toBe(expenseId);
    }
  });

  it('permite limpiar campos contables con strings vacios', () => {
    const result = updateProductSchema.safeParse({
      defaultExpenseAccountId: '',
      defaultIncomeAccountId: '',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultExpenseAccountId).toBeUndefined();
      expect(result.data.defaultIncomeAccountId).toBeUndefined();
    }
  });
});
