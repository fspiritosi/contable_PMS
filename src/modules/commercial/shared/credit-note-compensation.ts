import { logger } from '@/shared/lib/logger';
import { CREDIT_NOTE_TYPES, isCreditNote } from './voucher-utils';
import type { Prisma } from '@/generated/prisma/client';

type TransactionClient = Parameters<Parameters<typeof import('@/shared/lib/prisma').prisma.$transaction>[0]>[0];

interface CreditNoteForCompensation {
  id: string;
  total: Prisma.Decimal | number;
  customerId?: string;
  supplierId?: string;
  originalInvoiceId: string | null;
}

/**
 * Aplica automáticamente una NC de venta contra facturas/ND pendientes del mismo cliente.
 * Algoritmo: factura original primero, luego FIFO (más antigua primero).
 */
export async function applySalesCreditNote(
  tx: TransactionClient,
  creditNote: CreditNoteForCompensation,
  companyId: string
) {
  let remaining = Number(creditNote.total);

  if (remaining <= 0) return [];

  // Buscar facturas/ND pendientes del mismo cliente (excluir NC)
  const pendingInvoices = await tx.salesInvoice.findMany({
    where: {
      companyId,
      customerId: creditNote.customerId,
      status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
      voucherType: { notIn: CREDIT_NOTE_TYPES },
    },
    select: {
      id: true,
      total: true,
      issueDate: true,
      receiptItems: {
        where: { receipt: { status: 'CONFIRMED' } },
        select: { amount: true },
      },
      creditNoteApplicationsReceived: {
        select: { amount: true, creditNoteId: true },
      },
      creditDebitNotes: {
        where: { voucherType: { in: CREDIT_NOTE_TYPES }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
        select: { id: true, total: true },
      },
    },
    orderBy: { issueDate: 'asc' },
  });

  // Calcular pendiente real de cada factura (incluyendo NC históricas via fallback)
  const invoicesWithPending = pendingInvoices.map((inv) => {
    const receiptsPaid = inv.receiptItems.reduce(
      (sum, item) => sum + Number(item.amount),
      0
    );
    const cnAppliedExplicit = inv.creditNoteApplicationsReceived.reduce(
      (sum, app) => sum + Number(app.amount),
      0
    );
    // Fallback: NC vinculadas por originalInvoiceId sin registro explícito
    const explicitCNIds = new Set(
      inv.creditNoteApplicationsReceived.map((app) => app.creditNoteId)
    );
    const cnLinkedFallback = inv.creditDebitNotes
      .filter((doc) => !explicitCNIds.has(doc.id))
      .reduce((sum, doc) => sum + Number(doc.total), 0);

    const pendingAmount = Number(inv.total) - receiptsPaid - cnAppliedExplicit - cnLinkedFallback;
    return { id: inv.id, pendingAmount };
  }).filter((inv) => inv.pendingAmount > 0.005);

  // Si el usuario seleccionó una factura original, aplicar SOLO a esa factura
  // Si no seleccionó, aplicar FIFO contra todas las pendientes
  if (creditNote.originalInvoiceId) {
    const originalInvoice = invoicesWithPending.find(
      (inv) => inv.id === creditNote.originalInvoiceId
    );
    if (originalInvoice) {
      invoicesWithPending.length = 0;
      invoicesWithPending.push(originalInvoice);
    } else {
      logger.info('NC tiene factura original pero sin saldo pendiente, no se auto-compensa', {
        data: { creditNoteId: creditNote.id, originalInvoiceId: creditNote.originalInvoiceId },
      });
      return [];
    }
  }

  const applications: { invoiceId: string; amount: number }[] = [];

  for (const invoice of invoicesWithPending) {
    if (remaining <= 0.005) break;

    const applyAmount = Math.min(remaining, invoice.pendingAmount);
    const roundedAmount = Math.round(applyAmount * 100) / 100;

    if (roundedAmount <= 0) continue;

    await tx.salesCreditNoteApplication.create({
      data: {
        creditNoteId: creditNote.id,
        invoiceId: invoice.id,
        amount: roundedAmount,
        companyId,
      },
    });

    // Determinar nuevo estado de la factura compensada
    const newPending = invoice.pendingAmount - roundedAmount;
    const newStatus = newPending <= 0.005 ? 'PAID' : 'PARTIAL_PAID';

    await tx.salesInvoice.update({
      where: { id: invoice.id },
      data: { status: newStatus },
    });

    applications.push({ invoiceId: invoice.id, amount: roundedAmount });
    remaining -= roundedAmount;
  }

  if (applications.length > 0) {
    // Marcar la propia NC como PAID
    await tx.salesInvoice.update({
      where: { id: creditNote.id },
      data: { status: remaining <= 0.005 ? 'PAID' : 'PARTIAL_PAID' },
    });

    logger.info('NC de venta compensada automáticamente', {
      data: {
        creditNoteId: creditNote.id,
        applications,
        remainingUnapplied: Math.round(remaining * 100) / 100,
      },
    });
  }

  return applications;
}

/**
 * Aplica automáticamente una NC de compra contra facturas/ND pendientes del mismo proveedor.
 * Algoritmo: factura original primero, luego FIFO (más antigua primero).
 */
export async function applyPurchaseCreditNote(
  tx: TransactionClient,
  creditNote: CreditNoteForCompensation,
  companyId: string
) {
  let remaining = Number(creditNote.total);

  if (remaining <= 0) return [];

  // Buscar facturas/ND pendientes del mismo proveedor (excluir NC)
  const pendingInvoices = await tx.purchaseInvoice.findMany({
    where: {
      companyId,
      supplierId: creditNote.supplierId,
      status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
      voucherType: { notIn: CREDIT_NOTE_TYPES },
    },
    select: {
      id: true,
      total: true,
      issueDate: true,
      paymentOrderItems: {
        where: { paymentOrder: { status: 'CONFIRMED' } },
        select: { amount: true },
      },
      creditNoteApplicationsReceived: {
        select: { amount: true, creditNoteId: true },
      },
      creditDebitNotes: {
        where: { voucherType: { in: CREDIT_NOTE_TYPES }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
        select: { id: true, total: true },
      },
    },
    orderBy: { issueDate: 'asc' },
  });

  // Calcular pendiente real de cada factura (incluyendo NC históricas via fallback)
  const invoicesWithPending = pendingInvoices.map((inv) => {
    const paymentsPaid = inv.paymentOrderItems.reduce(
      (sum, item) => sum + Number(item.amount),
      0
    );
    const cnAppliedExplicit = inv.creditNoteApplicationsReceived.reduce(
      (sum, app) => sum + Number(app.amount),
      0
    );
    // Fallback: NC vinculadas por originalInvoiceId sin registro explícito
    const explicitCNIds = new Set(
      inv.creditNoteApplicationsReceived.map((app) => app.creditNoteId)
    );
    const cnLinkedFallback = inv.creditDebitNotes
      .filter((doc) => !explicitCNIds.has(doc.id))
      .reduce((sum, doc) => sum + Number(doc.total), 0);

    const pendingAmount = Number(inv.total) - paymentsPaid - cnAppliedExplicit - cnLinkedFallback;
    return { id: inv.id, pendingAmount };
  }).filter((inv) => inv.pendingAmount > 0.005);

  // Si el usuario seleccionó una factura original, aplicar SOLO a esa factura
  // Si no seleccionó, aplicar FIFO contra todas las pendientes
  if (creditNote.originalInvoiceId) {
    const originalInvoice = invoicesWithPending.find(
      (inv) => inv.id === creditNote.originalInvoiceId
    );
    if (originalInvoice) {
      invoicesWithPending.length = 0;
      invoicesWithPending.push(originalInvoice);
    } else {
      logger.info('NC tiene factura original pero sin saldo pendiente, no se auto-compensa', {
        data: { creditNoteId: creditNote.id, originalInvoiceId: creditNote.originalInvoiceId },
      });
      return [];
    }
  }

  const applications: { invoiceId: string; amount: number }[] = [];

  for (const invoice of invoicesWithPending) {
    if (remaining <= 0.005) break;

    const applyAmount = Math.min(remaining, invoice.pendingAmount);
    const roundedAmount = Math.round(applyAmount * 100) / 100;

    if (roundedAmount <= 0) continue;

    await tx.purchaseCreditNoteApplication.create({
      data: {
        creditNoteId: creditNote.id,
        invoiceId: invoice.id,
        amount: roundedAmount,
        companyId,
      },
    });

    // Determinar nuevo estado de la factura compensada
    const newPending = invoice.pendingAmount - roundedAmount;
    const newStatus = newPending <= 0.005 ? 'PAID' : 'PARTIAL_PAID';

    await tx.purchaseInvoice.update({
      where: { id: invoice.id },
      data: { status: newStatus },
    });

    applications.push({ invoiceId: invoice.id, amount: roundedAmount });
    remaining -= roundedAmount;
  }

  if (applications.length > 0) {
    // Marcar la propia NC como PAID
    await tx.purchaseInvoice.update({
      where: { id: creditNote.id },
      data: { status: remaining <= 0.005 ? 'PAID' : 'PARTIAL_PAID' },
    });

    logger.info('NC de compra compensada automáticamente', {
      data: {
        creditNoteId: creditNote.id,
        applications,
        remainingUnapplied: Math.round(remaining * 100) / 100,
      },
    });
  }

  return applications;
}
