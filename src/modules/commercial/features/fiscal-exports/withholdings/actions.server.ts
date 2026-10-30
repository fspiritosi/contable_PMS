'use server';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';

import { buildWithholdingFiles, type WithholdingFiles } from './build-files';

// ============================================
// ARCHIVOS DE RETENCIONES PRACTICADAS (TSK-813)
// ============================================

/**
 * SIRE (IVA y Seguridad Social), SICORE (Ganancias) y SIRCAR (IIBB, uno por jurisdicción) con las
 * retenciones de las órdenes de pago confirmadas del mes.
 */
export async function generateWithholdingFiles(year: number, month: number): Promise<WithholdingFiles> {
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // El mes de Argentina (UTC-3, sin horario de verano): de las 00:00 del día 1 a las del mes siguiente.
    const startDate = new Date(Date.UTC(year, month - 1, 1, 3));
    const endDate = new Date(Date.UTC(year, month, 1, 3));

    const [company, paymentOrders] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { taxId: true } }),
      prisma.paymentOrder.findMany({
        where: {
          companyId,
          status: 'CONFIRMED',
          date: { gte: startDate, lt: endDate },
          withholdings: { some: {} },
        },
        select: {
          fullNumber: true,
          date: true,
          totalAmount: true,
          supplier: { select: { taxId: true, taxCondition: true } },
          withholdings: {
            select: {
              taxType: true,
              rate: true,
              amount: true,
              certificateNumber: true,
              regimeCode: true,
              taxableBase: true,
              jurisdiction: true,
            },
          },
        },
        orderBy: [{ date: 'asc' }, { number: 'asc' }],
      }),
    ]);

    const files = buildWithholdingFiles(
      paymentOrders.map((po) => ({
        ...po,
        totalAmount: Number(po.totalAmount),
        withholdings: po.withholdings.map((wh) => ({
          ...wh,
          rate: Number(wh.rate),
          amount: Number(wh.amount),
          taxableBase: wh.taxableBase === null ? null : Number(wh.taxableBase),
        })),
      })),
      company.taxId
    );

    logger.info('Archivos de retenciones generados', {
      data: {
        companyId,
        period: `${month}/${year}`,
        sireIva: files.sireIva.registros,
        sireSuss: files.sireSuss.registros,
        sicore: files.sicore.registros,
        sircar: files.sircar.length,
        incompletas: files.incomplete.length,
      },
    });

    return files;
  } catch (error) {
    logger.error('Error al generar los archivos de retenciones', {
      data: { error, companyId, year, month },
    });
    throw error;
  }
}
