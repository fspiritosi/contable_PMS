'use server';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import moment from 'moment';
import { VOUCHER_TYPE_MAP, IVA_RATE_MAP, DOC_TIPO_MAP } from '@/modules/commercial/features/arca/services/utils';
import { formatVentasCabecera, formatComprasCabecera, formatAlicuota, formatComprasAlicuota } from './formatters';
import type { LibroIVACabecera, LibroIVAResult } from './types';

/** Comprobantes B y C: no discriminan IVA. */
const NO_VAT_DETAIL = /_[BC]$/;

/**
 * Código de operación del diseño de ARCA: sin alícuota gravada, la operación es exenta
 * ('E') o no gravada ('N'); con alícuotas, va en blanco.
 */
function operationCode(hasTaxedLines: boolean, netExempt: number): string {
  if (hasTaxedLines) return ' ';
  return netExempt > 0 ? 'E' : 'N';
}

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
        // Cobrada o pagada (total o parcial) sigue siendo un comprobante del mes:
        // solo quedan afuera el borrador y la anulada (TSK-796).
        status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
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
        internalTaxes: true,
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
      const percIIBB = inv.perceptions
        .filter((p) => p.type === 'IIBB')
        .reduce((s, p) => s + Number(p.amount), 0);
      const percMunicipal = inv.perceptions
        .filter((p) => p.type === 'MUNICIPAL')
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
        importePercepcionesIVA: percIva,
        importeImpuestosInternos: Number(inv.internalTaxes),
        moneda: 'PES',
        tipoCambio: 1,
        cantidadAlicuotas: ivaByRate.size || 1,
        codigoOperacion: operationCode(ivaByRate.size > 0, Number(inv.netExempt)),
        importePercepcionesIIBB: percIIBB,
        importePercepcionesMunicipales: percMunicipal,
        importeCredFiscal: 0,
        // Cada tributo ya viaja en su campo propio del diseño de registro
        // (percepciones de IVA, IIBB y municipales, impuestos internos), así
        // que este campo residual queda en cero: informar acá `otherTaxes`
        // —que es la suma de todos ellos (TSK-644)— los contaría dos veces.
        otrosTributos: 0,
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
        status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] }, // Ver ventas (TSK-796).
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
        internalTaxes: true,
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
      const percMunicipal = inv.perceptions
        .filter((p) => p.type === 'MUNICIPAL')
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

      const noVatDetail = NO_VAT_DETAIL.test(inv.voucherType);
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
        importePercepcionesIVA: percIva,
        importeImpuestosInternos: Number(inv.internalTaxes),
        moneda: 'PES',
        tipoCambio: 1,
        // Los comprobantes B y C no discriminan IVA: cero alícuotas y sin registros
        // en el archivo de alícuotas (diseño de ARCA, campo 19).
        cantidadAlicuotas: noVatDetail ? 0 : ivaByRate.size || 1,
        codigoOperacion: operationCode(ivaByRate.size > 0, Number(inv.netExempt)),
        importePercepcionesIIBB: percIIBB,
        importePercepcionesMunicipales: percMunicipal,
        // Sin prorrateo, el crédito fiscal computable es el IVA liquidado del comprobante.
        importeCredFiscal: noVatDetail ? 0 : Number(inv.vatAmount),
        // Ver la nota equivalente en la cabecera de ventas (TSK-644).
        otrosTributos: 0,
      };

      comprasCabecera.push(formatComprasCabecera(cabecera));
      if (noVatDetail) continue;

      const seller = { codigoDocumento: docTipo, numeroDocumento: cabecera.numeroDocumento };
      const alicuotas =
        ivaByRate.size === 0
          ? [{ alicuotaIVA: 3, importeNeto: Number(inv.netTaxed), importeIVA: 0 }]
          : [...ivaByRate].map(([rate, amounts]) => ({
              alicuotaIVA: IVA_RATE_MAP[rate] ?? 5,
              importeNeto: amounts.neto,
              importeIVA: amounts.iva,
            }));
      for (const alicuota of alicuotas) {
        comprasAlicuotas.push(
          formatComprasAlicuota({
            tipoComprobante: cbteTipo,
            puntoVenta: ptoVta,
            numero: nroComprobante,
            ...seller,
            ...alicuota,
          })
        );
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
