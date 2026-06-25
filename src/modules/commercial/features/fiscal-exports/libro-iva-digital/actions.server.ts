'use server';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import moment from 'moment';
import { VOUCHER_TYPE_MAP, IVA_RATE_MAP, DOC_TIPO_MAP } from '@/modules/commercial/features/arca/services/utils';
import { formatVentasCabecera, formatComprasCabecera, formatAlicuota } from './formatters';
import type { LibroIVACabecera, LibroIVAAlicuota, LibroIVAResult } from './types';

// ============================================
// GENERADOR DE LIBRO IVA DIGITAL
// ============================================

export async function generateLibroIVADigital(
  year: number,
  month: number
): Promise<LibroIVAResult> {
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const startDate = moment(`${year}-${month}-01`, 'YYYY-M-DD').startOf('month').toDate();
    const endDate = moment(startDate).endOf('month').toDate();

    // VENTAS
    const salesInvoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        status: 'CONFIRMED',
        issueDate: { gte: startDate, lte: endDate },
      },
      select: {
        voucherType: true,
        number: true,
        issueDate: true,
        total: true,
        netTaxed: true,
        netNonTaxed: true,
        netExempt: true,
        vatAmount: true,
        otherTaxes: true,
        pointOfSale: { select: { number: true } },
        customer: { select: { name: true, taxId: true, taxCondition: true } },
        lines: { select: { lineType: true, vatRate: true, vatAmount: true, subtotal: true } },
        perceptions: { select: { type: true, amount: true } },
      },
      orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
    });

    const ventasCabecera: string[] = [];
    const ventasAlicuotas: string[] = [];

    for (const inv of salesInvoices) {
      const cbteTipo = VOUCHER_TYPE_MAP[inv.voucherType] ?? 0;
      const docTipo = inv.customer.taxId
        ? (inv.customer.taxId.length === 11 ? DOC_TIPO_MAP.CUIT : DOC_TIPO_MAP.DNI)
        : DOC_TIPO_MAP.SIN_IDENTIFICAR;

      const percIva = inv.perceptions
        .filter((p) => p.type === 'IVA')
        .reduce((s, p) => s + Number(p.amount), 0);

      const ivaByRate = new Map<number, { neto: number; iva: number }>();
      for (const line of inv.lines) {
        if (line.lineType !== 'TAXED') continue;
        const rate = Number(line.vatRate);
        const existing = ivaByRate.get(rate) ?? { neto: 0, iva: 0 };
        existing.neto += Number(line.subtotal);
        existing.iva += Number(line.vatAmount);
        ivaByRate.set(rate, existing);
      }

      const cabecera: LibroIVACabecera = {
        fechaComprobante: moment(inv.issueDate).format('YYYYMMDD'),
        tipoComprobante: cbteTipo,
        puntoVenta: inv.pointOfSale.number,
        numeroDesde: inv.number,
        numeroHasta: inv.number,
        codigoDocumento: docTipo,
        numeroDocumento: (inv.customer.taxId ?? '0').replace(/-/g, ''),
        denominacion: inv.customer.name,
        importeTotal: Number(inv.total),
        importeNoGravado: Number(inv.netNonTaxed),
        importeExento: Number(inv.netExempt),
        importePercepciones: percIva,
        importeImpuestosInternos: 0,
        importeIVA: Number(inv.vatAmount),
        moneda: 'PES',
        tipoCambio: 1,
        cantidadAlicuotas: ivaByRate.size || 1,
        codigoOperacion: ' ',
        importePercepcionesIIBB: 0,
        importePercepcionesMunicipales: 0,
        importeCredFiscal: 0,
        otrosTributos: Number(inv.otherTaxes),
      };

      ventasCabecera.push(formatVentasCabecera(cabecera));

      if (ivaByRate.size === 0) {
        ventasAlicuotas.push(
          formatAlicuota({
            tipoComprobante: cbteTipo,
            puntoVenta: inv.pointOfSale.number,
            numero: inv.number,
            importeNeto: Number(inv.netTaxed),
            alicuotaIVA: 3,
            importeIVA: 0,
          })
        );
      } else {
        for (const [rate, amounts] of ivaByRate) {
          ventasAlicuotas.push(
            formatAlicuota({
              tipoComprobante: cbteTipo,
              puntoVenta: inv.pointOfSale.number,
              numero: inv.number,
              importeNeto: amounts.neto,
              alicuotaIVA: IVA_RATE_MAP[rate] ?? 5,
              importeIVA: amounts.iva,
            })
          );
        }
      }
    }

    // COMPRAS
    const purchaseInvoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        status: 'CONFIRMED',
        issueDate: { gte: startDate, lte: endDate },
      },
      select: {
        voucherType: true,
        number: true,
        pointOfSale: true,
        issueDate: true,
        total: true,
        netTaxed: true,
        netNonTaxed: true,
        netExempt: true,
        vatAmount: true,
        otherTaxes: true,
        supplier: { select: { businessName: true, tradeName: true, taxId: true } },
        lines: { select: { lineType: true, vatRate: true, vatAmount: true, subtotal: true } },
        perceptions: { select: { type: true, amount: true } },
      },
      orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
    });

    const comprasCabecera: string[] = [];
    const comprasAlicuotas: string[] = [];

    for (const inv of purchaseInvoices) {
      const cbteTipo = VOUCHER_TYPE_MAP[inv.voucherType] ?? 0;
      const docTipo = inv.supplier.taxId
        ? (inv.supplier.taxId.length === 11 ? DOC_TIPO_MAP.CUIT : DOC_TIPO_MAP.DNI)
        : DOC_TIPO_MAP.SIN_IDENTIFICAR;

      const percIva = inv.perceptions
        .filter((p) => p.type === 'IVA')
        .reduce((s, p) => s + Number(p.amount), 0);
      const percIIBB = inv.perceptions
        .filter((p) => p.type === 'IIBB')
        .reduce((s, p) => s + Number(p.amount), 0);

      const ivaByRate = new Map<number, { neto: number; iva: number }>();
      for (const line of inv.lines) {
        if (line.lineType !== 'TAXED') continue;
        const rate = Number(line.vatRate);
        const existing = ivaByRate.get(rate) ?? { neto: 0, iva: 0 };
        existing.neto += Number(line.subtotal);
        existing.iva += Number(line.vatAmount);
        ivaByRate.set(rate, existing);
      }

      const ptoVta = parseInt(inv.pointOfSale, 10) || 0;
      const nroComprobante = parseInt(inv.number, 10) || 0;

      const cabecera: LibroIVACabecera = {
        fechaComprobante: moment(inv.issueDate).format('YYYYMMDD'),
        tipoComprobante: cbteTipo,
        puntoVenta: ptoVta,
        numeroDesde: nroComprobante,
        numeroHasta: nroComprobante,
        codigoDocumento: docTipo,
        numeroDocumento: (inv.supplier.taxId ?? '0').replace(/-/g, ''),
        denominacion: inv.supplier.tradeName || inv.supplier.businessName,
        importeTotal: Number(inv.total),
        importeNoGravado: Number(inv.netNonTaxed),
        importeExento: Number(inv.netExempt),
        importePercepciones: percIva,
        importeImpuestosInternos: 0,
        importeIVA: Number(inv.vatAmount),
        moneda: 'PES',
        tipoCambio: 1,
        cantidadAlicuotas: ivaByRate.size || 1,
        codigoOperacion: ' ',
        importePercepcionesIIBB: percIIBB,
        importePercepcionesMunicipales: 0,
        importeCredFiscal: Number(inv.vatAmount) + percIva,
        otrosTributos: Number(inv.otherTaxes),
      };

      comprasCabecera.push(formatComprasCabecera(cabecera));

      if (ivaByRate.size === 0) {
        comprasAlicuotas.push(
          formatAlicuota({
            tipoComprobante: cbteTipo,
            puntoVenta: ptoVta,
            numero: nroComprobante,
            importeNeto: Number(inv.netTaxed),
            alicuotaIVA: 3,
            importeIVA: 0,
          })
        );
      } else {
        for (const [rate, amounts] of ivaByRate) {
          comprasAlicuotas.push(
            formatAlicuota({
              tipoComprobante: cbteTipo,
              puntoVenta: ptoVta,
              numero: nroComprobante,
              importeNeto: amounts.neto,
              alicuotaIVA: IVA_RATE_MAP[rate] ?? 5,
              importeIVA: amounts.iva,
            })
          );
        }
      }
    }

    logger.info('Libro IVA Digital generado', {
      data: {
        companyId,
        period: `${month}/${year}`,
        ventasRegistros: salesInvoices.length,
        comprasRegistros: purchaseInvoices.length,
      },
    });

    return {
      ventas: {
        cabecera: ventasCabecera.join('\r\n'),
        alicuotas: ventasAlicuotas.join('\r\n'),
        registros: salesInvoices.length,
      },
      compras: {
        cabecera: comprasCabecera.join('\r\n'),
        alicuotas: comprasAlicuotas.join('\r\n'),
        registros: purchaseInvoices.length,
      },
    };
  } catch (error) {
    logger.error('Error al generar Libro IVA Digital', {
      data: { error, companyId, year, month },
    });
    throw error;
  }
}
