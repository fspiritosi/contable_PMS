'use server';

import type { AccountType, ConceptUsage } from '@/generated/prisma/enums';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  buildFiltersWhere,
  buildTextFiltersWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { getActiveCompanyId } from '@/shared/lib/company';
import { allowedAccountTypes } from '@/shared/lib/concepts/usages';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';
import { conceptSchema, type ConceptFormInput } from './shared/validators';

const CONCEPTS_PATH = '/dashboard/company/accounting/concepts';
const DUPLICATE_NAME_MESSAGE = 'Ya existe un concepto activo con ese nombre';

// Etiquetas de tipo de cuenta para el mensaje de error (mismas que usa el plan de cuentas).
const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: 'Activo',
  LIABILITY: 'Pasivo',
  EQUITY: 'Patrimonio Neto',
  REVENUE: 'Ingreso',
  EXPENSE: 'Egreso',
};

async function requireCompanyId(): Promise<string> {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new BusinessError('No hay empresa activa');
  return companyId;
}

/** Falla si ya hay otro concepto ACTIVO con el mismo nombre (trim, sin distinguir mayúsculas). */
async function assertUniqueActiveName(companyId: string, name: string, excludeId?: string) {
  const clash = await prisma.movementConcept.findFirst({
    where: {
      companyId,
      isActive: true,
      name: { equals: name.trim(), mode: 'insensitive' },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new BusinessError(DUPLICATE_NAME_MESSAGE);
}

/** Valida el formulario y devuelve los datos listos para guardar (cuenta según el modo). */
async function parseAndCheck(companyId: string, data: ConceptFormInput) {
  const parsed = conceptSchema.safeParse(data);
  if (!parsed.success) throw new BusinessError(parsed.error.issues[0].message);
  const { name, usages, accountMode } = parsed.data;

  // En modo socio no hay cuenta propia: se guarda null aunque el form la haya mandado.
  if (accountMode === 'PARTNER_ACCOUNT') {
    return { name, usages, accountMode, accountId: null };
  }

  const accountId = parsed.data.accountId || null;
  if (!accountId) throw new BusinessError('Elegí la cuenta contable del concepto.');
  const types = allowedAccountTypes(usages);
  const valid = await prisma.account.findFirst({
    where: { ...buildImputableAccountsWhere({ companyId, types }), id: accountId },
    select: { id: true },
  });
  if (!valid) {
    throw new BusinessError(
      `La cuenta elegida no sirve para todos los usos marcados: tiene que ser de tipo ${types
        .map((t) => ACCOUNT_TYPE_LABELS[t])
        .join(', ')} y ser imputable.`
    );
  }
  return { name, usages, accountMode, accountId };
}

/** Lista paginada de conceptos de la empresa, con la cuenta y cuántas veces se usó. */
export async function getConcepts(searchParams: DataTableSearchParams = {}) {
  await checkPermission('accounting.concepts', 'view', { redirect: true });
  const companyId = await requireCompanyId();

  const state = parseSearchParams(searchParams);
  const { skip, take, orderBy } = stateToPrismaParams(state);

  const filtersWhere = buildFiltersWhere(state.filters, { isActive: 'isActive' }, { exclude: ['name'] });
  // El filtro de isActive llega como string ('true'/'false') desde la URL
  if (typeof filtersWhere.isActive === 'string') {
    filtersWhere.isActive = filtersWhere.isActive === 'true';
  }
  const where = { companyId, ...filtersWhere, ...buildTextFiltersWhere(state.filters, ['name']) };

  const [rows, total] = await Promise.all([
    prisma.movementConcept.findMany({
      where,
      orderBy: orderBy || [{ isActive: 'desc' }, { name: 'asc' }],
      skip,
      take,
      select: {
        id: true,
        name: true,
        usages: true,
        accountMode: true,
        isActive: true,
        account: { select: { code: true, name: true } },
        _count: { select: { fundMovementLines: true, fundMovements: true, bankMovements: true } },
      },
    }),
    prisma.movementConcept.count({ where }),
  ]);

  const data = rows.map(({ _count, ...concept }) => ({
    ...concept,
    usageCount: _count.fundMovementLines + _count.fundMovements + _count.bankMovements,
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
}

export type ConceptRow = Awaited<ReturnType<typeof getConcepts>>['data'][number];

/** Un concepto de la empresa activa (para editarlo); `null` si no existe. */
export async function getConceptById(id: string) {
  await checkPermission('accounting.concepts', 'view', { redirect: true });
  const companyId = await requireCompanyId();
  return prisma.movementConcept.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      name: true,
      usages: true,
      accountMode: true,
      accountId: true,
      isActive: true,
      account: { select: { id: true, code: true, name: true } },
    },
  });
}

/**
 * Cuentas que puede tener un concepto con esos usos: imputables y de los tipos
 * que admiten todos los usos. `includeIds` preserva la cuenta ya guardada aunque
 * hoy no cumpla el filtro (mismo patrón que `getPartnerContributionAccounts`).
 */
export async function getConceptAccountOptions(usages: ConceptUsage[], includeIds?: string[]) {
  await checkPermission('accounting.concepts', 'view', { redirect: true });
  const companyId = await requireCompanyId();

  const types = allowedAccountTypes(usages);
  if (types.length === 0) return [];
  const imputableWhere = buildImputableAccountsWhere({ companyId, types });
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

export type ConceptAccountOption = Awaited<ReturnType<typeof getConceptAccountOptions>>[number];

export async function createConcept(data: ConceptFormInput): Promise<ActionResult<{ id: string }>> {
  await checkPermission('accounting.concepts', 'create', { redirect: true });
  try {
    const companyId = await requireCompanyId();
    const userId = await getCurrentUserId();
    if (!userId) throw new BusinessError('No autenticado');

    const checked = await parseAndCheck(companyId, data);
    await assertUniqueActiveName(companyId, checked.name);

    const created = await prisma.movementConcept.create({
      data: { companyId, createdBy: userId, ...checked },
      select: { id: true },
    });
    revalidatePath(CONCEPTS_PATH);
    return { success: true, id: created.id };
  } catch (error) {
    return toActionResult(error, 'Error al crear concepto');
  }
}

export async function updateConcept(
  id: string,
  data: ConceptFormInput
): Promise<ActionResult<{ id: string }>> {
  await checkPermission('accounting.concepts', 'update', { redirect: true });
  try {
    const companyId = await requireCompanyId();
    const existing = await prisma.movementConcept.findFirst({
      where: { id, companyId },
      select: { isActive: true },
    });
    if (!existing) throw new BusinessError('Concepto no encontrado');

    const checked = await parseAndCheck(companyId, data);
    // Solo choca si el concepto editado está activo: uno inactivo puede repetir nombre.
    if (existing.isActive) await assertUniqueActiveName(companyId, checked.name, id);

    await prisma.movementConcept.update({ where: { id }, data: checked });
    revalidatePath(CONCEPTS_PATH);
    return { success: true, id };
  } catch (error) {
    return toActionResult(error, 'Error al actualizar concepto');
  }
}

export async function setConceptActive(id: string, isActive: boolean): Promise<ActionResult> {
  await checkPermission('accounting.concepts', 'update', { redirect: true });
  try {
    const companyId = await requireCompanyId();
    const existing = await prisma.movementConcept.findFirst({
      where: { id, companyId },
      select: { name: true },
    });
    if (!existing) throw new BusinessError('Concepto no encontrado');

    if (isActive) await assertUniqueActiveName(companyId, existing.name, id);

    await prisma.movementConcept.update({ where: { id }, data: { isActive } });
    revalidatePath(CONCEPTS_PATH);
    return { success: true };
  } catch (error) {
    return toActionResult(error, 'Error al cambiar el estado del concepto');
  }
}

export async function deleteConcept(id: string): Promise<ActionResult> {
  await checkPermission('accounting.concepts', 'delete', { redirect: true });
  try {
    const companyId = await requireCompanyId();
    const concept = await prisma.movementConcept.findFirst({
      where: { id, companyId },
      select: {
        _count: { select: { fundMovementLines: true, fundMovements: true, bankMovements: true } },
      },
    });
    if (!concept) throw new BusinessError('Concepto no encontrado');

    const { fundMovementLines, fundMovements, bankMovements } = concept._count;
    if (fundMovementLines + fundMovements + bankMovements > 0) {
      throw new BusinessError(
        'Este concepto ya se usó en movimientos: desactivalo en lugar de borrarlo.'
      );
    }

    await prisma.movementConcept.delete({ where: { id } });
    revalidatePath(CONCEPTS_PATH);
    return { success: true };
  } catch (error) {
    return toActionResult(error, 'Error al eliminar concepto');
  }
}
