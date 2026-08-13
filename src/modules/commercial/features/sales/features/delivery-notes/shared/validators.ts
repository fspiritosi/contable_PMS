import { z } from 'zod';
import type { DeliveryNoteStatus } from '@/generated/prisma/enums';

// ============================================
// CONSTANTES - Etiquetas para UI
// ============================================

export const DELIVERY_NOTE_STATUS_LABELS: Record<DeliveryNoteStatus, string> = {
  PENDING_DELIVERY: 'Pendiente de Entrega',
  ACCEPTED: 'Aceptado',
  INVOICED: 'Facturado',
  CANCELLED: 'Anulado',
};

export const DELIVERY_NOTE_STATUS_VARIANTS: Record<
  DeliveryNoteStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  PENDING_DELIVERY: 'secondary',
  ACCEPTED: 'default',
  INVOICED: 'outline',
  CANCELLED: 'destructive',
};

// ============================================
// SCHEMAS ZOD
// ============================================

export const deliveryNoteLineSchema = z.object({
  productId: z.string().uuid('Selecciona un ítem'),
  description: z.string().min(1, 'La descripción es requerida'),
  quantity: z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/, 'Cantidad inválida')
    .refine((val) => parseFloat(val) > 0, 'La cantidad debe ser mayor a 0'),
  notes: z.string().optional().nullable(),
});

export const deliveryNoteFormSchema = z.object({
  customerId: z.string().uuid('Selecciona un cliente'),
  warehouseId: z.string().uuid('Selecciona un almacén'),
  deliveryDate: z.date({ message: 'La fecha de entrega es requerida' }),
  notes: z.string().optional().nullable(),
  lines: z
    .array(deliveryNoteLineSchema)
    .min(1, 'Debe agregar al menos una línea'),
});

export type DeliveryNoteFormInput = z.infer<typeof deliveryNoteFormSchema>;
export type DeliveryNoteLineInput = z.infer<typeof deliveryNoteLineSchema>;
