import 'server-only';

import { z, type ZodType } from 'zod';

import type { JournalEntryStatus, VoucherType } from '@/generated/prisma/enums';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import { purchaseInvoiceFormSchema } from '@/modules/commercial/features/purchases/features/invoices/shared/validators';
import { buildSalesInvoiceAmounts } from '@/modules/commercial/features/sales/features/invoices/shared/totals';
import { createInvoiceSchema } from '@/modules/commercial/features/sales/features/invoices/shared/validators';
import {
  fundMovementSchema,
  parseFundMovementDate,
} from '@/modules/commercial/features/treasury/features/fund-movements/shared/validators';
import {
  createPaymentOrderSchema,
  createReceiptSchema,
} from '@/modules/commercial/features/treasury/shared/validators';
import type { Module } from '@/shared/lib/permissions/constants';

import { writeFundMovementDataTx } from '../effects/fund-movement-data.server';
import {
  applyFundMovementEffectsTx,
  fundMovementEffectImpedimentsTx,
  revertFundMovementEffectsTx,
} from '../effects/fund-movement.server';
import { writePaymentOrderDataTx } from '../effects/payment-order-data.server';
import {
  applyPaymentOrderEffectsTx,
  paymentOrderEffectImpedimentsTx,
  revertPaymentOrderEffectsTx,
} from '../effects/payment-order.server';
import {
  buildPurchaseInvoiceAmounts,
  writePurchaseInvoiceDataTx,
} from '../effects/purchase-invoice-data.server';
import {
  applyPurchaseInvoiceEffectsTx,
  purchaseInvoiceEffectImpedimentsTx,
  revertPurchaseInvoiceEffectsTx,
  validatePurchaseInvoiceForConfirmation,
} from '../effects/purchase-invoice.server';
import { writeReceiptDataTx } from '../effects/receipt-data.server';
import {
  applyReceiptEffectsTx,
  receiptEffectImpedimentsTx,
  revertReceiptEffectsTx,
} from '../effects/receipt.server';
import { writeSalesInvoiceDataTx } from '../effects/sales-invoice-data.server';
import {
  applySalesInvoiceEffectsTx,
  revertSalesInvoiceEffectsTx,
  salesInvoiceEffectImpedimentsTx,
  validateSalesInvoiceForConfirmation,
} from '../effects/sales-invoice.server';
import type { EffectsCtx } from '../effects/types';
import { removeProjectionLinkTx } from '../projection-links.server';
import type { CorrectableKind, DocRef, Impediment } from './types';

/**
 * Lo que el motor de corrección (TSK-792) necesita saber hacer con cada tipo de
 * comprobante: sus efectos (aplicar, revertir, impedimentos), la escritura de sus
 * datos editables, cómo se anula o se borra y cómo se nombra.
 */

/** Estado del comprobante que el motor necesita para planificar. */
export interface DocHead {
  ref: DocRef;
  /** Con artículo, para los mensajes: "la FC A 0001-00000123". */
  label: string;
  /** Sin artículo, con la contraparte: "FC A 0001-00000123 · Lubricantes SA". */
  title: string;
  /** Confirmado (o pagado/cobrado): admite corrección. */
  correctable: boolean;
  cancelled: boolean;
  date: Date;
  partyId: string | null;
  total: number;
  journalEntry: { id: string; number: number; status: JournalEntryStatus } | null;
  /** Motivo por el que este comprobante no se puede editar (sí eliminar o anular). */
  editBlockedReason?: string;
}

/** Lo que cambia una edición y el motor necesita antes de escribir: fecha, contraparte y total. */
export interface EditSummary {
  date: Date;
  partyId: string | null;
  /** Total nuevo de una factura (para propagar la diferencia); null en OP/RC/MF. */
  total: number | null;
}

export interface KindHandler {
  permissionModule: Module;
  /** Schema del formulario de edición de ese tipo (el mismo del alta). */
  editSchema: ZodType;
  label(tx: Tx, companyId: string, id: string): Promise<string>;
  head(tx: Tx, companyId: string, id: string): Promise<DocHead | null>;
  /** Fecha, contraparte y total de los datos editados, ya válidos según `editSchema`. */
  summarizeEdit(input: unknown): EditSummary;
  apply: typeof applyPaymentOrderEffectsTx;
  revert: (tx: Tx, ctx: EffectsCtx, id: string) => Promise<void>;
  effectImpediments: (tx: Tx, id: string, docLabel: string) => Promise<Impediment[]>;
  /** Escribe los datos editados (los valida con `editSchema`). */
  write: (tx: Tx, companyId: string, id: string, input: unknown) => Promise<void>;
  /** Pre-validación de la confirmación, sobre lo recién escrito en la tx. */
  validateForConfirmation?: (tx: Tx, id: string, companyId: string) => Promise<void>;
  /** Desvincula lo que no es efecto (remitos, cuotas de OC, proyecciones) al eliminar o anular. */
  releaseLinks?: (tx: Tx, companyId: string, id: string) => Promise<void>;
  /** Estado anulado; `clearEntry` si su asiento en borrador se eliminó. */
  markCancelled: (tx: Tx, id: string, clearEntry: boolean) => Promise<void>;
  /** Borra el comprobante (sus hijos caen en cascada). */
  remove: (tx: Tx, id: string) => Promise<void>;
}

// ============================================================================
// ETIQUETAS
// ============================================================================

const VOUCHER_PREFIX: Record<string, string> = {
  FACTURA: 'FC',
  NOTA_CREDITO: 'NC',
  NOTA_DEBITO: 'ND',
};

/** "FC A", "NC B", "FV C"…: tipo abreviado de una factura de compra o venta. */
export function voucherShortLabel(voucherType: VoucherType, side: 'PURCHASE' | 'SALES'): string {
  if (voucherType === 'GASTOS_BANCARIOS') return 'Gastos bancarios';
  if (voucherType === 'RECIBO') return 'Recibo';
  const letter = voucherType.slice(-1);
  const base = voucherType.slice(0, -2);
  const prefix = VOUCHER_PREFIX[base] ?? base;
  return `${side === 'SALES' && prefix === 'FC' ? 'FV' : prefix} ${letter}`;
}

const entryOf = (entry: { id: string; number: number; status: JournalEntryStatus } | null) =>
  entry ? { id: entry.id, number: entry.number, status: entry.status } : null;

const ENTRY_SELECT = { select: { id: true, number: true, status: true } } as const;

async function entryById(tx: Tx, id: string | null) {
  if (!id) return null;
  return tx.journalEntry.findUnique({ where: { id }, select: ENTRY_SELECT.select });
}

// ============================================================================
// FACTURA DE COMPRA
// ============================================================================

async function purchaseInvoiceHead(tx: Tx, companyId: string, id: string): Promise<DocHead | null> {
  const invoice = await tx.purchaseInvoice.findFirst({
    where: { id, companyId },
    select: {
      voucherType: true,
      fullNumber: true,
      status: true,
      issueDate: true,
      supplierId: true,
      total: true,
      supplier: { select: { businessName: true } },
      journalEntry: ENTRY_SELECT,
    },
  });
  if (!invoice) return null;
  const name = `${voucherShortLabel(invoice.voucherType, 'PURCHASE')} ${invoice.fullNumber}`;
  return {
    ref: { kind: 'PURCHASE_INVOICE', id },
    label: `la ${name}`,
    title: `${name} · ${invoice.supplier.businessName}`,
    correctable: ['CONFIRMED', 'PARTIAL_PAID', 'PAID'].includes(invoice.status),
    cancelled: invoice.status === 'CANCELLED',
    date: invoice.issueDate,
    partyId: invoice.supplierId,
    total: Number(invoice.total),
    journalEntry: entryOf(invoice.journalEntry),
  };
}

async function releasePurchaseInvoiceLinksTx(tx: Tx, companyId: string, id: string): Promise<void> {
  await tx.receivingNote.updateMany({
    where: { purchaseInvoiceId: id, companyId },
    data: { purchaseInvoiceId: null },
  });
  await tx.purchaseOrderInstallment.updateMany({
    where: { purchaseInvoiceId: id, companyId, status: 'INVOICED' },
    data: { purchaseInvoiceId: null, status: 'PENDING' },
  });
  await releaseProjectionLinksTx(tx, companyId, { purchaseInvoiceId: id });
}

// ============================================================================
// FACTURA DE VENTA
// ============================================================================

/** El schema de la edición de una FV trae el número para que la regla de campos fijos lo controle. */
const salesInvoiceEditSchema = createInvoiceSchema.extend({
  number: z.coerce.number().int().optional(),
});

async function salesInvoiceHead(tx: Tx, companyId: string, id: string): Promise<DocHead | null> {
  const invoice = await tx.salesInvoice.findFirst({
    where: { id, companyId },
    select: {
      voucherType: true,
      fullNumber: true,
      status: true,
      issueDate: true,
      customerId: true,
      total: true,
      customer: { select: { name: true } },
      journalEntry: ENTRY_SELECT,
    },
  });
  if (!invoice) return null;
  const name = `${voucherShortLabel(invoice.voucherType, 'SALES')} ${invoice.fullNumber}`;
  return {
    ref: { kind: 'SALES_INVOICE', id },
    label: `la ${name}`,
    title: `${name} · ${invoice.customer.name}`,
    correctable: ['CONFIRMED', 'PARTIAL_PAID', 'PAID'].includes(invoice.status),
    cancelled: invoice.status === 'CANCELLED',
    date: invoice.issueDate,
    partyId: invoice.customerId,
    total: Number(invoice.total),
    journalEntry: entryOf(invoice.journalEntry),
  };
}

/** Los remitos facturados vuelven a "pendiente de facturar" (spec §4.4). */
async function releaseSalesInvoiceLinksTx(tx: Tx, companyId: string, id: string): Promise<void> {
  await tx.deliveryNote.updateMany({
    where: { salesInvoiceId: id, companyId, status: 'INVOICED' },
    data: { salesInvoiceId: null, status: 'ACCEPTED' },
  });
  await releaseProjectionLinksTx(tx, companyId, { salesInvoiceId: id });
}

/** Quita los vínculos de proyección del comprobante y recalcula lo confirmado de cada proyección. */
async function releaseProjectionLinksTx(
  tx: Tx,
  companyId: string,
  where: { purchaseInvoiceId: string } | { salesInvoiceId: string }
): Promise<void> {
  const links = await tx.projectionDocumentLink.findMany({
    where: { ...where, companyId },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const link of links) await removeProjectionLinkTx(tx, companyId, link.id);
}

// ============================================================================
// ORDEN DE PAGO, RECIBO Y MOVIMIENTO DE FONDO
// ============================================================================

/**
 * Una devolución a socio anulada deja de reservar las cuotas que iba a saldar (el
 * revert ya las devolvió a pendientes): vuelven a estar disponibles para otra OP.
 */
async function releasePaymentOrderLinksTx(tx: Tx, companyId: string, id: string): Promise<void> {
  await tx.paymentOrderInstallment.updateMany({
    where: { settledByPaymentOrderId: id, companyId, status: 'PENDING' },
    data: { settledByPaymentOrderId: null },
  });
}

async function paymentOrderHead(tx: Tx, companyId: string, id: string): Promise<DocHead | null> {
  const order = await tx.paymentOrder.findFirst({
    where: { id, companyId },
    select: {
      fullNumber: true,
      status: true,
      date: true,
      supplierId: true,
      partnerId: true,
      totalAmount: true,
      supplier: { select: { businessName: true } },
      partner: { select: { name: true } },
      journalEntry: ENTRY_SELECT,
    },
  });
  if (!order) return null;
  const party = order.supplier?.businessName ?? order.partner?.name;
  return {
    ref: { kind: 'PAYMENT_ORDER', id },
    label: `la ${order.fullNumber}`,
    title: party ? `${order.fullNumber} · ${party}` : order.fullNumber,
    correctable: order.status === 'CONFIRMED',
    cancelled: order.status === 'CANCELLED',
    date: order.date,
    partyId: order.supplierId ?? order.partnerId,
    total: Number(order.totalAmount),
    journalEntry: entryOf(order.journalEntry),
    editBlockedReason: order.partnerId
      ? 'Las devoluciones a socio no se editan: anulala o eliminala y cargala de nuevo.'
      : undefined,
  };
}

async function receiptHead(tx: Tx, companyId: string, id: string): Promise<DocHead | null> {
  const receipt = await tx.receipt.findFirst({
    where: { id, companyId },
    select: {
      fullNumber: true,
      status: true,
      date: true,
      customerId: true,
      totalAmount: true,
      customer: { select: { name: true } },
      journalEntry: ENTRY_SELECT,
    },
  });
  if (!receipt) return null;
  return {
    ref: { kind: 'RECEIPT', id },
    label: `el recibo ${receipt.fullNumber}`,
    title: `${receipt.fullNumber} · ${receipt.customer.name}`,
    correctable: receipt.status === 'CONFIRMED',
    cancelled: receipt.status === 'CANCELLED',
    date: receipt.date,
    partyId: receipt.customerId,
    total: Number(receipt.totalAmount),
    journalEntry: entryOf(receipt.journalEntry),
  };
}

async function fundMovementHead(tx: Tx, companyId: string, id: string): Promise<DocHead | null> {
  const movement = await tx.fundMovement.findFirst({
    where: { id, companyId },
    select: {
      status: true,
      date: true,
      amount: true,
      description: true,
      partnerId: true,
      journalEntryId: true,
    },
  });
  if (!movement) return null;
  return {
    ref: { kind: 'FUND_MOVEMENT', id },
    label: `el movimiento de fondos «${movement.description}»`,
    title: `Movimiento de fondos · ${movement.description}`,
    correctable: movement.status === 'CONFIRMED',
    cancelled: movement.status === 'CANCELLED',
    date: movement.date,
    partyId: movement.partnerId,
    total: Number(movement.amount),
    journalEntry: entryOf(await entryById(tx, movement.journalEntryId)),
  };
}

/** Nombre del comprobante de la empresa con artículo; si no existe, uno genérico. */
const labelOf =
  (head: KindHandler['head'], fallback: string): KindHandler['label'] =>
  async (tx, companyId, id) =>
    (await head(tx, companyId, id))?.label ?? fallback;

// ============================================================================
// REGISTRO
// ============================================================================

export const CORRECTION_HANDLERS: Record<CorrectableKind, KindHandler> = {
  PURCHASE_INVOICE: {
    permissionModule: 'commercial.purchases',
    editSchema: purchaseInvoiceFormSchema,
    label: labelOf(purchaseInvoiceHead, 'la factura de compra'),
    head: purchaseInvoiceHead,
    summarizeEdit(input) {
      const data = purchaseInvoiceFormSchema.parse(input);
      return {
        date: data.issueDate,
        partyId: data.supplierId,
        total: buildPurchaseInvoiceAmounts(data).total,
      };
    },
    apply: applyPurchaseInvoiceEffectsTx,
    revert: revertPurchaseInvoiceEffectsTx,
    effectImpediments: purchaseInvoiceEffectImpedimentsTx,
    write: (tx, companyId, id, input) =>
      writePurchaseInvoiceDataTx(tx, companyId, id, purchaseInvoiceFormSchema.parse(input)),
    validateForConfirmation: (tx, id, companyId) =>
      validatePurchaseInvoiceForConfirmation(id, companyId, tx),
    releaseLinks: releasePurchaseInvoiceLinksTx,
    markCancelled: async (tx, id, clearEntry) => {
      await tx.purchaseInvoice.update({
        where: { id },
        data: { status: 'CANCELLED', ...(clearEntry ? { journalEntryId: null } : {}) },
      });
    },
    remove: async (tx, id) => {
      await tx.purchaseInvoice.delete({ where: { id } });
    },
  },
  SALES_INVOICE: {
    permissionModule: 'commercial.invoices',
    editSchema: salesInvoiceEditSchema,
    label: labelOf(salesInvoiceHead, 'la factura de venta'),
    head: salesInvoiceHead,
    summarizeEdit(input) {
      const data = salesInvoiceEditSchema.parse(input);
      return {
        date: data.issueDate,
        partyId: data.customerId,
        total: Number(buildSalesInvoiceAmounts(data).amounts.total),
      };
    },
    apply: applySalesInvoiceEffectsTx,
    revert: revertSalesInvoiceEffectsTx,
    effectImpediments: salesInvoiceEffectImpedimentsTx,
    write: (tx, companyId, id, input) =>
      writeSalesInvoiceDataTx(tx, companyId, id, salesInvoiceEditSchema.parse(input)),
    validateForConfirmation: (tx, id, companyId) =>
      validateSalesInvoiceForConfirmation(id, companyId, tx),
    releaseLinks: releaseSalesInvoiceLinksTx,
    markCancelled: async (tx, id, clearEntry) => {
      await tx.salesInvoice.update({
        where: { id },
        data: { status: 'CANCELLED', ...(clearEntry ? { journalEntryId: null } : {}) },
      });
    },
    remove: async (tx, id) => {
      await tx.salesInvoice.delete({ where: { id } });
    },
  },
  PAYMENT_ORDER: {
    permissionModule: 'commercial.treasury.payment-orders',
    editSchema: createPaymentOrderSchema,
    label: labelOf(paymentOrderHead, 'la orden de pago'),
    head: paymentOrderHead,
    summarizeEdit(input) {
      const data = createPaymentOrderSchema.parse(input);
      return { date: data.date, partyId: data.supplierId ?? null, total: null };
    },
    apply: applyPaymentOrderEffectsTx,
    revert: revertPaymentOrderEffectsTx,
    effectImpediments: paymentOrderEffectImpedimentsTx,
    write: (tx, companyId, id, input) =>
      writePaymentOrderDataTx(tx, companyId, id, createPaymentOrderSchema.parse(input)),
    releaseLinks: releasePaymentOrderLinksTx,
    markCancelled: async (tx, id, clearEntry) => {
      await tx.paymentOrder.update({
        where: { id },
        data: { status: 'CANCELLED', ...(clearEntry ? { journalEntryId: null } : {}) },
      });
    },
    remove: async (tx, id) => {
      await tx.paymentOrder.delete({ where: { id } });
    },
  },
  RECEIPT: {
    permissionModule: 'commercial.treasury.receipts',
    editSchema: createReceiptSchema,
    label: labelOf(receiptHead, 'el recibo'),
    head: receiptHead,
    summarizeEdit(input) {
      const data = createReceiptSchema.parse(input);
      return { date: data.date, partyId: data.customerId, total: null };
    },
    apply: applyReceiptEffectsTx,
    revert: revertReceiptEffectsTx,
    effectImpediments: receiptEffectImpedimentsTx,
    write: (tx, companyId, id, input) =>
      writeReceiptDataTx(tx, companyId, id, createReceiptSchema.parse(input)),
    markCancelled: async (tx, id, clearEntry) => {
      await tx.receipt.update({
        where: { id },
        data: { status: 'CANCELLED', ...(clearEntry ? { journalEntryId: null } : {}) },
      });
    },
    remove: async (tx, id) => {
      await tx.receipt.delete({ where: { id } });
    },
  },
  FUND_MOVEMENT: {
    permissionModule: 'commercial.treasury.fund-movements',
    editSchema: fundMovementSchema,
    label: labelOf(fundMovementHead, 'el movimiento de fondos'),
    head: fundMovementHead,
    summarizeEdit(input) {
      const data = fundMovementSchema.parse(input);
      return {
        date: parseFundMovementDate(data.date),
        partyId: data.partnerId || null,
        total: null,
      };
    },
    apply: applyFundMovementEffectsTx,
    revert: revertFundMovementEffectsTx,
    effectImpediments: fundMovementEffectImpedimentsTx,
    write: (tx, companyId, id, input) =>
      writeFundMovementDataTx(tx, companyId, id, fundMovementSchema.parse(input)),
    markCancelled: async (tx, id, clearEntry) => {
      await tx.fundMovement.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          ...(clearEntry ? { journalEntryId: null, journalEntryNumber: null } : {}),
        },
      });
    },
    remove: async (tx, id) => {
      await tx.fundMovement.delete({ where: { id } });
    },
  },
};
