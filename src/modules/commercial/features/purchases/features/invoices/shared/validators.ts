import { z } from 'zod';
import type { VoucherType, PurchaseInvoiceStatus } from '@/generated/prisma/enums';
import { allocationFieldSchema } from '@/modules/commercial/shared/allocation-form';

// ============================================
// CONSTANTES - Etiquetas para UI
// ============================================

export const PURCHASE_INVOICE_STATUS_LABELS: Record<PurchaseInvoiceStatus, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmada',
  PAID: 'Pagada',
  PARTIAL_PAID: 'Parcialmente pagada',
  CANCELLED: 'Anulada',
};

export const VOUCHER_TYPE_LABELS: Partial<Record<VoucherType, string>> = {
  FACTURA_A: 'Factura A',
  FACTURA_B: 'Factura B',
  FACTURA_C: 'Factura C',
  NOTA_CREDITO_A: 'Nota de Crédito A',
  NOTA_CREDITO_B: 'Nota de Crédito B',
  NOTA_CREDITO_C: 'Nota de Crédito C',
  NOTA_DEBITO_A: 'Nota de Débito A',
  NOTA_DEBITO_B: 'Nota de Débito B',
  NOTA_DEBITO_C: 'Nota de Débito C',
};

// ============================================
// SCHEMAS ZOD
// ============================================

// Schema para línea de factura de compra
export const purchaseInvoiceLineSchema = z.object({
  productId: z.string().uuid().optional(), // Opcional si es un gasto no inventariable
  description: z.string().min(1, 'La descripción es requerida'),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, 'Cantidad inválida'),
  unitCost: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor unitario inválido'),
  vatRate: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Alícuota de IVA inválida'),
  purchaseOrderLineId: z.string().uuid().optional().or(z.literal('')),
  // Reparto por centro de costo. Vacío = centro predeterminado del ítem (TSK-583).
  // Nota: se usa `.optional()` en lugar de `.default([])` porque el `default`
  // hace que el tipo de entrada del formulario (antes de validar) y el tipo de
  // salida (ya validado) diverjan, y react-hook-form + zodResolver no aceptan
  // esa asimetría sin declarar un tercer genérico en useForm (ver mismo
  // problema, preexistente, en _PurchaseOrderForm.tsx con `installments`).
  costCenterAllocations: allocationFieldSchema.optional(),
});

// Schema para crear/editar factura de compra
export const purchaseInvoiceFormSchema = z.object({
  supplierId: z.string().uuid('Selecciona un proveedor'),
  voucherType: z.string().min(1, 'Selecciona un tipo de comprobante'),
  pointOfSale: z.string().regex(/^\d{4}$/, 'Punto de venta debe ser 4 dígitos (ej: 0001)'),
  number: z.string().regex(/^\d{8}$/, 'Número debe ser 8 dígitos (ej: 00000123)'),
  originalInvoiceId: z.string().uuid().optional().or(z.literal('')),
  purchaseOrderId: z.string().uuid().optional().or(z.literal('')),
  issueDate: z.date({ message: 'La fecha de emisión es requerida' }),
  dueDate: z.date().optional(),
  cae: z.string().optional(),
  notes: z.string().optional(),
  lines: z
    .array(purchaseInvoiceLineSchema)
    .min(1, 'Debe agregar al menos una línea'),
});

export type PurchaseInvoiceFormInput = z.infer<typeof purchaseInvoiceFormSchema>;
export type PurchaseInvoiceLineInput = z.infer<typeof purchaseInvoiceLineSchema>;
