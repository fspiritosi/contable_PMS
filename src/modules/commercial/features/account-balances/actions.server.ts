'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { CREDIT_NOTE_TYPES } from '@/modules/commercial/shared/voucher-utils';
import moment from 'moment';
import 'moment/locale/es';

moment.locale('es');

interface PendingInvoiceItem {
  id: string;
  fullNumber: string;
  voucherType: string;
  issueDate: Date;
  dueDate: Date | null;
  total: number;
  paid: number;
  pending: number;
  daysOverdue: number;
}

interface ReceivableItem extends PendingInvoiceItem {
  customerId: string;
  customerName: string;
  customerTaxId: string | null;
}

interface PayableItem extends PendingInvoiceItem {
  supplierId: string;
  supplierName: string;
  supplierTaxId: string | null;
}

// ============================================
// PENDIENTE DE COBRANZA (Cuentas a Cobrar)
// ============================================

export async function getAccountsReceivable(startDate?: Date, endDate?: Date, overdueOnly?: boolean) {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  // Filtro de fecha: si hay rango filtra por issueDate, sino trae todas las pendientes
  const dateFilter: Record<string, Date> = {};
  if (startDate) dateFilter.gte = startDate;
  if (endDate) dateFilter.lte = endDate;

  try {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
        voucherType: { notIn: CREDIT_NOTE_TYPES },
        ...(Object.keys(dateFilter).length > 0 ? { issueDate: dateFilter } : {}),
      },
      select: {
        id: true,
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        dueDate: true,
        total: true,
        customerId: true,
        customer: {
          select: { name: true, taxId: true },
        },
        receiptItems: {
          where: { receipt: { status: 'CONFIRMED' } },
          select: { amount: true },
        },
        creditNoteApplicationsReceived: {
          select: { amount: true, creditNoteId: true },
        },
        creditDebitNotes: {
          where: {
            voucherType: { in: CREDIT_NOTE_TYPES },
            status: { notIn: ['DRAFT', 'CANCELLED'] },
          },
          select: { id: true, total: true },
        },
      },
      orderBy: { issueDate: 'asc' },
    });

    const today = moment();
    const items: ReceivableItem[] = [];

    for (const inv of invoices) {
      const receiptsPaid = inv.receiptItems.reduce(
        (sum, item) => sum + Number(item.amount),
        0
      );
      const cnAppliedExplicit = inv.creditNoteApplicationsReceived.reduce(
        (sum, app) => sum + Number(app.amount),
        0
      );
      const explicitCNIds = new Set(
        inv.creditNoteApplicationsReceived.map((app) => app.creditNoteId)
      );
      const cnLinkedFallback = inv.creditDebitNotes
        .filter((doc) => !explicitCNIds.has(doc.id))
        .reduce((sum, doc) => sum + Number(doc.total), 0);

      const totalPaid = receiptsPaid + cnAppliedExplicit + cnLinkedFallback;
      const pending = Number(inv.total) - totalPaid;

      if (pending <= 0.005) continue;

      const daysOverdue = inv.dueDate
        ? Math.max(0, today.diff(moment(inv.dueDate), 'days'))
        : 0;

      if (overdueOnly && daysOverdue === 0) continue;

      items.push({
        id: inv.id,
        fullNumber: inv.fullNumber,
        voucherType: inv.voucherType,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        total: Number(inv.total),
        paid: totalPaid,
        pending: Math.round(pending * 100) / 100,
        daysOverdue,
        customerId: inv.customerId,
        customerName: inv.customer.name,
        customerTaxId: inv.customer.taxId,
      });
    }

    // Agrupar por cliente
    const byCustomer = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        customerTaxId: string | null;
        invoiceCount: number;
        totalAmount: number;
        totalPaid: number;
        totalPending: number;
        invoices: ReceivableItem[];
      }
    >();

    for (const item of items) {
      const existing = byCustomer.get(item.customerId);
      if (existing) {
        existing.invoiceCount += 1;
        existing.totalAmount += item.total;
        existing.totalPaid += item.paid;
        existing.totalPending += item.pending;
        existing.invoices.push(item);
      } else {
        byCustomer.set(item.customerId, {
          customerId: item.customerId,
          customerName: item.customerName,
          customerTaxId: item.customerTaxId,
          invoiceCount: 1,
          totalAmount: item.total,
          totalPaid: item.paid,
          totalPending: item.pending,
          invoices: [item],
        });
      }
    }

    const customerBalances = Array.from(byCustomer.values())
      .sort((a, b) => b.totalPending - a.totalPending)
      .map((c) => ({
        ...c,
        totalAmount: Math.round(c.totalAmount * 100) / 100,
        totalPaid: Math.round(c.totalPaid * 100) / 100,
        totalPending: Math.round(c.totalPending * 100) / 100,
      }));

    const totals = {
      totalAmount: customerBalances.reduce((sum, c) => sum + c.totalAmount, 0),
      totalPaid: customerBalances.reduce((sum, c) => sum + c.totalPaid, 0),
      totalPending: customerBalances.reduce((sum, c) => sum + c.totalPending, 0),
      customerCount: customerBalances.length,
      invoiceCount: items.length,
    };

    return { items, customerBalances, totals };
  } catch (error) {
    logger.error('Error al obtener pendiente de cobranza', {
      data: { companyId, error },
    });
    throw new Error('Error al obtener pendiente de cobranza');
  }
}

// ============================================
// PENDIENTE DE PAGO (Cuentas a Pagar)
// ============================================

export async function getAccountsPayable(startDate?: Date, endDate?: Date, overdueOnly?: boolean) {
  await checkPermission('commercial.purchases', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const dateFilter: Record<string, Date> = {};
  if (startDate) dateFilter.gte = startDate;
  if (endDate) dateFilter.lte = endDate;

  try {
    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
        voucherType: { notIn: CREDIT_NOTE_TYPES },
        ...(Object.keys(dateFilter).length > 0 ? { issueDate: dateFilter } : {}),
      },
      select: {
        id: true,
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        dueDate: true,
        total: true,
        supplierId: true,
        supplier: {
          select: { businessName: true, taxId: true },
        },
        paymentOrderItems: {
          where: { paymentOrder: { status: 'CONFIRMED' } },
          select: { amount: true },
        },
        creditNoteApplicationsReceived: {
          select: { amount: true, creditNoteId: true },
        },
        creditDebitNotes: {
          where: {
            voucherType: { in: CREDIT_NOTE_TYPES },
            status: { notIn: ['DRAFT', 'CANCELLED'] },
          },
          select: { id: true, total: true },
        },
      },
      orderBy: { issueDate: 'asc' },
    });

    const today = moment();
    const items: PayableItem[] = [];

    for (const inv of invoices) {
      const paymentsPaid = inv.paymentOrderItems.reduce(
        (sum, item) => sum + Number(item.amount),
        0
      );
      const cnAppliedExplicit = inv.creditNoteApplicationsReceived.reduce(
        (sum, app) => sum + Number(app.amount),
        0
      );
      const explicitCNIds = new Set(
        inv.creditNoteApplicationsReceived.map((app) => app.creditNoteId)
      );
      const cnLinkedFallback = inv.creditDebitNotes
        .filter((doc) => !explicitCNIds.has(doc.id))
        .reduce((sum, doc) => sum + Number(doc.total), 0);

      const totalPaid = paymentsPaid + cnAppliedExplicit + cnLinkedFallback;
      const pending = Number(inv.total) - totalPaid;

      if (pending <= 0.005) continue;

      const daysOverdue = inv.dueDate
        ? Math.max(0, today.diff(moment(inv.dueDate), 'days'))
        : 0;

      if (overdueOnly && daysOverdue === 0) continue;

      items.push({
        id: inv.id,
        fullNumber: inv.fullNumber,
        voucherType: inv.voucherType,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        total: Number(inv.total),
        paid: totalPaid,
        pending: Math.round(pending * 100) / 100,
        daysOverdue,
        supplierId: inv.supplierId,
        supplierName: inv.supplier.businessName,
        supplierTaxId: inv.supplier.taxId,
      });
    }

    // Agrupar por proveedor
    const bySupplier = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        supplierTaxId: string | null;
        invoiceCount: number;
        totalAmount: number;
        totalPaid: number;
        totalPending: number;
        invoices: PayableItem[];
      }
    >();

    for (const item of items) {
      const existing = bySupplier.get(item.supplierId);
      if (existing) {
        existing.invoiceCount += 1;
        existing.totalAmount += item.total;
        existing.totalPaid += item.paid;
        existing.totalPending += item.pending;
        existing.invoices.push(item);
      } else {
        bySupplier.set(item.supplierId, {
          supplierId: item.supplierId,
          supplierName: item.supplierName,
          supplierTaxId: item.supplierTaxId,
          invoiceCount: 1,
          totalAmount: item.total,
          totalPaid: item.paid,
          totalPending: item.pending,
          invoices: [item],
        });
      }
    }

    const supplierBalances = Array.from(bySupplier.values())
      .sort((a, b) => b.totalPending - a.totalPending)
      .map((s) => ({
        ...s,
        totalAmount: Math.round(s.totalAmount * 100) / 100,
        totalPaid: Math.round(s.totalPaid * 100) / 100,
        totalPending: Math.round(s.totalPending * 100) / 100,
      }));

    const totals = {
      totalAmount: supplierBalances.reduce((sum, s) => sum + s.totalAmount, 0),
      totalPaid: supplierBalances.reduce((sum, s) => sum + s.totalPaid, 0),
      totalPending: supplierBalances.reduce((sum, s) => sum + s.totalPending, 0),
      supplierCount: supplierBalances.length,
      invoiceCount: items.length,
    };

    return { items, supplierBalances, totals };
  } catch (error) {
    logger.error('Error al obtener pendiente de pago', {
      data: { companyId, error },
    });
    throw new Error('Error al obtener pendiente de pago');
  }
}
