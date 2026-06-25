'use server';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import moment from 'moment';
import { formatSIRERecord, type SIRERecord } from './formatters';

// Mapeo de tipo de retención a código de impuesto AFIP
const TAX_CODE_MAP: Record<string, string> = {
  IVA: '767',
  GANANCIAS: '787',
  SUSS: '351',
};

// ============================================
// GENERADOR DE ARCHIVO SIRE
// ============================================

export async function generateSIREFile(year: number, month: number): Promise<{
  content: string;
  registros: number;
}> {
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const startDate = moment(`${year}-${month}-01`, 'YYYY-M-DD').startOf('month').toDate();
    const endDate = moment(startDate).endOf('month').toDate();

    // Obtener órdenes de pago con retenciones del período
    const paymentOrders = await prisma.paymentOrder.findMany({
      where: {
        companyId,
        status: 'CONFIRMED',
        date: { gte: startDate, lte: endDate },
      },
      select: {
        fullNumber: true,
        date: true,
        totalAmount: true,
        supplier: {
          select: { businessName: true, tradeName: true, taxId: true },
        },
        withholdings: {
          select: {
            taxType: true,
            rate: true,
            amount: true,
            certificateNumber: true,
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    const records: string[] = [];

    for (const po of paymentOrders) {
      for (const wh of po.withholdings) {
        const taxCode = TAX_CODE_MAP[wh.taxType] ?? '787';

        const record: SIRERecord = {
          codigoComprobante: '06',
          fechaEmision: moment(po.date).format('DDMMYYYY'),
          numeroComprobante: po.fullNumber,
          importeComprobante: Number(po.totalAmount),
          codigoImpuesto: taxCode,
          codigoRegimen: '0',
          codigoOperacion: '1',
          baseImponible: 0,
          fechaEmisionRetencion: moment(po.date).format('DDMMYYYY'),
          codigoCondicion: '01',
          retencionPracticada: 0,
          alicuota: Number(wh.rate),
          montoRetenido: Number(wh.amount),
          montoExcedente: 0,
          certificadoNumero: wh.certificateNumber ?? '',
          fechaRetencion: moment(po.date).format('DDMMYYYY'),
          tipoDocRetenido: '80',
          nroDocRetenido: (po.supplier?.taxId ?? '0').replace(/-/g, ''),
        };

        records.push(formatSIRERecord(record));
      }
    }

    logger.info('Archivo SIRE generado', {
      data: { companyId, period: `${month}/${year}`, registros: records.length },
    });

    return {
      content: records.join('\r\n'),
      registros: records.length,
    };
  } catch (error) {
    logger.error('Error al generar archivo SIRE', {
      data: { error, companyId, year, month },
    });
    throw error;
  }
}
