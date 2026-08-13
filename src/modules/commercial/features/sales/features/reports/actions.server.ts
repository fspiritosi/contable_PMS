'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import moment from 'moment';

// ============================================
// VENTAS POR PERÍODO
// ============================================

export async function getSalesByPeriod(startDate: Date, endDate: Date) {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        issueDate: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'],
        },
      },
      select: {
        id: true,
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        status: true,
        customer: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        issueDate: 'desc',
      },
    });

    // Calcular totales
    const totals = invoices.reduce(
      (acc, inv) => ({
        subtotal: acc.subtotal + Number(inv.subtotal),
        vatAmount: acc.vatAmount + Number(inv.vatAmount),
        total: acc.total + Number(inv.total),
        count: acc.count + 1,
      }),
      { subtotal: 0, vatAmount: 0, total: 0, count: 0 }
    );

    return { invoices, totals };
  } catch (error) {
    logger.error('Error al obtener ventas por período', {
      data: { companyId, error },
    });
    throw new Error('Error al obtener ventas');
  }
}

// ============================================
// VENTAS POR CLIENTE
// ============================================

export async function getSalesByCustomer(startDate: Date, endDate: Date) {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        issueDate: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'],
        },
      },
      select: {
        customerId: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        customer: {
          select: {
            name: true,
            taxId: true,
          },
        },
      },
    });

    // Agrupar por cliente
    const customerMap = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        taxId: string | null;
        invoiceCount: number;
        subtotal: number;
        vatAmount: number;
        total: number;
      }
    >();

    for (const inv of invoices) {
      const existing = customerMap.get(inv.customerId);
      if (existing) {
        existing.invoiceCount += 1;
        existing.subtotal += Number(inv.subtotal);
        existing.vatAmount += Number(inv.vatAmount);
        existing.total += Number(inv.total);
      } else {
        customerMap.set(inv.customerId, {
          customerId: inv.customerId,
          customerName: inv.customer.name,
          taxId: inv.customer.taxId,
          invoiceCount: 1,
          subtotal: Number(inv.subtotal),
          vatAmount: Number(inv.vatAmount),
          total: Number(inv.total),
        });
      }
    }

    // Convertir a array y ordenar por total descendente
    const salesByCustomer = Array.from(customerMap.values()).sort(
      (a, b) => b.total - a.total
    );

    const totals = {
      subtotal: salesByCustomer.reduce((sum, c) => sum + c.subtotal, 0),
      vatAmount: salesByCustomer.reduce((sum, c) => sum + c.vatAmount, 0),
      total: salesByCustomer.reduce((sum, c) => sum + c.total, 0),
      customerCount: salesByCustomer.length,
    };

    return { salesByCustomer, totals };
  } catch (error) {
    logger.error('Error al obtener ventas por cliente', {
      data: { companyId, error },
    });
    throw new Error('Error al obtener ventas por cliente');
  }
}

// ============================================
// VENTAS POR PRODUCTO
// ============================================

export async function getSalesByProduct(startDate: Date, endDate: Date) {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const lines = await prisma.salesInvoiceLine.findMany({
      where: {
        invoice: {
          companyId,
          issueDate: {
            gte: startDate,
            lte: endDate,
          },
          status: {
            in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'],
          },
        },
      },
      select: {
        productId: true,
        quantity: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        product: {
          select: {
            code: true,
            name: true,
            unitOfMeasure: true,
          },
        },
      },
    });

    // Agrupar por ítem
    const productMap = new Map<
      string,
      {
        productId: string;
        productCode: string;
        productName: string;
        unitOfMeasure: string;
        quantity: number;
        subtotal: number;
        vatAmount: number;
        total: number;
      }
    >();

    for (const line of lines) {
      const existing = productMap.get(line.productId);
      if (existing) {
        existing.quantity += Number(line.quantity);
        existing.subtotal += Number(line.subtotal);
        existing.vatAmount += Number(line.vatAmount);
        existing.total += Number(line.total);
      } else {
        productMap.set(line.productId, {
          productId: line.productId,
          productCode: line.product.code,
          productName: line.product.name,
          unitOfMeasure: line.product.unitOfMeasure,
          quantity: Number(line.quantity),
          subtotal: Number(line.subtotal),
          vatAmount: Number(line.vatAmount),
          total: Number(line.total),
        });
      }
    }

    // Convertir a array y ordenar por total descendente
    const salesByProduct = Array.from(productMap.values()).sort(
      (a, b) => b.total - a.total
    );

    const totals = {
      subtotal: salesByProduct.reduce((sum, p) => sum + p.subtotal, 0),
      vatAmount: salesByProduct.reduce((sum, p) => sum + p.vatAmount, 0),
      total: salesByProduct.reduce((sum, p) => sum + p.total, 0),
      productCount: salesByProduct.length,
    };

    return { salesByProduct, totals };
  } catch (error) {
    logger.error('Error al obtener ventas por ítem', {
      data: { companyId, error },
    });
    throw new Error('Error al obtener ventas por ítem');
  }
}

// ============================================
// LIBRO IVA VENTAS
// ============================================

export async function getVATSalesBook(startDate: Date, endDate: Date) {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        issueDate: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'],
        },
      },
      select: {
        id: true,
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        cae: true,
        customer: {
          select: {
            name: true,
            taxId: true,
            taxCondition: true,
          },
        },
        lines: {
          select: {
            vatRate: true,
            subtotal: true,
            vatAmount: true,
          },
        },
      },
      orderBy: [
        { issueDate: 'asc' },
        { fullNumber: 'asc' },
      ],
    });

    // Procesar cada factura con detalle de IVA por alícuota
    const vatBook = invoices.map((invoice) => {
      // Agrupar IVA por alícuota
      const vatByRate = new Map<number, { base: number; amount: number }>();

      for (const line of invoice.lines) {
        const rate = Number(line.vatRate);
        const subtotal = Number(line.subtotal);
        const vatAmount = Number(line.vatAmount);

        if (vatByRate.has(rate)) {
          const existing = vatByRate.get(rate)!;
          vatByRate.set(rate, {
            base: existing.base + subtotal,
            amount: existing.amount + vatAmount,
          });
        } else {
          vatByRate.set(rate, { base: subtotal, amount: vatAmount });
        }
      }

      return {
        id: invoice.id,
        fullNumber: invoice.fullNumber,
        voucherType: invoice.voucherType,
        issueDate: invoice.issueDate,
        customerName: invoice.customer.name,
        customerTaxId: invoice.customer.taxId,
        customerTaxCondition: invoice.customer.taxCondition,
        subtotal: Number(invoice.subtotal),
        vatAmount: Number(invoice.vatAmount),
        total: Number(invoice.total),
        cae: invoice.cae,
        vatByRate: Array.from(vatByRate.entries())
          .map(([rate, data]) => ({
            rate,
            base: data.base,
            amount: data.amount,
          }))
          .sort((a, b) => b.rate - a.rate),
      };
    });

    // Totales
    const totals = {
      subtotal: vatBook.reduce((sum, inv) => sum + inv.subtotal, 0),
      vatAmount: vatBook.reduce((sum, inv) => sum + inv.vatAmount, 0),
      total: vatBook.reduce((sum, inv) => sum + inv.total, 0),
      invoiceCount: vatBook.length,
    };

    // Totales por alícuota de IVA
    const vatTotalsByRate = new Map<number, { base: number; amount: number }>();
    for (const inv of vatBook) {
      for (const vat of inv.vatByRate) {
        if (vatTotalsByRate.has(vat.rate)) {
          const existing = vatTotalsByRate.get(vat.rate)!;
          vatTotalsByRate.set(vat.rate, {
            base: existing.base + vat.base,
            amount: existing.amount + vat.amount,
          });
        } else {
          vatTotalsByRate.set(vat.rate, {
            base: vat.base,
            amount: vat.amount,
          });
        }
      }
    }

    const vatSummary = Array.from(vatTotalsByRate.entries())
      .map(([rate, data]) => ({
        rate,
        base: data.base,
        amount: data.amount,
      }))
      .sort((a, b) => b.rate - a.rate);

    return { vatBook, totals, vatSummary };
  } catch (error) {
    logger.error('Error al obtener libro IVA ventas', {
      data: { companyId, error },
    });
    throw new Error('Error al obtener libro IVA ventas');
  }
}
