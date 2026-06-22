'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { getActiveCompanyId } from '@/shared/lib/company';
import {
  buildFiltersWhere,
  buildTextFiltersWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  partnerSchema,
  type PartnerFormData,
} from '../../shared/validators';
import { PARTNER_MOVEMENT_TYPE_SIGN } from '../../shared/types';
import type { Partner, PartnerWithBalance } from '../../shared/types';

/**
 * Calcula el balance (lo que la empresa le debe al socio) para un conjunto de socios.
 * balance = Σ(cuotas PENDING) + Σ(OWED) + Σ(ADJUSTMENT) − Σ(REPAYMENT)
 */
async function getBalancesByPartner(
  companyId: string,
  partnerIds: string[]
): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  if (partnerIds.length === 0) return balances;

  const [grouped, installmentsByPartner] = await Promise.all([
    prisma.partnerAccountMovement.groupBy({
      by: ['partnerId', 'type'],
      where: { companyId, partnerId: { in: partnerIds } },
      _sum: { amount: true },
    }),
    prisma.paymentOrderInstallment.groupBy({
      by: ['partnerId'],
      where: { companyId, partnerId: { in: partnerIds }, status: 'PENDING' },
      _sum: { amount: true },
    }),
  ]);

  for (const row of grouped) {
    const sign = PARTNER_MOVEMENT_TYPE_SIGN[row.type];
    const amount = row._sum.amount ? Number(row._sum.amount) : 0;
    const current = balances.get(row.partnerId) ?? 0;
    balances.set(row.partnerId, current + sign * amount);
  }

  for (const row of installmentsByPartner) {
    if (!row.partnerId) continue;
    const amount = row._sum.amount ? Number(row._sum.amount) : 0;
    const current = balances.get(row.partnerId) ?? 0;
    balances.set(row.partnerId, current + amount);
  }

  return balances;
}

/**
 * Obtiene el listado de socios de la empresa activa con paginación y su balance.
 */
export async function getPartners(searchParams: DataTableSearchParams = {}) {
  await checkPermission('commercial.treasury.partners', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    const filtersWhere = buildFiltersWhere(
      state.filters,
      { isActive: 'isActive' },
      { exclude: ['name', 'taxId'] }
    );

    // El filtro de isActive llega como string ('true'/'false') desde la URL
    if (typeof filtersWhere.isActive === 'string') {
      filtersWhere.isActive = filtersWhere.isActive === 'true';
    }

    const textFiltersWhere = buildTextFiltersWhere(state.filters, ['name', 'taxId']);

    const where = {
      companyId,
      ...filtersWhere,
      ...textFiltersWhere,
    };

    const [partners, total] = await Promise.all([
      prisma.partner.findMany({
        where,
        orderBy: orderBy || [{ isActive: 'desc' }, { name: 'asc' }],
        skip,
        take,
      }),
      prisma.partner.count({ where }),
    ]);

    const balances = await getBalancesByPartner(
      companyId,
      partners.map((p) => p.id)
    );

    const data: PartnerWithBalance[] = partners.map((partner) => ({
      ...partner,
      balance: balances.get(partner.id) ?? 0,
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
    logger.error('Error al obtener socios', { data: { error } });
    throw new Error('Error al obtener socios');
  }
}

/**
 * Obtiene los conteos de facetas para los filtros de socios.
 */
export async function getPartnerFacetCounts() {
  await checkPermission('commercial.treasury.partners', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const activeCounts = await prisma.partner.groupBy({
    by: ['isActive'],
    where: { companyId },
    _count: { isActive: true },
  });

  return {
    isActive: Object.fromEntries(
      activeCounts.map((c) => [String(c.isActive), c._count.isActive])
    ),
  };
}

/**
 * Obtiene un socio por ID.
 */
export async function getPartnerById(id: string): Promise<Partner | null> {
  await checkPermission('commercial.treasury.partners', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const partner = await prisma.partner.findFirst({
      where: { id, companyId },
    });

    return partner;
  } catch (error) {
    logger.error('Error al obtener socio', { data: { error, id } });
    throw new Error('Error al obtener socio');
  }
}

/**
 * Crea un nuevo socio.
 */
export async function createPartner(data: PartnerFormData): Promise<Partner> {
  await checkPermission('commercial.treasury.partners', 'create', { redirect: true });
  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const validatedData = partnerSchema.parse(data);

    const partner = await prisma.partner.create({
      data: {
        companyId,
        name: validatedData.name,
        taxId: validatedData.taxId || null,
        email: validatedData.email || null,
        phone: validatedData.phone || null,
        notes: validatedData.notes || null,
        isActive: validatedData.isActive,
        createdBy: userId,
      },
    });

    logger.info('Socio creado', { data: { partnerId: partner.id, companyId } });

    revalidatePath('/dashboard/commercial/treasury/partners');

    return partner;
  } catch (error) {
    logger.error('Error al crear socio', { data: { error, data } });
    if (error instanceof Error) throw error;
    throw new Error('Error al crear socio');
  }
}

/**
 * Actualiza un socio existente.
 */
export async function updatePartner(
  id: string,
  data: PartnerFormData
): Promise<Partner> {
  await checkPermission('commercial.treasury.partners', 'update', { redirect: true });
  try {
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const validatedData = partnerSchema.parse(data);

    const existing = await prisma.partner.findFirst({ where: { id, companyId } });
    if (!existing) throw new Error('Socio no encontrado');

    const partner = await prisma.partner.update({
      where: { id },
      data: {
        name: validatedData.name,
        taxId: validatedData.taxId || null,
        email: validatedData.email || null,
        phone: validatedData.phone || null,
        notes: validatedData.notes || null,
        isActive: validatedData.isActive,
      },
    });

    logger.info('Socio actualizado', { data: { partnerId: partner.id, companyId } });

    revalidatePath('/dashboard/commercial/treasury/partners');
    revalidatePath(`/dashboard/commercial/treasury/partners/${id}`);

    return partner;
  } catch (error) {
    logger.error('Error al actualizar socio', { data: { error, id, data } });
    if (error instanceof Error) throw error;
    throw new Error('Error al actualizar socio');
  }
}

/**
 * Elimina un socio (solo si no tiene movimientos ni tarjetas asociadas).
 */
export async function deletePartner(id: string): Promise<void> {
  await checkPermission('commercial.treasury.partners', 'delete', { redirect: true });
  try {
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const partner = await prisma.partner.findFirst({
      where: { id, companyId },
      include: {
        _count: { select: { movements: true, cards: true } },
      },
    });

    if (!partner) throw new Error('Socio no encontrado');

    if (partner._count.movements > 0 || partner._count.cards > 0) {
      throw new Error(
        'No se puede eliminar un socio con movimientos o tarjetas asociadas'
      );
    }

    await prisma.partner.delete({ where: { id } });

    logger.info('Socio eliminado', { data: { partnerId: id, companyId } });

    revalidatePath('/dashboard/commercial/treasury/partners');
  } catch (error) {
    logger.error('Error al eliminar socio', { data: { error, id } });
    if (error instanceof Error) throw error;
    throw new Error('Error al eliminar socio');
  }
}
