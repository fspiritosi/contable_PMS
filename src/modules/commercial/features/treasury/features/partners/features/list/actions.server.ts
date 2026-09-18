'use server';

import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  buildFiltersWhere,
  buildTextFiltersWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';
import type { Partner, PartnerWithAccount, PartnerWithBalance } from '../../shared/types';
import { PARTNER_CONTRIBUTION_ACCOUNT_TYPES, PARTNER_MOVEMENT_TYPE_SIGN } from '../../shared/types';
import { partnerSchema, type PartnerFormData } from '../../shared/validators';

/** Cuenta de aportes tal como viaja al listado, al detalle y al form (TSK-717). */
const contributionsAccountInclude = {
  contributionsAccount: { select: { id: true, code: true, name: true } },
} as const;

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
        include: contributionsAccountInclude,
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
    isActive: Object.fromEntries(activeCounts.map((c) => [String(c.isActive), c._count.isActive])),
  };
}

/**
 * Cuentas que un socio puede tener como cuenta de aportes: imputables (hoja,
 * activa, sin corte de ejercicio vigente) y de tipo Activo, Pasivo o Patrimonio
 * Neto (TSK-717). `includeIds` preserva la cuenta ya guardada aunque hoy no
 * cumpla el filtro (dada de baja, con hijas, cortada por ejercicio), para que al
 * editar el socio el combo la muestre seleccionada en vez de vacía; mismo patrón
 * que `getFundMovementLineAccounts` en `fund-movements`.
 *
 * El `where` imputable ya tiene su propio `OR` por `disabledFrom`, por eso se
 * envuelve en otro `OR` y no se mezcla. No se importa nada de `accounting`.
 */
export async function getPartnerContributionAccounts(includeIds?: string[]) {
  await checkPermission('commercial.treasury.partners', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const imputableWhere = buildImputableAccountsWhere({
    companyId,
    types: PARTNER_CONTRIBUTION_ACCOUNT_TYPES,
  });
  const where =
    includeIds && includeIds.length > 0
      ? { OR: [imputableWhere, { companyId, id: { in: includeIds } }] }
      : imputableWhere;

  return prisma.account.findMany({
    where,
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
}

export type PartnerContributionAccountOption = Awaited<
  ReturnType<typeof getPartnerContributionAccounts>
>[number];

/**
 * Obtiene un socio por ID.
 */
export async function getPartnerById(id: string): Promise<PartnerWithAccount | null> {
  await checkPermission('commercial.treasury.partners', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    return await prisma.partner.findFirst({
      where: { id, companyId },
      include: contributionsAccountInclude,
    });
  } catch (error) {
    logger.error('Error al obtener socio', { data: { error, id } });
    throw new Error('Error al obtener socio');
  }
}

/**
 * Verifica que la cuenta elegida sea de la empresa activa (TSK-717). No exige
 * que sea imputable: el combo ya filtra, y una cuenta que dejó de serlo se
 * conserva a propósito (`includeIds`); quien la rechaza es la confirmación del
 * asiento (`resolvePartnerCapitalAccount`). Acá los errores son excepciones:
 * los forms los muestran con `toast.error(error.message)`.
 */
async function assertAccountBelongsToCompany(
  accountId: string | null | undefined,
  companyId: string
): Promise<string | null> {
  if (!accountId) return null;
  const account = await prisma.account.findFirst({
    where: { id: accountId, companyId },
    select: { id: true },
  });
  if (!account) throw new Error('La cuenta contable seleccionada no pertenece a la empresa');
  return account.id;
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

    const contributionsAccountId = await assertAccountBelongsToCompany(
      validatedData.contributionsAccountId,
      companyId
    );

    const partner = await prisma.partner.create({
      data: {
        companyId,
        name: validatedData.name,
        taxId: validatedData.taxId || null,
        email: validatedData.email || null,
        phone: validatedData.phone || null,
        notes: validatedData.notes || null,
        isActive: validatedData.isActive,
        contributionsAccountId,
        createdBy: userId,
      },
    });

    logger.info('Socio creado', {
      data: { partnerId: partner.id, companyId, contributionsAccountId },
    });

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
export async function updatePartner(id: string, data: PartnerFormData): Promise<Partner> {
  await checkPermission('commercial.treasury.partners', 'update', { redirect: true });
  try {
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const validatedData = partnerSchema.parse(data);

    const existing = await prisma.partner.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new Error('Socio no encontrado');

    const contributionsAccountId = await assertAccountBelongsToCompany(
      validatedData.contributionsAccountId,
      companyId
    );

    const partner = await prisma.partner.update({
      where: { id },
      data: {
        name: validatedData.name,
        taxId: validatedData.taxId || null,
        email: validatedData.email || null,
        phone: validatedData.phone || null,
        notes: validatedData.notes || null,
        isActive: validatedData.isActive,
        // null = volver a la cuenta por defecto. No toca asientos ya generados.
        contributionsAccountId,
      },
    });

    logger.info('Socio actualizado', {
      data: { partnerId: partner.id, companyId, contributionsAccountId },
    });

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
 * Elimina un socio (solo si no tiene movimientos, tarjetas ni aportes/retiros asociados).
 */
export async function deletePartner(id: string): Promise<void> {
  await checkPermission('commercial.treasury.partners', 'delete', { redirect: true });
  try {
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const [partner, fundMovementsCount] = await Promise.all([
      prisma.partner.findFirst({
        where: { id, companyId },
        include: {
          _count: { select: { movements: true, cards: true } },
        },
      }),
      // TSK-717: sin FK ni relación Prisma entre FundMovement.partnerId y Partner,
      // así que no entra en el `_count`. Cuenta cualquier estado, también DRAFT.
      prisma.fundMovement.count({ where: { companyId, partnerId: id } }),
    ]);

    if (!partner) throw new Error('Socio no encontrado');

    if (partner._count.movements > 0 || partner._count.cards > 0) {
      throw new Error('No se puede eliminar un socio con movimientos o tarjetas asociadas');
    }

    if (fundMovementsCount > 0) {
      throw new Error(
        'No se puede eliminar un socio con aportes o retiros registrados. Desactivalo desde Editar si ya no opera.'
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
