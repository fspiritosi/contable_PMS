import type { Tx } from '@/modules/accounting/features/integrations/core';
import type { ExpenseStatus, PurchaseInvoiceStatus, SalesInvoiceStatus } from '@/generated/prisma/enums';
import {
  EFFECTIVE_PAYMENT_ORDER_ITEM,
  EFFECTIVE_PURCHASE_CREDIT_NOTE_APPLICATION,
  EFFECTIVE_RECEIPT_ITEM,
  EFFECTIVE_SALES_CREDIT_NOTE_APPLICATION,
} from '@/shared/lib/effective-settlements';

import { isCreditNote } from '../voucher-utils';

/**
 * Recalculo del estado de cobro/pago de facturas y gastos (TSK-792).
 *
 * Cuenta únicamente OP/RC en CONFIRMED y NC aplicadas cuya NC no está anulada
 * (`effective-settlements`: el mismo criterio que todos los saldos pendientes).
 * Los borradores y anulados no cuentan ni se tocan.
 */

const TOLERANCE = 0.005;

type SettledStatus = 'CONFIRMED' | 'PARTIAL_PAID' | 'PAID';

function statusFromSettled(settled: number, total: number): SettledStatus {
  if (settled >= total - TOLERANCE) return 'PAID';
  if (settled > TOLERANCE) return 'PARTIAL_PAID';
  return 'CONFIRMED';
}

export async function recomputePurchaseInvoiceStatusTx(tx: Tx, invoiceId: string): Promise<PurchaseInvoiceStatus> {
  const invoice = await tx.purchaseInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { status: true, total: true, voucherType: true },
  });
  if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') return invoice.status;

  let settled: number;
  if (isCreditNote(invoice.voucherType)) {
    const given = await tx.purchaseCreditNoteApplication.aggregate({
      where: { creditNoteId: invoiceId },
      _sum: { amount: true },
    });
    settled = Number(given._sum.amount ?? 0);
  } else {
    const [payments, applications] = await Promise.all([
      tx.paymentOrderItem.aggregate({
        where: { invoiceId, ...EFFECTIVE_PAYMENT_ORDER_ITEM },
        _sum: { amount: true },
      }),
      tx.purchaseCreditNoteApplication.aggregate({
        where: { invoiceId, ...EFFECTIVE_PURCHASE_CREDIT_NOTE_APPLICATION },
        _sum: { amount: true },
      }),
    ]);
    settled = Number(payments._sum.amount ?? 0) + Number(applications._sum.amount ?? 0);
  }

  const newStatus = statusFromSettled(settled, Number(invoice.total));
  if (newStatus !== invoice.status) {
    await tx.purchaseInvoice.update({ where: { id: invoiceId }, data: { status: newStatus } });
  }
  return newStatus;
}

export async function recomputeSalesInvoiceStatusTx(tx: Tx, invoiceId: string): Promise<SalesInvoiceStatus> {
  const invoice = await tx.salesInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { status: true, total: true, voucherType: true },
  });
  if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') return invoice.status;

  let settled: number;
  if (isCreditNote(invoice.voucherType)) {
    const given = await tx.salesCreditNoteApplication.aggregate({
      where: { creditNoteId: invoiceId },
      _sum: { amount: true },
    });
    settled = Number(given._sum.amount ?? 0);
  } else {
    const [receipts, applications] = await Promise.all([
      tx.receiptItem.aggregate({
        where: { invoiceId, ...EFFECTIVE_RECEIPT_ITEM },
        _sum: { amount: true },
      }),
      tx.salesCreditNoteApplication.aggregate({
        where: { invoiceId, ...EFFECTIVE_SALES_CREDIT_NOTE_APPLICATION },
        _sum: { amount: true },
      }),
    ]);
    settled = Number(receipts._sum.amount ?? 0) + Number(applications._sum.amount ?? 0);
  }

  const newStatus = statusFromSettled(settled, Number(invoice.total));
  if (newStatus !== invoice.status) {
    await tx.salesInvoice.update({ where: { id: invoiceId }, data: { status: newStatus } });
  }
  return newStatus;
}

export async function recomputeExpenseStatusTx(tx: Tx, expenseId: string): Promise<ExpenseStatus> {
  const expense = await tx.expense.findUniqueOrThrow({
    where: { id: expenseId },
    select: { status: true, amount: true },
  });
  if (expense.status === 'DRAFT' || expense.status === 'CANCELLED') return expense.status;

  const payments = await tx.paymentOrderItem.aggregate({
    where: { expenseId, ...EFFECTIVE_PAYMENT_ORDER_ITEM },
    _sum: { amount: true },
  });

  const newStatus = statusFromSettled(Number(payments._sum.amount ?? 0), Number(expense.amount));
  if (newStatus !== expense.status) {
    await tx.expense.update({ where: { id: expenseId }, data: { status: newStatus } });
  }
  return newStatus;
}
