'use server';

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  parseSearchParams,
  stateToPrismaParams,
  buildFiltersWhere,
  buildDateRangeFiltersWhere,
} from '@/shared/components/common/DataTable/helpers';

export async function getWithholdingsReceivedPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.treasury.receipts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { skip, take } = stateToPrismaParams(parsed);

    // Filtros facetados (taxType)
    const facetedWhere = buildFiltersWhere(parsed.filters, { taxType: 'taxType' }, { exclude: ['receiptDate'] });

    // Filtro de fecha (receiptDate -> receipt.date)
    const dateFilters = buildDateRangeFiltersWhere(parsed.filters, ['receiptDate']);
    const receiptDateWhere = dateFilters.receiptDate
      ? { date: dateFilters.receiptDate }
      : {};

    // Búsqueda por texto
    const searchWhere = parsed.search
      ? {
          OR: [
            { receipt: { fullNumber: { contains: parsed.search, mode: 'insensitive' as const } } },
            { receipt: { customer: { name: { contains: parsed.search, mode: 'insensitive' as const } } } },
            { certificateNumber: { contains: parsed.search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const where: Prisma.ReceiptWithholdingWhereInput = {
      receipt: {
        companyId,
        status: 'CONFIRMED',
        ...receiptDateWhere,
      },
      ...facetedWhere,
      ...searchWhere,
    };

    const [data, total] = await Promise.all([
      prisma.receiptWithholding.findMany({
        where,
        select: {
          id: true,
          taxType: true,
          rate: true,
          amount: true,
          certificateNumber: true,
          receipt: {
            select: {
              id: true,
              fullNumber: true,
              date: true,
              customer: { select: { name: true, taxId: true } },
            },
          },
        },
        orderBy: { receipt: { date: 'desc' } },
        skip,
        take,
      }),
      prisma.receiptWithholding.count({ where }),
    ]);

    return {
      data: data.map((w) => ({
        id: w.id,
        taxType: w.taxType,
        rate: Number(w.rate),
        amount: Number(w.amount),
        certificateNumber: w.certificateNumber,
        receiptId: w.receipt.id,
        receiptFullNumber: w.receipt.fullNumber,
        receiptDate: w.receipt.date,
        customerName: w.receipt.customer.name,
        customerTaxId: w.receipt.customer.taxId,
      })),
      total,
    };
  } catch (error) {
    logger.error('Error al obtener retenciones recibidas', { data: { error } });
    throw new Error('Error al obtener retenciones recibidas');
  }
}

// Para exportar todos los datos (sin paginación)
export async function getAllWithholdingsReceived() {
  await checkPermission('commercial.treasury.receipts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const data = await prisma.receiptWithholding.findMany({
    where: { receipt: { companyId, status: 'CONFIRMED' } },
    select: {
      id: true,
      taxType: true,
      rate: true,
      amount: true,
      certificateNumber: true,
      receipt: {
        select: {
          id: true,
          fullNumber: true,
          date: true,
          customer: { select: { name: true, taxId: true } },
        },
      },
    },
    orderBy: { receipt: { date: 'desc' } },
  });

  return data.map((w) => ({
    id: w.id,
    taxType: w.taxType,
    rate: Number(w.rate),
    amount: Number(w.amount),
    certificateNumber: w.certificateNumber,
    receiptId: w.receipt.id,
    receiptFullNumber: w.receipt.fullNumber,
    receiptDate: w.receipt.date,
    customerName: w.receipt.customer.name,
    customerTaxId: w.receipt.customer.taxId,
  }));
}
