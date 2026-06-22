'use server';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { getActiveCompanyId } from '@/shared/lib/company';
import {
  buildFiltersWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';

/**
 * Obtiene el listado de cuotas de tarjeta de la empresa activa con paginación.
 * Cada cuota representa un egreso futuro: si la tarjeta es de la empresa se le
 * paga al banco; si es de un socio, se le devuelve al socio.
 */
export async function getCardInstallments(searchParams: DataTableSearchParams = {}) {
  await checkPermission('commercial.treasury.cards', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    const filtersWhere = buildFiltersWhere(state.filters, {
      status: 'status',
    });

    const where = {
      companyId,
      ...filtersWhere,
    };

    const [installments, total] = await Promise.all([
      prisma.paymentOrderInstallment.findMany({
        where,
        include: {
          card: {
            select: {
              name: true,
              ownerType: true,
              partner: { select: { name: true } },
            },
          },
          paymentOrder: { select: { fullNumber: true } },
        },
        orderBy: orderBy || [{ dueDate: 'asc' }],
        skip,
        take,
      }),
      prisma.paymentOrderInstallment.count({ where }),
    ]);

    const data = installments.map((installment) => ({
      id: installment.id,
      number: installment.number,
      dueDate: installment.dueDate,
      amount: Number(installment.amount),
      status: installment.status,
      cardName: installment.card?.name ?? '-',
      ownerLabel:
        installment.card?.ownerType === 'PARTNER'
          ? installment.card?.partner?.name ?? 'Socio'
          : 'Empresa',
      originFullNumber: installment.paymentOrder?.fullNumber ?? '-',
    }));

    return {
      data,
      pagination: {
        page: state.page + 1,
        pageSize: state.pageSize,
        total,
        totalPages: Math.ceil(total / state.pageSize),
      },
    };
  } catch (error) {
    logger.error('Error al obtener cuotas de tarjeta', { data: { error } });
    throw new Error('Error al obtener cuotas de tarjeta');
  }
}

/**
 * Obtiene el total pendiente de pago de cuotas de tarjeta (status PENDING).
 */
export async function getCardInstallmentsPendingTotal() {
  await checkPermission('commercial.treasury.cards', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const result = await prisma.paymentOrderInstallment.aggregate({
      where: { companyId, status: 'PENDING' },
      _sum: { amount: true },
    });

    return Number(result._sum.amount ?? 0);
  } catch (error) {
    logger.error('Error al obtener total pendiente de cuotas', { data: { error } });
    throw new Error('Error al obtener total pendiente de cuotas');
  }
}
