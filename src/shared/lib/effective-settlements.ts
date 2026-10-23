import type { Prisma } from '@/generated/prisma/client';

/**
 * Qué cancela de verdad una factura o un gasto (TSK-792, TSK-797): solo las órdenes de
 * pago y los recibos CONFIRMADOS, y las notas de crédito aplicadas cuya NC no está
 * anulada. Una OP o un RC en borrador o anulado conserva sus imputaciones (el anulado,
 * como histórico), pero no cuenta en ningún saldo ni estado.
 *
 * Filtros para el `where` de las relaciones de imputación. Todo cálculo de saldo
 * pendiente, deuda o estado de cobro/pago tiene que usarlos.
 */

/** Imputación de una OP que cuenta: la OP está confirmada. */
export const EFFECTIVE_PAYMENT_ORDER_ITEM = {
  paymentOrder: { status: 'CONFIRMED' },
} satisfies Prisma.PaymentOrderItemWhereInput;

/** Imputación de un RC que cuenta: el recibo está confirmado. */
export const EFFECTIVE_RECEIPT_ITEM = {
  receipt: { status: 'CONFIRMED' },
} satisfies Prisma.ReceiptItemWhereInput;

/** Aplicación de una NC de compra que cuenta: la NC no está anulada. */
export const EFFECTIVE_PURCHASE_CREDIT_NOTE_APPLICATION = {
  creditNote: { status: { not: 'CANCELLED' } },
} satisfies Prisma.PurchaseCreditNoteApplicationWhereInput;

/** Aplicación de una NC de venta que cuenta: la NC no está anulada. */
export const EFFECTIVE_SALES_CREDIT_NOTE_APPLICATION = {
  creditNote: { status: { not: 'CANCELLED' } },
} satisfies Prisma.SalesCreditNoteApplicationWhereInput;
