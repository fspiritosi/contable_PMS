import { z } from 'zod';

// Schema para línea de factura
export const invoiceLineSchema = z.object({
  productId: z.string().uuid('Ítem inválido'),
  description: z.string().min(1, 'La descripción es requerida'),
  quantity: z
    .string()
    .min(1, 'La cantidad es requerida')
    .regex(/^\d+(\.\d{1,3})?$/, 'Cantidad inválida'),
  unitPrice: z
    .string()
    .min(1, 'El precio es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Precio inválido'),
  vatRate: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Alícuota de IVA inválida'),
  discountPercent: z.string().optional(),
  discountAmount: z.string().optional(),
});

// Schema para formulario de factura
export const invoiceFormSchema = z.object({
  customerId: z.string().uuid('Cliente inválido'),
  pointOfSaleId: z.string().uuid('Punto de venta inválido'),
  voucherType: z.enum([
    'FACTURA_A',
    'FACTURA_B',
    'FACTURA_C',
    'NOTA_CREDITO_A',
    'NOTA_CREDITO_B',
    'NOTA_CREDITO_C',
    'NOTA_DEBITO_A',
    'NOTA_DEBITO_B',
    'NOTA_DEBITO_C',
    'RECIBO',
  ]),
  originalInvoiceId: z.string().uuid().optional().or(z.literal('')),
  issueDate: z.date({ message: 'La fecha de emisión es requerida' }),
  dueDate: z.date().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  globalDiscountPercent: z.string().optional(),
  globalDiscountAmount: z.string().optional(),
  lines: z.array(invoiceLineSchema).min(1, 'Debe agregar al menos una línea'),
});

// Schema para creación con transformación
export const createInvoiceSchema = z.object({
  customerId: z.string().uuid('Cliente inválido'),
  pointOfSaleId: z.string().uuid('Punto de venta inválido'),
  voucherType: z.enum([
    'FACTURA_A',
    'FACTURA_B',
    'FACTURA_C',
    'NOTA_CREDITO_A',
    'NOTA_CREDITO_B',
    'NOTA_CREDITO_C',
    'NOTA_DEBITO_A',
    'NOTA_DEBITO_B',
    'NOTA_DEBITO_C',
    'RECIBO',
  ]),
  originalInvoiceId: z.string().uuid().optional().or(z.literal('')),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
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
        discountPercent: z.string().optional()
          .transform((val) => (val ? parseFloat(val) : null))
          .pipe(z.number().min(0).max(100).nullable()),
        discountAmount: z.string().optional()
          .transform((val) => (val ? parseFloat(val) : null))
          .pipe(z.number().nonnegative().nullable()),
      })
    )
    .min(1),
  globalDiscountPercent: z.string().optional()
    .transform((val) => (val ? parseFloat(val) : null))
    .pipe(z.number().min(0).max(100).nullable()),
  globalDiscountAmount: z.string().optional()
    .transform((val) => (val ? parseFloat(val) : null))
    .pipe(z.number().nonnegative().nullable()),
});

// Tipos de voucher labels
export const VOUCHER_TYPE_LABELS = {
  FACTURA_A: 'Factura A',
  FACTURA_B: 'Factura B',
  FACTURA_C: 'Factura C',
  NOTA_CREDITO_A: 'Nota de Crédito A',
  NOTA_CREDITO_B: 'Nota de Crédito B',
  NOTA_CREDITO_C: 'Nota de Crédito C',
  NOTA_DEBITO_A: 'Nota de Débito A',
  NOTA_DEBITO_B: 'Nota de Débito B',
  NOTA_DEBITO_C: 'Nota de Débito C',
  RECIBO: 'Recibo',
} as const;

// Estados de factura labels
export const INVOICE_STATUS_LABELS = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmada',
  PAID: 'Cobrada',
  PARTIAL_PAID: 'Parcialmente Cobrada',
  CANCELLED: 'Anulada',
} as const;
