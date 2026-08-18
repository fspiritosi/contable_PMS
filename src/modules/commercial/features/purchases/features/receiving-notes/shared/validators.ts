import { z } from 'zod';
import type { ReceivingNoteStatus } from '@/generated/prisma/enums';

// ============================================
// CONSTANTES - Etiquetas para UI
// ============================================

export const RECEIVING_NOTE_STATUS_LABELS: Record<ReceivingNoteStatus, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Anulado',
};

export const RECEIVING_NOTE_STATUS_VARIANTS: Record<
  ReceivingNoteStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  DRAFT: 'secondary',
  CONFIRMED: 'default',
  CANCELLED: 'destructive',
};

// ============================================
// SCHEMAS ZOD
// ============================================

export const receivingNoteLineSchema = z.object({
  productId: z.string().uuid('Selecciona un ítem'),
  description: z.string().min(1, 'La descripción es requerida'),
  quantity: z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/, 'Cantidad inválida')
    .refine((val) => parseFloat(val) > 0, 'La cantidad debe ser mayor a 0'),
  purchaseOrderLineId: z.string().uuid().optional().or(z.literal('')),
  notes: z.string().optional().nullable(),
});

export const receivingNoteFormSchema = z
  .object({
    supplierId: z.string().uuid('Selecciona un proveedor'),
    warehouseId: z.string().uuid('Selecciona un almacén'),
    purchaseOrderId: z.string().uuid().optional().or(z.literal('')),
    purchaseInvoiceId: z.string().uuid().optional().or(z.literal('')),
    receptionDate: z.date({ message: 'La fecha de recepción es requerida' }),
    notes: z.string().optional().nullable(),
    lines: z
      .array(receivingNoteLineSchema)
      .min(1, 'Debe agregar al menos una línea'),
  })
  .superRefine((data, ctx) => {
    const hasPO = data.purchaseOrderId && data.purchaseOrderId !== '';
    const hasPI = data.purchaseInvoiceId && data.purchaseInvoiceId !== '';
    if (hasPO && hasPI) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Solo puede asociar a una OC o una Factura, no ambas',
        path: ['purchaseInvoiceId'],
      });
    }
  });

export type ReceivingNoteFormInput = z.infer<typeof receivingNoteFormSchema>;
export type ReceivingNoteLineInput = z.infer<typeof receivingNoteLineSchema>;
