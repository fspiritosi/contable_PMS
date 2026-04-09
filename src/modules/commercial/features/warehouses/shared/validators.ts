import { z } from 'zod';
import { WarehouseType, StockMovementType } from '@/generated/prisma/enums';


// ============================================
// Warehouse Validators
// ============================================

export const createWarehouseSchema = z.object({
  code: z.string().min(1, 'El código es requerido').max(20),
  name: z.string().min(1, 'El nombre es requerido').max(100),
  type: z.nativeEnum(WarehouseType).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});

export const updateWarehouseSchema = createWarehouseSchema.partial();

export type CreateWarehouseFormData = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseFormData = z.infer<typeof updateWarehouseSchema>;

// ============================================
// Generic Stock Movement Validator
// ============================================

export const createStockMovementSchema = z.object({
  warehouseId: z.string().uuid('Debe seleccionar un almacén'),
  productId: z.string().uuid('Debe seleccionar un producto'),
  type: z.nativeEnum(StockMovementType),
  quantity: z.coerce.number().positive('La cantidad debe ser mayor a 0'),
  referenceType: z.string().max(50).optional(),
  referenceId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
  date: z.coerce.date().optional(),
});

export type CreateStockMovementFormData = z.infer<typeof createStockMovementSchema>;

// ============================================
// Quick Stock Adjustment (vista de stock)
// Establece la cantidad absoluta del stock
// ============================================

export const setStockQuantitySchema = z.object({
  warehouseId: z.string().uuid('Debe seleccionar un almacén'),
  productId: z.string().uuid('Debe seleccionar un producto'),
  newQuantity: z.coerce.number().min(0, 'La cantidad debe ser mayor o igual a 0'),
  notes: z.string().max(500).optional(),
});

export type SetStockQuantityFormData = z.infer<typeof setStockQuantitySchema>;

// ============================================
// Quick Stock Transfer (vista de stock)
// Transferencia directa sin fecha ni notas requeridas
// ============================================

export const directStockTransferSchema = z.object({
  fromWarehouseId: z.string().uuid('Debe seleccionar almacén origen'),
  toWarehouseId: z.string().uuid('Debe seleccionar almacén destino'),
  productId: z.string().uuid('Debe seleccionar un producto'),
  quantity: z.coerce.number().positive('La cantidad debe ser mayor a 0'),
  notes: z.string().max(500).optional(),
}).refine(
  (data) => data.fromWarehouseId !== data.toWarehouseId,
  {
    message: 'El almacén origen y destino no pueden ser el mismo',
    path: ['toWarehouseId'],
  }
);

export type DirectStockTransferFormData = z.infer<typeof directStockTransferSchema>;

// ============================================
// Formal Stock Adjustment (vista de movimientos)
// Registra entrada/salida con motivo, fecha y notas
// ============================================

export const stockAdjustmentSchema = z.object({
  warehouseId: z.string().uuid('Almacén inválido'),
  productId: z.string().uuid('Producto inválido'),
  quantity: z
    .string()
    .min(1, 'La cantidad es requerida')
    .regex(/^-?\d+(\.\d{1,3})?$/, 'Cantidad inválida (máximo 3 decimales)')
    .refine((val) => parseFloat(val) !== 0, 'La cantidad no puede ser 0'),
  reason: z.enum(['ENTRY', 'EXIT', 'LOSS'], {
    message: 'Debe seleccionar un motivo',
  }),
  notes: z.string().min(1, 'Las notas son requeridas'),
  date: z.date({ message: 'La fecha es requerida' }),
});

export type StockAdjustmentFormData = z.infer<typeof stockAdjustmentSchema>;

// ============================================
// Formal Stock Transfer (vista de movimientos)
// Transferencia multi-producto con fecha y almacenes
// ============================================

export const stockTransferLineSchema = z.object({
  productId: z.string().uuid('Producto inválido'),
  quantity: z
    .string()
    .min(1, 'La cantidad es requerida')
    .regex(/^\d+(\.\d{1,3})?$/, 'Cantidad inválida (máximo 3 decimales)')
    .refine((val) => parseFloat(val) > 0, 'La cantidad debe ser positiva'),
});

export const stockTransferSchema = z.object({
  sourceWarehouseId: z.string().uuid('Almacén de origen inválido'),
  destinationWarehouseId: z.string().uuid('Almacén de destino inválido'),
  date: z.date({ message: 'La fecha es requerida' }),
  notes: z.string().optional(),
  lines: z.array(stockTransferLineSchema).min(1, 'Debe agregar al menos un producto'),
}).refine((data) => data.sourceWarehouseId !== data.destinationWarehouseId, {
  message: 'El almacén de origen y destino deben ser diferentes',
  path: ['destinationWarehouseId'],
});

export type StockTransferFormData = z.infer<typeof stockTransferSchema>;

// ============================================
// Labels
// ============================================

export const ADJUSTMENT_REASON_LABELS = {
  ENTRY: 'Entrada (Inventario inicial, Devolución, etc.)',
  EXIT: 'Salida (Consumo interno, Muestra, etc.)',
  LOSS: 'Pérdida/Merma (Rotura, Vencimiento, etc.)',
} as const;
