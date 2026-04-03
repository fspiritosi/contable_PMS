import { z } from 'zod';
import { ProductType, ProductStatus } from '@/generated/prisma/enums';

// ============================================
// Helpers
// ============================================

/**
 * Helper para transformar strings vacíos a undefined (para campos opcionales)
 */
const emptyStringToUndefined = z
  .string()
  .optional()
  .transform((val) => (val === '' ? undefined : val));


// ============================================
// Category Validators
// ============================================

export const createCategorySchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(100),
  description: emptyStringToUndefined.pipe(z.string().max(500).optional()),
  parentId: emptyStringToUndefined.pipe(z.string().uuid().optional()),
});

export const updateCategorySchema = createCategorySchema.partial();

export type CreateCategoryFormData = z.infer<typeof createCategorySchema>;
export type UpdateCategoryFormData = z.infer<typeof updateCategorySchema>;

// ============================================
// Product Validators
// ============================================

export const createProductSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(200),
  description: emptyStringToUndefined.pipe(z.string().max(1000).optional()),
  type: z.nativeEnum(ProductType),
  categoryId: emptyStringToUndefined.pipe(z.string().uuid().optional()),
  unitOfMeasure: emptyStringToUndefined.pipe(z.string().max(20).optional()),
  costPrice: z.coerce.number().min(0, 'El precio de costo debe ser mayor o igual a 0'),
  salePrice: z.coerce.number().min(0, 'El precio de venta debe ser mayor o igual a 0'),
  vatRate: z.coerce.number().min(0).max(100).optional(),
  trackStock: z.boolean().optional(),
  minStock: z.coerce.number().min(0).optional(),
  maxStock: z.coerce.number().min(0).optional(),
  barcode: emptyStringToUndefined.pipe(z.string().max(50).optional()),
  internalCode: emptyStringToUndefined.pipe(z.string().max(50).optional()),
  brand: emptyStringToUndefined.pipe(z.string().max(100).optional()),
  model: emptyStringToUndefined.pipe(z.string().max(100).optional()),
  // Campos de industria AUTO_PARTS (triple codificación y equivalencias)
  oemCode: emptyStringToUndefined.pipe(z.string().max(100).optional()),
  auxiliaryCode: emptyStringToUndefined.pipe(z.string().max(100).optional()),
  productGroupId: emptyStringToUndefined.pipe(z.string().uuid().optional()),
});

export const updateProductSchema = createProductSchema.partial().extend({
  status: z.nativeEnum(ProductStatus).optional(),
});

export type CreateProductFormData = z.infer<typeof createProductSchema>;
export type UpdateProductFormData = z.infer<typeof updateProductSchema>;

// ============================================
// Price List Validators
// ============================================

export const createPriceListSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(100),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const updatePriceListSchema = createPriceListSchema.partial();

export const createPriceListItemSchema = z.object({
  productId: z.string().uuid('Debe seleccionar un producto'),
  price: z.coerce.number().min(0, 'El precio debe ser mayor o igual a 0'),
});

export const updatePriceListItemSchema = z.object({
  price: z.coerce.number().min(0, 'El precio debe ser mayor o igual a 0'),
});

export type CreatePriceListFormData = z.infer<typeof createPriceListSchema>;
export type UpdatePriceListFormData = z.infer<typeof updatePriceListSchema>;
export type CreatePriceListItemFormData = z.infer<typeof createPriceListItemSchema>;
export type UpdatePriceListItemFormData = z.infer<typeof updatePriceListItemSchema>;
