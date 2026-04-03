import { z } from 'zod';

// Client-side line schema
export const quoteLineSchema = z.object({
  productId: z.string().uuid('Producto inválido'),
  description: z.string().min(1, 'La descripción es requerida'),
  quantity: z
    .string()
    .min(1, 'La cantidad es requerida')
    .regex(/^\d+(\.\d{1,3})?$/, 'Cantidad inválida'),
  unitPrice: z
    .string()
    .min(1, 'El precio es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Precio inválido'),
  vatRate: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Alícuota de IVA inválida'),
  discountPercent: z.string().optional(),
  discountAmount: z.string().optional(),
});

// Client-side form schema
export const quoteFormSchema = z.object({
  recipientType: z.enum(['customer', 'lead']),
  customerId: z.string().uuid().optional().or(z.literal('')),
  leadId: z.string().uuid().optional().or(z.literal('')),
  issueDate: z.date({ message: 'La fecha de emisión es requerida' }),
  expirationDate: z.date().optional(),
  currency: z.enum(['ARS', 'USD', 'EUR', 'GBP']),
  notes: z.string().optional(),
  conditions: z.string().optional(),
  globalDiscountPercent: z.string().optional(),
  globalDiscountAmount: z.string().optional(),
  lines: z.array(quoteLineSchema).min(1, 'Debe agregar al menos una línea'),
});

// Server-side schema with transforms
export const createQuoteSchema = z.object({
  recipientType: z.enum(['customer', 'lead']),
  customerId: z.string().uuid().optional().or(z.literal('')),
  leadId: z.string().uuid().optional().or(z.literal('')),
  issueDate: z.coerce.date(),
  expirationDate: z.coerce.date().optional(),
  currency: z.enum(['ARS', 'USD', 'EUR', 'GBP']).default('ARS'),
  notes: z.string().optional(),
  conditions: z.string().optional(),
  globalDiscountPercent: z
    .string()
    .optional()
    .transform((val) => (val ? parseFloat(val) : null))
    .pipe(z.number().min(0).max(100).nullable()),
  globalDiscountAmount: z
    .string()
    .optional()
    .transform((val) => (val ? parseFloat(val) : null))
    .pipe(z.number().nonnegative().nullable()),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        description: z.string().min(1),
        quantity: z
          .string()
          .transform((val) => parseFloat(val))
          .pipe(z.number().positive()),
        unitPrice: z
          .string()
          .transform((val) => parseFloat(val))
          .pipe(z.number().nonnegative()),
        vatRate: z
          .string()
          .transform((val) => parseFloat(val))
          .pipe(z.number().min(0).max(100)),
        discountPercent: z
          .string()
          .optional()
          .transform((val) => (val ? parseFloat(val) : null))
          .pipe(z.number().min(0).max(100).nullable()),
        discountAmount: z
          .string()
          .optional()
          .transform((val) => (val ? parseFloat(val) : null))
          .pipe(z.number().nonnegative().nullable()),
      }),
    )
    .min(1),
});

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviado',
  ACCEPTED: 'Aceptado',
  REJECTED: 'Rechazado',
  EXPIRED: 'Expirado',
  COMPLETED: 'Completado',
};
