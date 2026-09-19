'use server';

import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  buildFiltersWhere,
  buildSearchWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import type { VehicleTerminationReason } from '@/generated/prisma/enums';
import {
  createJournalEntryForAssetDisposal,
  createJournalEntryForAssetSale,
  type AssetDisposalAccounts,
} from '@/modules/accounting/features/integrations/equipment';
import {
  assertAssetAccountsForOperation,
  loadVehicleAssetAccounts,
} from '@/modules/equipment/shared/asset-accounts-loader';
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';

// ============================================
// CONSTANTES
// ============================================

// Select optimizado para relaciones - solo id y name
const relationSelect = { select: { id: true, name: true } } as const;

// ============================================
// TIPOS
// ============================================

export type EquipmentTab = 'all' | 'vehicles' | 'others';

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene equipos con paginación server-side para DataTable
 * Soporta filtrado por tab (Todos, Vehículos, Otros)
 */
export async function getEquipmentPaginated(
  searchParams: DataTableSearchParams,
  tab: EquipmentTab = 'all'
) {
  await checkPermission('equipment', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Parsear parámetros de URL
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    // Construir cláusula de búsqueda
    const searchWhere = buildSearchWhere(state.search, [
      'internNumber',
      'domain',
      'chassis',
      'engine',
    ]);

    // Excluir 'tab' de los filtros (se maneja aparte)
    const { tab: _tab, ...cleanFilters } = state.filters;

    // Construir cláusula de filtros
    const filtersWhere = buildFiltersWhere(cleanFilters, {
      status: 'status',
      condition: 'condition',
      type: 'typeId',
      brand: 'brandId',
      isActive: 'isActive',
    });

    // Transformar isActive de string a boolean si existe
    if (filtersWhere.isActive) {
      filtersWhere.isActive = filtersWhere.isActive === 'true';
    }

    // Filtrado por tab usando TypeOfVehicle
    let tabWhere = {};
    if (tab === 'vehicles') {
      // Buscar el TypeOfVehicle que representa "Vehículos"
      const vehicleType = await prisma.typeOfVehicle.findFirst({
        where: {
          companyId,
          name: { equals: 'Vehículos', mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (vehicleType) {
        tabWhere = { typeOfVehicleId: vehicleType.id };
      }
    } else if (tab === 'others') {
      // Buscar el TypeOfVehicle que representa "Vehículos" para excluirlo
      const vehicleType = await prisma.typeOfVehicle.findFirst({
        where: {
          companyId,
          name: { equals: 'Vehículos', mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (vehicleType) {
        tabWhere = { NOT: { typeOfVehicleId: vehicleType.id } };
      }
    }

    const where = {
      companyId,
      ...tabWhere,
      ...searchWhere,
      ...filtersWhere,
    };

    // Ejecutar queries en paralelo
    const [data, total] = await Promise.all([
      prisma.vehicle.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || { createdAt: 'desc' },
        include: {
          brand: relationSelect,
          model: relationSelect,
          type: relationSelect,
          typeOfVehicle: relationSelect,
          costCenter: relationSelect,
          sector: relationSelect,
          typeOperative: relationSelect,
        },
      }),
      prisma.vehicle.count({ where }),
    ]);

    return { data, total };
  } catch (error) {
    logger.error('Error al obtener equipos paginados', { data: { error, companyId } });
    throw new Error('Error al obtener equipos');
  }
}

/**
 * Obtiene conteos globales para filtros facetados (server-side)
 */
export async function getEquipmentFacetCounts() {
  await checkPermission('equipment', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [statusCounts, conditionCounts, typeCounts, brandCounts, isActiveCounts] = await Promise.all([
    prisma.vehicle.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { status: true },
    }),
    prisma.vehicle.groupBy({
      by: ['condition'],
      where: { companyId },
      _count: { condition: true },
    }),
    prisma.vehicle.groupBy({
      by: ['typeId'],
      where: { companyId },
      _count: { typeId: true },
    }),
    prisma.vehicle.groupBy({
      by: ['brandId'],
      where: { companyId },
      _count: { brandId: true },
    }),
    prisma.vehicle.groupBy({
      by: ['isActive'],
      where: { companyId },
      _count: { isActive: true },
    }),
  ]);

  return {
    status: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.status])),
    condition: Object.fromEntries(conditionCounts.map((c) => [c.condition, c._count.condition])),
    type: Object.fromEntries(typeCounts.map((t) => [t.typeId, t._count.typeId])),
    brand: Object.fromEntries(brandCounts.map((b) => [b.brandId, b._count.brandId])),
    isActive: Object.fromEntries(isActiveCounts.map((a) => [String(a.isActive), a._count.isActive])),
  };
}

/**
 * Obtiene contadores para cada tab
 */
export async function getEquipmentTabCounts() {
  await checkPermission('equipment', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return { all: 0, vehicles: 0, others: 0 };

  try {
    // Buscar el TypeOfVehicle que representa "Vehículos"
    const vehicleType = await prisma.typeOfVehicle.findFirst({
      where: {
        companyId,
        name: { equals: 'Vehículos', mode: 'insensitive' },
      },
      select: { id: true },
    });

    const [all, vehicles, others] = await Promise.all([
      prisma.vehicle.count({ where: { companyId } }),
      vehicleType
        ? prisma.vehicle.count({ where: { companyId, typeOfVehicleId: vehicleType.id } })
        : Promise.resolve(0),
      vehicleType
        ? prisma.vehicle.count({ where: { companyId, NOT: { typeOfVehicleId: vehicleType.id } } })
        : prisma.vehicle.count({ where: { companyId } }),
    ]);

    return { all, vehicles, others };
  } catch (error) {
    logger.error('Error al obtener contadores de tabs', { data: { error } });
    return { all: 0, vehicles: 0, others: 0 };
  }
}

/**
 * Obtiene tipos de vehículo para filtros
 */
export async function getVehicleTypesForFilter() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.vehicleType.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener tipos de vehículo para filtro', { data: { error } });
    return [];
  }
}

/**
 * Obtiene marcas de vehículo para filtros
 */
export async function getVehicleBrandsForFilter() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.vehicleBrand.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener marcas para filtro', { data: { error } });
    return [];
  }
}

/**
 * Obtiene todos los vehículos/equipos de la empresa activa (sin paginación)
 * @deprecated Usar getEquipmentPaginated para listas grandes
 */
export async function getAllVehicles() {
  await checkPermission('equipment', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    return await prisma.vehicle.findMany({
      where: { companyId },
      include: {
        brand: relationSelect,
        model: relationSelect,
        type: relationSelect,
        typeOfVehicle: relationSelect,
        costCenter: relationSelect,
        sector: relationSelect,
        typeOperative: relationSelect,
        contractorAllocations: {
          select: {
            contractor: relationSelect,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch (error) {
    logger.error('Error getting vehicles', { data: { error } });
    throw new Error('Error al obtener vehículos');
  }
}

/**
 * Obtiene solo los vehículos activos
 */
export async function getActiveVehicles() {
  await checkPermission('equipment', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    return await prisma.vehicle.findMany({
      where: {
        companyId,
        isActive: true,
      },
      include: {
        brand: relationSelect,
        model: relationSelect,
        type: relationSelect,
        typeOfVehicle: relationSelect,
        costCenter: relationSelect,
        sector: relationSelect,
        typeOperative: relationSelect,
        contractorAllocations: {
          select: {
            contractor: relationSelect,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch (error) {
    logger.error('Error getting active vehicles', { data: { error } });
    throw new Error('Error al obtener vehículos activos');
  }
}

/**
 * Da de baja (soft delete) un equipo (TSK-724c).
 *
 * Si el equipo tiene depreciación y el motivo no es "Otro", genera el asiento
 * de baja con las cuentas resueltas (depreciación → tipo de equipo → por
 * defecto) y marca la depreciación como completada. Las cuentas se validan
 * ANTES de abrir la transacción: si falta alguna, el equipo no se toca y el
 * motivo vuelve como `{ success: false, error }`. Sin depreciación o con
 * motivo "Otro" la baja se hace sin asiento (`journalEntryId: null`); el
 * diálogo lo avisa de antemano.
 */
export async function softDeleteVehicle(
  id: string,
  terminationReason: VehicleTerminationReason
): Promise<ActionResult<{ journalEntryId: string | null }>> {
  await checkPermission('equipment', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Pre-validación fuera de la transacción (patrón TSK-721)
    const loaded = await loadVehicleAssetAccounts(companyId, id);
    if (!loaded) throw new BusinessError('Equipo no encontrado');
    if (!loaded.isActive) throw new BusinessError('El equipo ya está dado de baja');

    const generatesEntry = loaded.hasDepreciation && terminationReason !== 'OTHER';
    const accounts = generatesEntry ? toDisposalAccounts(loaded) : null;

    const journalEntryId = await prisma.$transaction(async (tx) => {
      await tx.vehicle.update({
        where: { id, companyId },
        data: {
          isActive: false,
          terminationDate: new Date(),
          terminationReason,
        },
        select: { id: true },
      });

      if (!accounts) return null;

      const entryId =
        terminationReason === 'SALE'
          ? await createJournalEntryForAssetSale(id, companyId, accounts, tx)
          : await createJournalEntryForAssetDisposal(id, companyId, accounts, tx);

      if (loaded.depreciationId) {
        await tx.vehicleDepreciation.update({
          where: { id: loaded.depreciationId },
          data: { status: 'COMPLETED' },
          select: { id: true },
        });
      }

      return entryId;
    });

    logger.info('Equipo dado de baja', {
      data: { vehicleId: id, terminationReason, journalEntryId },
    });
    revalidatePath('/dashboard/equipment');
    revalidatePath(`/dashboard/equipment/${id}`);

    return { success: true, journalEntryId };
  } catch (error) {
    // TSK-724c: antes cualquier fallo (incluido "período cerrado") se convertía en un
    // genérico y las cuentas faltantes dejaban el equipo dado de baja sin asiento y sin aviso.
    return toActionResult(error, 'Error al dar de baja el equipo');
  }
}

/**
 * Cuentas del asiento de baja. `assertAssetAccountsForOperation` ya lanzó
 * `BusinessError` si falta alguna, así que las tres vienen garantizadas.
 */
function toDisposalAccounts(
  loaded: NonNullable<Awaited<ReturnType<typeof loadVehicleAssetAccounts>>>
): AssetDisposalAccounts {
  const asserted = assertAssetAccountsForOperation(loaded, 'disposal');
  return {
    fixedAssetAccountId: asserted.fixedAssetAccountId!,
    accumulatedDepreciationAccountId: asserted.accumulatedDepreciationAccountId!,
    assetDisposalGainLossAccountId: asserted.assetDisposalGainLossAccountId!,
  };
}

/**
 * Reactiva un vehículo dado de baja
 */
export async function reactivateVehicle(id: string) {
  await checkPermission('equipment', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    return await prisma.vehicle.update({
      where: { id, companyId },
      data: {
        isActive: true,
        terminationDate: null,
        terminationReason: null,
      },
    });
  } catch (error) {
    logger.error('Error reactivating vehicle', { data: { error, id } });
    throw new Error('Error al reactivar el vehículo');
  }
}

// ============================================
// EXPORT
// ============================================

/**
 * Obtiene TODOS los equipos con los filtros actuales (para exportar a Excel)
 * Usa los mismos filtros que getEquipmentPaginated pero sin paginación
 */
export async function getAllEquipmentForExport(
  searchParams: DataTableSearchParams,
  tab: EquipmentTab = 'all'
) {
  await checkPermission('equipment', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);

    const searchWhere = buildSearchWhere(state.search, [
      'internNumber',
      'domain',
      'chassis',
      'engine',
    ]);

    const { tab: _tab, ...cleanFilters } = state.filters;

    const filtersWhere = buildFiltersWhere(cleanFilters, {
      status: 'status',
      condition: 'condition',
      type: 'typeId',
      brand: 'brandId',
      isActive: 'isActive',
    });

    if (filtersWhere.isActive) {
      filtersWhere.isActive = filtersWhere.isActive === 'true';
    }

    let tabWhere = {};
    if (tab === 'vehicles') {
      const vehicleType = await prisma.typeOfVehicle.findFirst({
        where: { companyId, name: { equals: 'Vehículos', mode: 'insensitive' } },
        select: { id: true },
      });
      if (vehicleType) {
        tabWhere = { typeOfVehicleId: vehicleType.id };
      }
    } else if (tab === 'others') {
      const vehicleType = await prisma.typeOfVehicle.findFirst({
        where: { companyId, name: { equals: 'Vehículos', mode: 'insensitive' } },
        select: { id: true },
      });
      if (vehicleType) {
        tabWhere = { NOT: { typeOfVehicleId: vehicleType.id } };
      }
    }

    const where = {
      companyId,
      ...tabWhere,
      ...searchWhere,
      ...filtersWhere,
    };

    // SIN skip/take para obtener todos
    return await prisma.vehicle.findMany({
      where,
      orderBy: state.sortBy ? { [state.sortBy]: state.sortOrder } : { createdAt: 'desc' },
      include: {
        brand: relationSelect,
        model: relationSelect,
        type: relationSelect,
        typeOfVehicle: relationSelect,
        costCenter: relationSelect,
        sector: relationSelect,
        typeOperative: relationSelect,
      },
    });
  } catch (error) {
    logger.error('Error al obtener equipos para exportar', { data: { error } });
    throw new Error('Error al obtener equipos para exportar');
  }
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type EquipmentListItem = Awaited<ReturnType<typeof getEquipmentPaginated>>['data'][number];
export type VehicleListItem = Awaited<ReturnType<typeof getAllVehicles>>[number];
export type VehicleTypeOption = Awaited<ReturnType<typeof getVehicleTypesForFilter>>[number];
export type VehicleBrandOption = Awaited<ReturnType<typeof getVehicleBrandsForFilter>>[number];
export type TabCounts = Awaited<ReturnType<typeof getEquipmentTabCounts>>;
