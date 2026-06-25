'use server';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import type { LibroIVAResult, FiscalPositionResult, VATRateDetail, LibroIVAEntry } from './types';

// ============================================
// LIBRO IVA VENTAS
// ============================================

export async function getLibroIVAVentas(
  from: Date,
  to: Date
): Promise<LibroIVAResult> {
  await checkPermission('commercial.invoices', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        issueDate: { gte: from, lte: to },
        status: { not: 'CANCELLED' },
      },
      select: {
        id: true,
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        subtotal: true,
        netTaxed: true,
        netNonTaxed: true,
        netExempt: true,
        otherTaxes: true,
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
            lineType: true,
            vatRate: true,
            vatAmount: true,
            subtotal: true,
          },
        },
        perceptions: {
          select: { amount: true },
        },
      },
      orderBy: [{ issueDate: 'asc' }, { fullNumber: 'asc' }],
    });

    const entries: LibroIVAEntry[] = invoices.map((inv) => {
      const ivaByRate = { 25: 0, 5: 0, 105: 0, 21: 0, 27: 0 };

      for (const line of inv.lines) {
        if (line.lineType !== 'TAXED') continue;
        const rate = Number(line.vatRate);
        const amount = Number(line.vatAmount);

        if (rate === 2.5) ivaByRate[25] += amount;
        else if (rate === 5) ivaByRate[5] += amount;
        else if (rate === 10.5) ivaByRate[105] += amount;
        else if (rate === 21) ivaByRate[21] += amount;
        else if (rate === 27) ivaByRate[27] += amount;
      }

      const percTotal = inv.perceptions.reduce((s, p) => s + Number(p.amount), 0);

      return {
        id: inv.id,
        fullNumber: inv.fullNumber,
        voucherType: inv.voucherType,
        issueDate: inv.issueDate,
        entityName: inv.customer.name,
        entityTaxId: inv.customer.taxId,
        entityTaxCondition: inv.customer.taxCondition,
        subtotal: Number(inv.subtotal),
        netTaxed: Number(inv.netTaxed),
        netNonTaxed: Number(inv.netNonTaxed),
        netExempt: Number(inv.netExempt),
        iva25: ivaByRate[25],
        iva5: ivaByRate[5],
        iva105: ivaByRate[105],
        iva21: ivaByRate[21],
        iva27: ivaByRate[27],
        perceptions: percTotal,
        otherTaxes: Number(inv.otherTaxes),
        total: Number(inv.total),
        cae: inv.cae,
      };
    });

    const ZERO_TOTALS = {
      subtotal: 0, netTaxed: 0, netNonTaxed: 0, netExempt: 0,
      iva25: 0, iva5: 0, iva105: 0, iva21: 0, iva27: 0,
      perceptions: 0, otherTaxes: 0, total: 0, entryCount: 0,
    };

    const totals = entries.reduce(
      (acc, e) => ({
        subtotal: acc.subtotal + e.subtotal,
        netTaxed: acc.netTaxed + e.netTaxed,
        netNonTaxed: acc.netNonTaxed + e.netNonTaxed,
        netExempt: acc.netExempt + e.netExempt,
        iva25: acc.iva25 + e.iva25,
        iva5: acc.iva5 + e.iva5,
        iva105: acc.iva105 + e.iva105,
        iva21: acc.iva21 + e.iva21,
        iva27: acc.iva27 + e.iva27,
        perceptions: acc.perceptions + e.perceptions,
        otherTaxes: acc.otherTaxes + e.otherTaxes,
        total: acc.total + e.total,
        entryCount: acc.entryCount + 1,
      }),
      ZERO_TOTALS
    );

    return { entries, totals };
  } catch (error) {
    logger.error('Error al obtener Libro IVA Ventas', { data: { companyId, error } });
    throw new Error('Error al obtener Libro IVA Ventas');
  }
}

// ============================================
// LIBRO IVA COMPRAS
// ============================================

export async function getLibroIVACompras(
  from: Date,
  to: Date
): Promise<LibroIVAResult> {
  await checkPermission('commercial.purchases', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        issueDate: { gte: from, lte: to },
        status: { not: 'CANCELLED' },
      },
      select: {
        id: true,
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        subtotal: true,
        netTaxed: true,
        netNonTaxed: true,
        netExempt: true,
        otherTaxes: true,
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
            lineType: true,
            vatRate: true,
            vatAmount: true,
            subtotal: true,
          },
        },
        perceptions: {
          select: { amount: true },
        },
      },
      orderBy: [{ issueDate: 'asc' }, { fullNumber: 'asc' }],
    });

    const entries: LibroIVAEntry[] = invoices.map((inv) => {
      const ivaByRate = { 25: 0, 5: 0, 105: 0, 21: 0, 27: 0 };

      for (const line of inv.lines) {
        if (line.lineType !== 'TAXED') continue;
        const rate = Number(line.vatRate);
        const amount = Number(line.vatAmount);

        if (rate === 2.5) ivaByRate[25] += amount;
        else if (rate === 5) ivaByRate[5] += amount;
        else if (rate === 10.5) ivaByRate[105] += amount;
        else if (rate === 21) ivaByRate[21] += amount;
        else if (rate === 27) ivaByRate[27] += amount;
      }

      const percTotal = inv.perceptions.reduce((s, p) => s + Number(p.amount), 0);

      return {
        id: inv.id,
        fullNumber: inv.fullNumber,
        voucherType: inv.voucherType,
        issueDate: inv.issueDate,
        entityName: inv.supplier.businessName,
        entityTaxId: inv.supplier.taxId,
        entityTaxCondition: inv.supplier.taxCondition,
        subtotal: Number(inv.subtotal),
        netTaxed: Number(inv.netTaxed),
        netNonTaxed: Number(inv.netNonTaxed),
        netExempt: Number(inv.netExempt),
        iva25: ivaByRate[25],
        iva5: ivaByRate[5],
        iva105: ivaByRate[105],
        iva21: ivaByRate[21],
        iva27: ivaByRate[27],
        perceptions: percTotal,
        otherTaxes: Number(inv.otherTaxes),
        total: Number(inv.total),
        cae: inv.cae,
      };
    });

    const ZERO_TOTALS = {
      subtotal: 0, netTaxed: 0, netNonTaxed: 0, netExempt: 0,
      iva25: 0, iva5: 0, iva105: 0, iva21: 0, iva27: 0,
      perceptions: 0, otherTaxes: 0, total: 0, entryCount: 0,
    };

    const totals = entries.reduce(
      (acc, e) => ({
        subtotal: acc.subtotal + e.subtotal,
        netTaxed: acc.netTaxed + e.netTaxed,
        netNonTaxed: acc.netNonTaxed + e.netNonTaxed,
        netExempt: acc.netExempt + e.netExempt,
        iva25: acc.iva25 + e.iva25,
        iva5: acc.iva5 + e.iva5,
        iva105: acc.iva105 + e.iva105,
        iva21: acc.iva21 + e.iva21,
        iva27: acc.iva27 + e.iva27,
        perceptions: acc.perceptions + e.perceptions,
        otherTaxes: acc.otherTaxes + e.otherTaxes,
        total: acc.total + e.total,
        entryCount: acc.entryCount + 1,
      }),
      ZERO_TOTALS
    );

    return { entries, totals };
  } catch (error) {
    logger.error('Error al obtener Libro IVA Compras', { data: { companyId, error } });
    throw new Error('Error al obtener Libro IVA Compras');
  }
}

// ============================================
// POSICIÓN FISCAL (IVA Ventas - IVA Compras)
// ============================================

export async function getIVAPositionReport(
  from: Date,
  to: Date
): Promise<FiscalPositionResult> {
  // Necesita permisos de ambos módulos
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  await checkPermission('commercial.purchases', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Obtener IVA de ventas por alícuota (solo líneas gravadas)
    const salesLines = await prisma.salesInvoiceLine.findMany({
      where: {
        lineType: 'TAXED',
        invoice: {
          companyId,
          issueDate: { gte: from, lte: to },
          status: { not: 'CANCELLED' },
        },
      },
      select: {
        vatRate: true,
        subtotal: true,
        vatAmount: true,
      },
    });

    // Obtener IVA de compras por alícuota (solo líneas gravadas)
    const purchaseLines = await prisma.purchaseInvoiceLine.findMany({
      where: {
        lineType: 'TAXED',
        invoice: {
          companyId,
          issueDate: { gte: from, lte: to },
          status: { not: 'CANCELLED' },
        },
      },
      select: {
        vatRate: true,
        subtotal: true,
        vatAmount: true,
      },
    });

    // Agrupar por alícuota
    const rateMap = new Map<number, VATRateDetail>();
    const rates = [2.5, 5, 10.5, 21, 27];

    for (const rate of rates) {
      rateMap.set(rate, {
        rate,
        salesBase: 0,
        salesVAT: 0,
        purchasesBase: 0,
        purchasesVAT: 0,
        position: 0,
      });
    }

    for (const line of salesLines) {
      const rate = Number(line.vatRate);
      const existing = rateMap.get(rate);
      if (existing) {
        existing.salesBase += Number(line.subtotal);
        existing.salesVAT += Number(line.vatAmount);
      } else {
        rateMap.set(rate, {
          rate,
          salesBase: Number(line.subtotal),
          salesVAT: Number(line.vatAmount),
          purchasesBase: 0,
          purchasesVAT: 0,
          position: 0,
        });
      }
    }

    for (const line of purchaseLines) {
      const rate = Number(line.vatRate);
      const existing = rateMap.get(rate);
      if (existing) {
        existing.purchasesBase += Number(line.subtotal);
        existing.purchasesVAT += Number(line.vatAmount);
      } else {
        rateMap.set(rate, {
          rate,
          salesBase: 0,
          salesVAT: 0,
          purchasesBase: Number(line.subtotal),
          purchasesVAT: Number(line.vatAmount),
          position: 0,
        });
      }
    }

    // Calcular posición por alícuota
    const detailByRate = Array.from(rateMap.values())
      .map((detail) => ({
        ...detail,
        position: detail.salesVAT - detail.purchasesVAT,
      }))
      .filter((d) => d.salesVAT > 0 || d.purchasesVAT > 0)
      .sort((a, b) => a.rate - b.rate);

    const ivaVentas = detailByRate.reduce((sum, d) => sum + d.salesVAT, 0);
    const ivaCompras = detailByRate.reduce((sum, d) => sum + d.purchasesVAT, 0);

    return {
      ivaVentas,
      ivaCompras,
      posicion: ivaVentas - ivaCompras,
      detailByRate,
    };
  } catch (error) {
    logger.error('Error al obtener posición fiscal', { data: { companyId, error } });
    throw new Error('Error al obtener posición fiscal');
  }
}
