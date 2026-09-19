'use server';

import type { Prisma } from '@/generated/prisma/client';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  buildSearchWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';

// ============================================
// TIPOS
// ============================================

/**
 * Cuentas contables de Bienes de Uso del tipo (TSK-724c). `null` = sin asignar
 * (se usa la por defecto de Contabilidad → Configuración); `undefined` = no se toca.
 */
interface VehicleTypeAccountsInput {
  fixedAssetAccountId?: string | null;
  accumulatedDepreciationAccountId?: string | null;
  depreciationExpenseAccountId?: string | null;
}

export interface CreateVehicleTypeInput extends VehicleTypeAccountsInput {
  name: string;
  hasHitch?: boolean;
  isTractorUnit?: boolean;
}

export interface UpdateVehicleTypeInput extends VehicleTypeAccountsInput {
  name?: string;
  hasHitch?: boolean;
  isTractorUnit?: boolean;
}

const VEHICLE_TYPE_ACCOUNT_SELECT = {
  fixedAssetAccountId: true,
  accumulatedDepreciationAccountId: true,
  depreciationExpenseAccountId: true,
} as const;

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene tipos de equipo con paginación server-side para DataTable
 */
export async function getVehicleTypesPaginated(searchParams: DataTableSearchParams) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.vehicle-types', 'view', { redirect: true });

  try {
    // Parsear parámetros de URL
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    // Construir cláusula de búsqueda
    const searchWhere = buildSearchWhere(state.search, ['name']);

    const where = {
      companyId,
      isActive: true,
      ...searchWhere,
    };

    // Ejecutar queries en paralelo
    const [data, total] = await Promise.all([
      prisma.vehicleType.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || { name: 'asc' },
        // `select` explícito: las tres cuentas viajan al cliente solo para la
        // columna "Cuentas contables" y para precargar el modal de edición.
        select: {
          id: true,
          name: true,
          hasHitch: true,
          isTractorUnit: true,
          isActive: true,
          ...VEHICLE_TYPE_ACCOUNT_SELECT,
          _count: { select: { vehicles: true } },
        },
      }),
      prisma.vehicleType.count({ where }),
    ]);

    return { data, total };
  } catch (error) {
    logger.error('Error al obtener tipos de equipo paginados', { data: { error, companyId } });
    throw new Error('Error al obtener tipos de equipo');
  }
}

/**
 * Obtiene todos los tipos de equipo de la empresa activa (sin paginación)
 * @deprecated Usar getVehicleTypesPaginated para listas con DataTable
 */
export async function getAllVehicleTypes() {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.vehicle-types', 'view', { redirect: true });

  try {
    return await prisma.vehicleType.findMany({
      where: { companyId, isActive: true },
      include: { _count: { select: { vehicles: true } } },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener tipos de equipo', { data: { error } });
    throw new Error('Error al obtener tipos de equipo');
  }
}

/**
 * Obtiene tipos de equipo para select (solo campos necesarios)
 */
export async function getVehicleTypesForSelect() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.vehicleType.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, hasHitch: true, isTractorUnit: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener tipos para select', { data: { error } });
    return [];
  }
}

/**
 * Obtiene un tipo de equipo por ID
 */
export async function getVehicleTypeById(id: string) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.vehicle-types', 'view', { redirect: true });

  try {
    const type = await prisma.vehicleType.findFirst({
      where: { id, companyId },
    });
    if (!type) throw new Error('Tipo de equipo no encontrado');
    return type;
  } catch (error) {
    logger.error('Error al obtener tipo de equipo', { data: { error, id } });
    throw error;
  }
}

/**
 * Cuentas que un tipo de equipo puede tener como cuentas de Bienes de Uso (TSK-724c):
 * imputables (hoja, activa, sin corte de ejercicio vigente). `asset` (tipo Activo)
 * sirve para Bienes de Uso y Amortización acumulada; `expense` (tipo Egreso) para
 * Gasto de amortización. No se exige `isFixedAsset`: el contador decide el rubro.
 *
 * `includeIds` preserva las cuentas ya guardadas aunque hoy no cumplan el filtro
 * (dadas de baja, con hijas, cortadas por ejercicio), para que al editar el tipo
 * el combo las muestre seleccionadas en vez de vacías; mismo patrón que
 * `getPartnerContributionAccounts` (TSK-717). El `where` imputable ya tiene su
 * propio `OR` por `disabledFrom`, por eso se envuelve en otro `OR` y no se mezcla.
 */
export async function getVehicleTypeAssetAccounts(includeIds?: string[]) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.vehicle-types', 'view', { redirect: true });

  const withSaved = (imputableWhere: Prisma.AccountWhereInput): Prisma.AccountWhereInput =>
    includeIds && includeIds.length > 0
      ? { OR: [imputableWhere, { companyId, id: { in: includeIds } }] }
      : imputableWhere;

  const select = { id: true, code: true, name: true } as const;
  const [asset, expense] = await Promise.all([
    prisma.account.findMany({
      where: withSaved(buildImputableAccountsWhere({ companyId, types: ['ASSET'] })),
      select,
      orderBy: { code: 'asc' },
    }),
    prisma.account.findMany({
      where: withSaved(buildImputableAccountsWhere({ companyId, types: ['EXPENSE'] })),
      select,
      orderBy: { code: 'asc' },
    }),
  ]);

  return { asset, expense };
}

/**
 * Cantidad de equipos del tipo con al menos un período de amortización ya
 * contabilizado (TSK-724c). El modal de edición lo usa para advertir que cambiar
 * las cuentas no toca esos asientos.
 */
export async function getVehicleTypePostedDepreciationCount(typeId: string): Promise<number> {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.vehicle-types', 'view', { redirect: true });

  return prisma.vehicle.count({
    where: {
      companyId,
      typeId,
      depreciation: { scheduleEntries: { some: { isPosted: true } } },
    },
  });
}

/**
 * Verifica que la cuenta elegida sea de la empresa activa (TSK-717/724c). No exige
 * que sea imputable: el combo ya filtra, y una cuenta que dejó de serlo se
 * conserva a propósito (`includeIds`); quien la rechaza es la contabilización
 * (`assertAssetAccountsForOperation`). Acá los errores son excepciones: el modal
 * los muestra con `toast.error(error.message)`.
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

/** Valida las tres cuentas del input contra la empresa; `undefined` se respeta (no se toca). */
async function resolveAccountsInput(input: VehicleTypeAccountsInput, companyId: string) {
  const [fixedAssetAccountId, accumulatedDepreciationAccountId, depreciationExpenseAccountId] =
    await Promise.all([
      input.fixedAssetAccountId === undefined
        ? undefined
        : assertAccountBelongsToCompany(input.fixedAssetAccountId, companyId),
      input.accumulatedDepreciationAccountId === undefined
        ? undefined
        : assertAccountBelongsToCompany(input.accumulatedDepreciationAccountId, companyId),
      input.depreciationExpenseAccountId === undefined
        ? undefined
        : assertAccountBelongsToCompany(input.depreciationExpenseAccountId, companyId),
    ]);
  return { fixedAssetAccountId, accumulatedDepreciationAccountId, depreciationExpenseAccountId };
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Crea un nuevo tipo de equipo
 */
export async function createVehicleType(input: CreateVehicleTypeInput) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.vehicle-types', 'create', { redirect: true });

  // Fuera del try: su mensaje es de negocio y debe llegar tal cual al toast.
  const accounts = await resolveAccountsInput(input, companyId);

  try {
    const type = await prisma.vehicleType.create({
      data: {
        name: input.name,
        hasHitch: input.hasHitch || false,
        isTractorUnit: input.isTractorUnit || false,
        companyId,
        fixedAssetAccountId: accounts.fixedAssetAccountId ?? null,
        accumulatedDepreciationAccountId: accounts.accumulatedDepreciationAccountId ?? null,
        depreciationExpenseAccountId: accounts.depreciationExpenseAccountId ?? null,
      },
      select: { id: true },
    });

    logger.info('Tipo de equipo creado', { data: { id: type.id, companyId, accounts } });
    revalidatePath('/dashboard/company/vehicle-types');
    return type;
  } catch (error) {
    logger.error('Error al crear tipo de equipo', { data: { error, companyId } });
    throw new Error('Error al crear tipo de equipo');
  }
}

/**
 * Actualiza un tipo de equipo
 */
export async function updateVehicleType(id: string, input: UpdateVehicleTypeInput) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.vehicle-types', 'update', { redirect: true });

  try {
    const existing = await prisma.vehicleType.findFirst({
      where: { id, companyId },
      select: { id: true, ...VEHICLE_TYPE_ACCOUNT_SELECT },
    });

    if (!existing) {
      throw new Error('Tipo de equipo no encontrado');
    }

    const accounts = await resolveAccountsInput(input, companyId);

    const type = await prisma.vehicleType.update({
      where: { id },
      data: {
        name: input.name,
        hasHitch: input.hasHitch,
        isTractorUnit: input.isTractorUnit,
        ...accounts,
      },
      select: { id: true },
    });

    // Rastro para el contador: qué cuentas tenía el tipo y cuáles quedaron.
    const accountsChanged = (
      Object.keys(VEHICLE_TYPE_ACCOUNT_SELECT) as Array<keyof typeof VEHICLE_TYPE_ACCOUNT_SELECT>
    ).some((key) => accounts[key] !== undefined && accounts[key] !== existing[key]);
    if (accountsChanged) {
      logger.info('Cuentas de Bienes de Uso del tipo de equipo modificadas', {
        data: {
          id,
          companyId,
          previous: {
            fixedAssetAccountId: existing.fixedAssetAccountId,
            accumulatedDepreciationAccountId: existing.accumulatedDepreciationAccountId,
            depreciationExpenseAccountId: existing.depreciationExpenseAccountId,
          },
          next: accounts,
        },
      });
    }

    logger.info('Tipo de equipo actualizado', { data: { id, companyId } });
    revalidatePath('/dashboard/company/vehicle-types');
    return type;
  } catch (error) {
    logger.error('Error al actualizar tipo de equipo', { data: { error, id } });
    throw error;
  }
}

/**
 * Elimina un tipo de equipo (soft delete)
 */
export async function deleteVehicleType(id: string) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.vehicle-types', 'delete', { redirect: true });

  try {
    const existing = await prisma.vehicleType.findFirst({
      where: { id, companyId },
      select: { id: true },
    });

    if (!existing) {
      throw new Error('Tipo de equipo no encontrado');
    }

    await prisma.vehicleType.update({
      where: { id },
      data: { isActive: false },
    });

    logger.info('Tipo de equipo eliminado', { data: { id, companyId } });
    revalidatePath('/dashboard/company/vehicle-types');
    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar tipo de equipo', { data: { error, id } });
    throw error;
  }
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type VehicleTypeListItem = Awaited<
  ReturnType<typeof getVehicleTypesPaginated>
>['data'][number];
export type VehicleTypeSelectItem = Awaited<ReturnType<typeof getVehicleTypesForSelect>>[number];
export type VehicleType = Awaited<ReturnType<typeof getVehicleTypeById>>;
export type VehicleTypeAssetAccounts = Awaited<ReturnType<typeof getVehicleTypeAssetAccounts>>;
export type VehicleTypeAccountOption = VehicleTypeAssetAccounts['asset'][number];
