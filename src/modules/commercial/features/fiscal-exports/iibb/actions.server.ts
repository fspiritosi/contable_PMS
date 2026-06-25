'use server';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import moment from 'moment';
import { formatSIRCARRecord, type SIRCARRecord } from './formatters';

// Mapeo de jurisdicciones a códigos SIRCAR
const JURISDICTION_MAP: Record<string, string> = {
  'Buenos Aires': '902',
  CABA: '901',
  Catamarca: '903',
  Chaco: '904',
  Chubut: '905',
  Córdoba: '906',
  Corrientes: '907',
  'Entre Ríos': '908',
  Formosa: '909',
  Jujuy: '910',
  'La Pampa': '911',
  'La Rioja': '912',
  Mendoza: '913',
  Misiones: '914',
  Neuquén: '915',
  'Río Negro': '916',
  Salta: '917',
  'San Juan': '918',
  'San Luis': '919',
  'Santa Cruz': '920',
  'Santa Fe': '921',
  'Santiago del Estero': '922',
  'Tierra del Fuego': '923',
  Tucumán: '924',
};

// ============================================
// GENERADOR SIRCAR (IIBB PROVINCIALES)
// ============================================

export async function generateSIRCARFile(
  year: number,
  month: number,
  jurisdiction?: string
): Promise<{
  content: string;
  registros: number;
}> {
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const startDate = moment(`${year}-${month}-01`, 'YYYY-M-DD').startOf('month').toDate();
    const endDate = moment(startDate).endOf('month').toDate();

    const paymentOrders = await prisma.paymentOrder.findMany({
      where: {
        companyId,
        status: 'CONFIRMED',
        date: { gte: startDate, lte: endDate },
      },
      select: {
        fullNumber: true,
        date: true,
        supplier: {
          select: { taxId: true },
        },
        withholdings: {
          where: {
            taxType: 'IIBB',
          },
          select: {
            taxType: true,
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
        const jurisdCode = jurisdiction ? (JURISDICTION_MAP[jurisdiction] ?? '900') : '900';

        const record: SIRCARRecord = {
          jurisdiccion: jurisdCode,
          cuit: (po.supplier?.taxId ?? '0').replace(/-/g, ''),
          fechaRetencion: moment(po.date).format('DDMMYYYY'),
          numeroSucursal: '0001',
          numeroCertificado: wh.certificateNumber ?? '0',
          tipoComprobante: 'R',
          letraComprobante: ' ',
          numeroComprobanteOrigen: po.fullNumber,
          importeRetenido: Number(wh.amount),
        };

        records.push(formatSIRCARRecord(record));
      }
    }

    logger.info('Archivo SIRCAR generado', {
      data: { companyId, period: `${month}/${year}`, jurisdiction, registros: records.length },
    });

    return {
      content: records.join('\r\n'),
      registros: records.length,
    };
  } catch (error) {
    logger.error('Error al generar archivo SIRCAR', {
      data: { error, companyId, year, month },
    });
    throw error;
  }
}
