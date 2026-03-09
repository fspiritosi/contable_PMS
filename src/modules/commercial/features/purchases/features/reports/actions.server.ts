'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';

// ============================================
// COMPRAS POR PERÍODO
// ============================================

export async function getPurchasesByPeriod(startDate: Date, endDate: Date, supplierId?: string) {
  await checkPermission('commercial.purchases', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        issueDate: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'],
        },
        ...(supplierId ? { supplierId } : {}),
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
        supplier: {
          select: {
            businessName: true,
          },
        },
      },
      orderBy: {
        issueDate: 'desc',
      },
    });

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
    logger.error('Error al obtener compras por período', {
      data: { companyId, error },
    });
    throw new Error('Error al obtener compras');
  }
}

// ============================================
// COMPRAS POR PROVEEDOR
// ============================================

export async function getPurchasesBySupplier(startDate: Date, endDate: Date, supplierId?: string) {
  await checkPermission('commercial.purchases', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        issueDate: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'],
        },
        ...(supplierId ? { supplierId } : {}),
      },
      select: {
        supplierId: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        supplier: {
          select: {
            businessName: true,
            taxId: true,
          },
        },
      },
    });

    // Agrupar por proveedor
    const supplierMap = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        taxId: string;
        invoiceCount: number;
        subtotal: number;
        vatAmount: number;
        total: number;
      }
    >();

    for (const inv of invoices) {
      const existing = supplierMap.get(inv.supplierId);
      if (existing) {
        existing.invoiceCount += 1;
        existing.subtotal += Number(inv.subtotal);
        existing.vatAmount += Number(inv.vatAmount);
        existing.total += Number(inv.total);
      } else {
        supplierMap.set(inv.supplierId, {
          supplierId: inv.supplierId,
          supplierName: inv.supplier.businessName,
          taxId: inv.supplier.taxId,
          invoiceCount: 1,
          subtotal: Number(inv.subtotal),
          vatAmount: Number(inv.vatAmount),
          total: Number(inv.total),
        });
      }
    }

    const purchasesBySupplier = Array.from(supplierMap.values()).sort(
      (a, b) => b.total - a.total
    );

    const totals = {
      subtotal: purchasesBySupplier.reduce((sum, s) => sum + s.subtotal, 0),
      vatAmount: purchasesBySupplier.reduce((sum, s) => sum + s.vatAmount, 0),
      total: purchasesBySupplier.reduce((sum, s) => sum + s.total, 0),
      supplierCount: purchasesBySupplier.length,
    };

    return { purchasesBySupplier, totals };
  } catch (error) {
    logger.error('Error al obtener compras por proveedor', {
      data: { companyId, error },
    });
    throw new Error('Error al obtener compras por proveedor');
  }
}

// ============================================
// COMPRAS POR PRODUCTO
// ============================================

export async function getPurchasesByProduct(startDate: Date, endDate: Date, supplierId?: string) {
  await checkPermission('commercial.purchases', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const lines = await prisma.purchaseInvoiceLine.findMany({
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
          ...(supplierId ? { supplierId } : {}),
        },
      },
      select: {
        productId: true,
        description: true,
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

    // Agrupar por producto (o descripción si no tiene producto)
    const productMap = new Map<
      string,
      {
        productId: string | null;
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
      const key = line.productId || `desc:${line.description}`;
      const existing = productMap.get(key);
      if (existing) {
        existing.quantity += Number(line.quantity);
        existing.subtotal += Number(line.subtotal);
        existing.vatAmount += Number(line.vatAmount);
        existing.total += Number(line.total);
      } else {
        productMap.set(key, {
          productId: line.productId,
          productCode: line.product?.code || '-',
          productName: line.product?.name || line.description,
          unitOfMeasure: line.product?.unitOfMeasure || 'UN',
          quantity: Number(line.quantity),
          subtotal: Number(line.subtotal),
          vatAmount: Number(line.vatAmount),
          total: Number(line.total),
        });
      }
    }

    const purchasesByProduct = Array.from(productMap.values()).sort(
      (a, b) => b.total - a.total
    );

    const totals = {
      subtotal: purchasesByProduct.reduce((sum, p) => sum + p.subtotal, 0),
      vatAmount: purchasesByProduct.reduce((sum, p) => sum + p.vatAmount, 0),
      total: purchasesByProduct.reduce((sum, p) => sum + p.total, 0),
      productCount: purchasesByProduct.length,
    };

    return { purchasesByProduct, totals };
  } catch (error) {
    logger.error('Error al obtener compras por producto', {
      data: { companyId, error },
    });
    throw new Error('Error al obtener compras por producto');
  }
}

// ============================================
// LIBRO IVA COMPRAS
// ============================================

export async function getVATPurchaseBook(startDate: Date, endDate: Date, supplierId?: string) {
  await checkPermission('commercial.purchases', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        issueDate: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'],
        },
        ...(supplierId ? { supplierId } : {}),
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
        supplier: {
          select: {
            businessName: true,
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
        supplierName: invoice.supplier.businessName,
        supplierTaxId: invoice.supplier.taxId,
        supplierTaxCondition: invoice.supplier.taxCondition,
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
    logger.error('Error al obtener libro IVA compras', {
      data: { companyId, error },
    });
    throw new Error('Error al obtener libro IVA compras');
  }
}
