import { z } from 'zod';
import type { PurchaseOrderStatus, PurchaseOrderInstallmentStatus, PurchaseOrderInvoicingStatus } from '@/generated/prisma/enums';

// ============================================
// CONSTANTES - Etiquetas para UI
// ============================================

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Pendiente de Aprobación',
  APPROVED: 'Aprobada',
  PARTIALLY_RECEIVED: 'Recibida Parcialmente',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

export const PURCHASE_ORDER_STATUS_VARIANTS: Record<
  PurchaseOrderStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  DRAFT: 'secondary',
  PENDING_APPROVAL: 'outline',
  APPROVED: 'default',
  PARTIALLY_RECEIVED: 'default',
  COMPLETED: 'default',
  CANCELLED: 'destructive',
};

export const PURCHASE_ORDER_INVOICING_STATUS_LABELS: Record<PurchaseOrderInvoicingStatus, string> = {
  NOT_INVOICED: 'Sin facturar',
  PARTIALLY_INVOICED: 'Parcialmente facturada',
  FULLY_INVOICED: 'Totalmente facturada',
};

export const PURCHASE_ORDER_INVOICING_STATUS_VARIANTS: Record<
  PurchaseOrderInvoicingStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  NOT_INVOICED: 'outline',
  PARTIALLY_INVOICED: 'default',
  FULLY_INVOICED: 'default',
};

export const INSTALLMENT_STATUS_LABELS: Record<PurchaseOrderInstallmentStatus, string> = {
  PENDING: 'Pendiente',
  INVOICED: 'Facturada',
  PAID: 'Pagada',
};

export const INSTALLMENT_STATUS_VARIANTS: Record<
  PurchaseOrderInstallmentStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  PENDING: 'outline',
  INVOICED: 'default',
  PAID: 'default',
};

export const INSTALLMENT_FREQUENCIES = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
} as const;

export type InstallmentFrequency = keyof typeof INSTALLMENT_FREQUENCIES;

// ============================================
// SCHEMAS ZOD
// ============================================

// Schema para línea de orden de compra
export const purchaseOrderLineSchema = z.object({
  productId: z.string().uuid().optional().or(z.literal('')),
  description: z.string().min(1, 'La descripción es requerida'),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, 'Cantidad inválida'),
  unitCost: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor unitario inválido'),
  vatRate: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Alícuota de IVA inválida'),
});

// Schema para cuota/entrega de orden de compra
export const purchaseOrderInstallmentSchema = z.object({
  dueDate: z.date({ message: 'La fecha de vencimiento es requerida' }),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido'),
  notes: z.string().optional().nullable(),
});

// Schema para crear/editar orden de compra
export const purchaseOrderFormSchema = z.object({
  supplierId: z.string().uuid('Selecciona un proveedor'),
  issueDate: z.date({ message: 'La fecha de emisión es requerida' }),
  expectedDeliveryDate: z.date().optional().nullable(),
  paymentConditions: z.string().optional().nullable(),
  deliveryAddress: z.string().optional().nullable(),
  deliveryNotes: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z
    .array(purchaseOrderLineSchema)
    .min(1, 'Debe agregar al menos una línea'),
  hasInstallments: z.boolean().default(false),
  installments: z.array(purchaseOrderInstallmentSchema).default([]),
}).superRefine((data, ctx) => {
  if (data.hasInstallments && data.installments.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Debe agregar al menos 2 cuotas',
      path: ['installments'],
    });
  }
});

export type PurchaseOrderFormInput = z.infer<typeof purchaseOrderFormSchema>;
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineSchema>;
export type PurchaseOrderInstallmentInput = z.infer<typeof purchaseOrderInstallmentSchema>;
