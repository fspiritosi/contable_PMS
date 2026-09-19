'use server';

import moment from 'moment';
import { Prisma } from '@/generated/prisma/client';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';

import {
  ASSET_ACCOUNT_KEYS,
  resolveAssetAccounts,
  type AssetAccountKey,
  type AssetAccountSource,
} from '@/modules/equipment/shared/asset-accounts';
import {
  assertAssetAccountsForOperation,
  loadVehicleAssetAccounts,
  loadVehiclesAssetAccounts,
  type LoadedVehicleAssetAccounts,
} from '@/modules/equipment/shared/asset-accounts-loader';
import {
  generateDepreciationSchedule,
  calculateEndDate,
  recalculateScheduleFromPeriod,
} from './lib/calculations';
import {
  depreciationAccountsSchema,
  depreciationConfigSchema,
  valueAdjustmentSchema,
  type DepreciationAccountsInput,
  type DepreciationConfigInput,
  type ValueAdjustmentInput,
} from './validators';

type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

async function resolveFiscalPeriodTx(companyId: string, date: Date, tx: PrismaTransactionClient) {
  const fiscalYear = await tx.fiscalYear.findFirst({
    where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true },
  });
  if (!fiscalYear) return { fiscalYearId: undefined, periodId: undefined };
  const entryMoment = moment(date);
  const period = await tx.accountingPeriod.findFirst({
    where: {
      fiscalYearId: fiscalYear.id,
      year: entryMoment.year(),
      month: entryMoment.month() + 1,
      type: 'MONTHLY',
    },
    select: { id: true },
  });
  return { fiscalYearId: fiscalYear.id, periodId: period?.id };
}

// ============================================
// CONSULTAS
// ============================================

/**
 * Obtiene la configuración de depreciación de un equipo con su schedule
 */
export async function getVehicleDepreciation(vehicleId: string) {
  await checkPermission('equipment', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const depreciation = await prisma.vehicleDepreciation.findUnique({
      where: { vehicleId },
      include: {
        scheduleEntries: {
          orderBy: { periodNumber: 'asc' },
          include: {
            journalEntry: {
              select: { id: true, number: true, status: true },
            },
          },
        },
        vehicle: {
          select: { id: true, internNumber: true, domain: true },
        },
      },
    });

    if (!depreciation) return null;

    if (depreciation.companyId !== companyId) {
      throw new Error('No tienes permiso para ver esta depreciación');
    }

    // Convertir Decimals a Number para Client Components
    return {
      ...depreciation,
      grossValue: Number(depreciation.grossValue),
      salvageValue: Number(depreciation.salvageValue),
      currentBookValue: Number(depreciation.currentBookValue),
      totalDepreciated: Number(depreciation.totalDepreciated),
      depreciationRate: depreciation.depreciationRate
        ? Number(depreciation.depreciationRate)
        : null,
      scheduleEntries: depreciation.scheduleEntries.map((entry) => ({
        ...entry,
        amount: Number(entry.amount),
        accumulatedAmount: Number(entry.accumulatedAmount),
        bookValueAfter: Number(entry.bookValueAfter),
      })),
    };
  } catch (error) {
    logger.error('Error getting vehicle depreciation', { data: { error, vehicleId } });
    throw error instanceof Error ? error : new Error('Error al obtener la depreciación');
  }
}

/**
 * Obtiene los ajustes de valor de un equipo
 */
export async function getVehicleValueAdjustments(vehicleId: string) {
  await checkPermission('equipment', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const adjustments = await prisma.assetValueAdjustment.findMany({
      where: { vehicleId, companyId },
      orderBy: { date: 'desc' },
      include: {
        journalEntry: {
          select: { id: true, number: true, status: true },
        },
      },
    });

    return adjustments.map((adj) => ({
      ...adj,
      previousValue: Number(adj.previousValue),
      newValue: Number(adj.newValue),
      differenceAmount: Number(adj.differenceAmount),
    }));
  } catch (error) {
    logger.error('Error getting value adjustments', { data: { error, vehicleId } });
    throw error instanceof Error ? error : new Error('Error al obtener los ajustes de valor');
  }
}

// ============================================
// CUENTAS DE BIENES DE USO (TSK-724c)
// ============================================

/** Cuenta efectiva de una clave, plana para Client Components. */
export interface VehicleAssetAccountView {
  accountId: string;
  code: string;
  name: string;
  source: AssetAccountSource;
  imputable: boolean;
}

/** Lo que muestra la card "Cuentas contables" y precarga el diálogo de override. */
export interface VehicleAssetAccounts {
  vehicleLabel: string;
  typeId: string;
  typeName: string;
  isActive: boolean;
  hasDepreciation: boolean;
  depreciationId: string | null;
  postedCount: number;
  /** Lo guardado en la depreciación del equipo (override). */
  overrides: Record<`${AssetAccountKey}AccountId`, string | null>;
  /** Resolución efectiva: depreciación → tipo → por defecto. */
  accounts: Record<AssetAccountKey, VehicleAssetAccountView | null>;
  /** Qué se usaría si el override quedara vacío (tipo → por defecto). */
  fallbacks: Record<AssetAccountKey, VehicleAssetAccountView | null>;
}

const ASSET_ACCOUNT_TYPES = ['ASSET', 'EXPENSE'] as const;

/**
 * Resolución efectiva de las cuentas de Bienes de Uso de un equipo, con el
 * origen de cada una y la que se usaría sin override. Lectura: los fallos
 * son excepciones, como el resto de las consultas de esta feature.
 */
export async function getVehicleAssetAccounts(vehicleId: string): Promise<VehicleAssetAccounts> {
  await checkPermission('equipment', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const loaded = await loadVehicleAssetAccounts(companyId, vehicleId);
  if (!loaded) throw new Error('Equipo no encontrado');

  const settings = await prisma.accountingSettings.findUnique({
    where: { companyId },
    select: {
      fixedAssetAccountId: true,
      accumulatedDepreciationAccountId: true,
      depreciationExpenseAccountId: true,
    },
  });
  const fallbackResolved = resolveAssetAccounts({ type: loaded.typeAccounts, settings });

  // Datos de las cuentas de respaldo que no están entre las resueltas.
  const missingIds = ASSET_ACCOUNT_KEYS.flatMap((key) => {
    const id = fallbackResolved[key]?.accountId;
    return id && !loaded.accounts[id] ? [id] : [];
  });
  const extraRows =
    missingIds.length === 0
      ? []
      : await prisma.account.findMany({
          where: { id: { in: missingIds }, companyId },
          select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
            isLeaf: true,
            disabledFrom: true,
          },
        });
  const accountsById = { ...loaded.accounts };
  const now = new Date();
  for (const row of extraRows) {
    // Mismo criterio que `buildImputableAccountsWhere`: hoja, activa y sin corte vigente.
    const imputable =
      row.isActive && row.isLeaf && (row.disabledFrom === null || row.disabledFrom > now);
    accountsById[row.id] = { id: row.id, code: row.code, name: row.name, imputable };
  }

  const toView = (
    entry: { accountId: string; source: AssetAccountSource } | null
  ): VehicleAssetAccountView | null => {
    if (!entry) return null;
    const info = accountsById[entry.accountId];
    return {
      accountId: entry.accountId,
      code: info?.code ?? '',
      name: info?.name ?? 'Cuenta eliminada',
      source: entry.source,
      imputable: info?.imputable ?? false,
    };
  };
  const mapKeys = (resolved: typeof loaded.resolved) =>
    Object.fromEntries(ASSET_ACCOUNT_KEYS.map((key) => [key, toView(resolved[key])])) as Record<
      AssetAccountKey,
      VehicleAssetAccountView | null
    >;

  return {
    vehicleLabel: loaded.vehicleLabel,
    typeId: loaded.typeId,
    typeName: loaded.typeName,
    isActive: loaded.isActive,
    hasDepreciation: loaded.hasDepreciation,
    depreciationId: loaded.depreciationId,
    postedCount: loaded.postedCount,
    overrides: {
      fixedAssetAccountId: loaded.overrides.fixedAssetAccountId ?? null,
      accumulatedDepreciationAccountId: loaded.overrides.accumulatedDepreciationAccountId ?? null,
      depreciationExpenseAccountId: loaded.overrides.depreciationExpenseAccountId ?? null,
    },
    accounts: mapKeys(loaded.resolved),
    fallbacks: mapKeys(fallbackResolved),
  };
}

/**
 * Cuentas elegibles para el override de la depreciación: imputables y de tipo
 * Activo (Bienes de Uso, Amortización acumulada) o Gasto (Gasto de
 * amortización). `includeIds` conserva las ya guardadas aunque hoy no cumplan
 * el filtro, para que el combo las muestre en vez de vaciarse. Propia de
 * `equipment`: no se importa la de `company` (regla de módulos).
 */
export async function getDepreciationAccountOptions(includeIds?: string[]) {
  await checkPermission('equipment', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const imputableWhere = buildImputableAccountsWhere({
    companyId,
    types: [...ASSET_ACCOUNT_TYPES],
  });
  const where =
    includeIds && includeIds.length > 0
      ? { OR: [imputableWhere, { companyId, id: { in: includeIds } }] }
      : imputableWhere;

  const rows = await prisma.account.findMany({
    where,
    select: { id: true, code: true, name: true, type: true },
    orderBy: { code: 'asc' },
  });

  return {
    asset: rows.filter((r) => r.type === 'ASSET').map(({ id, code, name }) => ({ id, code, name })),
    expense: rows
      .filter((r) => r.type === 'EXPENSE')
      .map(({ id, code, name }) => ({ id, code, name })),
  };
}

/**
 * Verifica que todas las cuentas elegidas sean de la empresa activa. No exige
 * que sean imputables: eso lo rechaza la contabilización con un mensaje que
 * dice de dónde salió la cuenta (`assertAssetAccountsForOperation`).
 */
async function assertAccountsBelongToCompany(
  ids: (string | null | undefined)[],
  companyId: string
): Promise<void> {
  const wanted = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (wanted.length === 0) return;
  const found = await prisma.account.count({ where: { id: { in: wanted }, companyId } });
  if (found !== wanted.length) {
    throw new BusinessError('Alguna de las cuentas seleccionadas no pertenece a la empresa');
  }
}

/**
 * Guarda el override de cuentas de la depreciación. Action propia porque
 * `updateVehicleDepreciation` bloquea con períodos contabilizados y regenera
 * el cronograma: acá se cambian solo las tres cuentas, sin tocar períodos ni
 * asientos ya generados (los próximos usan la nueva; el saldo acumulado lo
 * reclasifica el contador con un asiento manual).
 */
export async function updateDepreciationAccounts(
  depreciationId: string,
  input: DepreciationAccountsInput
): Promise<ActionResult> {
  await checkPermission('equipment', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = depreciationAccountsSchema.safeParse(input);
    if (!parsed.success) {
      throw new BusinessError(parsed.error.issues.map((issue) => issue.message).join(', '));
    }
    const after = parsed.data;

    const depreciation = await prisma.vehicleDepreciation.findFirst({
      where: { id: depreciationId, companyId },
      select: {
        vehicleId: true,
        fixedAssetAccountId: true,
        accumulatedDepreciationAccountId: true,
        depreciationExpenseAccountId: true,
        _count: { select: { scheduleEntries: { where: { isPosted: true } } } },
      },
    });
    if (!depreciation) throw new BusinessError('Depreciación no encontrada');

    await assertAccountsBelongToCompany(Object.values(after), companyId);

    await prisma.vehicleDepreciation.update({
      where: { id: depreciationId },
      data: after,
    });

    const { _count, vehicleId, ...before } = depreciation;
    logger.info('Cuentas de depreciación actualizadas', {
      data: { depreciationId, vehicleId, before, after, postedCount: _count.scheduleEntries },
    });
    revalidatePath(`/dashboard/equipment/${vehicleId}`);

    return { success: true };
  } catch (error) {
    return toActionResult(error, 'Error al actualizar las cuentas de la depreciación');
  }
}

// ============================================
// CRUD DE DEPRECIACIÓN
// ============================================

/**
 * Configura la depreciación para un equipo
 */
export async function createVehicleDepreciation(vehicleId: string, input: DepreciationConfigInput) {
  await checkPermission('equipment', 'create', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const parsed = depreciationConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.errors.map((e) => e.message).join(', '));
  }

  const data = parsed.data;

  try {
    // Verificar que el equipo existe y pertenece a la empresa
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, companyId: true, internNumber: true },
    });

    if (!vehicle || vehicle.companyId !== companyId) {
      throw new Error('Equipo no encontrado');
    }

    // Verificar que no tenga depreciación configurada
    const existing = await prisma.vehicleDepreciation.findUnique({
      where: { vehicleId },
    });

    if (existing) {
      throw new Error('El equipo ya tiene depreciación configurada');
    }

    // Generar schedule
    const scheduleEntries = generateDepreciationSchedule({
      method: data.method,
      grossValue: data.grossValue,
      salvageValue: data.salvageValue,
      usefulLifeMonths: data.usefulLifeMonths,
      startDate: data.startDate,
      depreciationRate: data.depreciationRate ?? undefined,
    });

    const endDate = calculateEndDate(data.startDate, data.usefulLifeMonths);

    // Crear en transacción
    const result = await prisma.$transaction(async (tx) => {
      const depreciation = await tx.vehicleDepreciation.create({
        data: {
          vehicleId,
          companyId,
          method: data.method,
          grossValue: new Prisma.Decimal(data.grossValue),
          salvageValue: new Prisma.Decimal(data.salvageValue),
          currentBookValue: new Prisma.Decimal(data.grossValue),
          usefulLifeMonths: data.usefulLifeMonths,
          startDate: data.startDate,
          endDate,
          depreciationRate: data.depreciationRate
            ? new Prisma.Decimal(data.depreciationRate)
            : null,
          createdBy: userId,
          scheduleEntries: {
            create: scheduleEntries.map((entry) => ({
              periodNumber: entry.periodNumber,
              scheduledDate: entry.scheduledDate,
              amount: new Prisma.Decimal(entry.amount),
              accumulatedAmount: new Prisma.Decimal(entry.accumulatedAmount),
              bookValueAfter: new Prisma.Decimal(entry.bookValueAfter),
            })),
          },
        },
        include: {
          scheduleEntries: { orderBy: { periodNumber: 'asc' } },
        },
      });

      return depreciation;
    });

    logger.info('Depreciación configurada', {
      data: { vehicleId, depreciationId: result.id, method: data.method },
    });

    revalidatePath(`/dashboard/equipment/${vehicleId}`);

    return {
      ...result,
      grossValue: Number(result.grossValue),
      salvageValue: Number(result.salvageValue),
      currentBookValue: Number(result.currentBookValue),
      totalDepreciated: Number(result.totalDepreciated),
      depreciationRate: result.depreciationRate ? Number(result.depreciationRate) : null,
      scheduleEntries: result.scheduleEntries.map((entry) => ({
        ...entry,
        amount: Number(entry.amount),
        accumulatedAmount: Number(entry.accumulatedAmount),
        bookValueAfter: Number(entry.bookValueAfter),
      })),
    };
  } catch (error) {
    logger.error('Error creating vehicle depreciation', { data: { error, vehicleId } });
    throw error instanceof Error ? error : new Error('Error al configurar la depreciación');
  }
}

/**
 * Actualiza la configuración de depreciación (solo si no hay períodos contabilizados)
 */
export async function updateVehicleDepreciation(
  depreciationId: string,
  input: DepreciationConfigInput,
) {
  await checkPermission('equipment', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const parsed = depreciationConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.errors.map((e) => e.message).join(', '));
  }

  const data = parsed.data;

  try {
    const depreciation = await prisma.vehicleDepreciation.findUnique({
      where: { id: depreciationId },
      include: {
        scheduleEntries: { where: { isPosted: true }, select: { id: true } },
      },
    });

    if (!depreciation || depreciation.companyId !== companyId) {
      throw new Error('Depreciación no encontrada');
    }

    if (depreciation.scheduleEntries.length > 0) {
      throw new Error('No se puede modificar una depreciación con períodos contabilizados');
    }

    // Regenerar schedule
    const scheduleEntries = generateDepreciationSchedule({
      method: data.method,
      grossValue: data.grossValue,
      salvageValue: data.salvageValue,
      usefulLifeMonths: data.usefulLifeMonths,
      startDate: data.startDate,
      depreciationRate: data.depreciationRate ?? undefined,
    });

    const endDate = calculateEndDate(data.startDate, data.usefulLifeMonths);

    await prisma.$transaction(async (tx) => {
      // Eliminar schedule anterior
      await tx.depreciationScheduleEntry.deleteMany({
        where: { depreciationId },
      });

      // Actualizar depreciación
      await tx.vehicleDepreciation.update({
        where: { id: depreciationId },
        data: {
          method: data.method,
          grossValue: new Prisma.Decimal(data.grossValue),
          salvageValue: new Prisma.Decimal(data.salvageValue),
          currentBookValue: new Prisma.Decimal(data.grossValue),
          usefulLifeMonths: data.usefulLifeMonths,
          startDate: data.startDate,
          endDate,
          depreciationRate: data.depreciationRate
            ? new Prisma.Decimal(data.depreciationRate)
            : null,
          totalDepreciated: new Prisma.Decimal(0),
          lastDepreciationDate: null,
          scheduleEntries: {
            create: scheduleEntries.map((entry) => ({
              periodNumber: entry.periodNumber,
              scheduledDate: entry.scheduledDate,
              amount: new Prisma.Decimal(entry.amount),
              accumulatedAmount: new Prisma.Decimal(entry.accumulatedAmount),
              bookValueAfter: new Prisma.Decimal(entry.bookValueAfter),
            })),
          },
        },
      });
    });

    logger.info('Depreciación actualizada', { data: { depreciationId } });
    revalidatePath(`/dashboard/equipment/${depreciation.vehicleId}`);
  } catch (error) {
    logger.error('Error updating vehicle depreciation', { data: { error, depreciationId } });
    throw error instanceof Error ? error : new Error('Error al actualizar la depreciación');
  }
}

/**
 * Suspende o reactiva una depreciación
 */
export async function toggleDepreciationStatus(
  depreciationId: string,
  status: 'ACTIVE' | 'SUSPENDED',
) {
  await checkPermission('equipment', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const depreciation = await prisma.vehicleDepreciation.findUnique({
      where: { id: depreciationId },
      select: { id: true, companyId: true, vehicleId: true, status: true },
    });

    if (!depreciation || depreciation.companyId !== companyId) {
      throw new Error('Depreciación no encontrada');
    }

    if (depreciation.status === 'COMPLETED') {
      throw new Error('No se puede modificar una depreciación completada');
    }

    await prisma.vehicleDepreciation.update({
      where: { id: depreciationId },
      data: { status },
    });

    logger.info('Estado de depreciación cambiado', {
      data: { depreciationId, newStatus: status },
    });

    revalidatePath(`/dashboard/equipment/${depreciation.vehicleId}`);
  } catch (error) {
    logger.error('Error toggling depreciation status', { data: { error, depreciationId } });
    throw error instanceof Error ? error : new Error('Error al cambiar el estado');
  }
}

/**
 * Elimina la depreciación (solo si no hay períodos contabilizados)
 */
export async function deleteVehicleDepreciation(depreciationId: string) {
  await checkPermission('equipment', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const depreciation = await prisma.vehicleDepreciation.findUnique({
      where: { id: depreciationId },
      include: {
        scheduleEntries: { where: { isPosted: true }, select: { id: true } },
      },
    });

    if (!depreciation || depreciation.companyId !== companyId) {
      throw new Error('Depreciación no encontrada');
    }

    if (depreciation.scheduleEntries.length > 0) {
      throw new Error('No se puede eliminar una depreciación con períodos contabilizados');
    }

    await prisma.vehicleDepreciation.delete({
      where: { id: depreciationId },
    });

    logger.info('Depreciación eliminada', { data: { depreciationId } });
    revalidatePath(`/dashboard/equipment/${depreciation.vehicleId}`);
  } catch (error) {
    logger.error('Error deleting vehicle depreciation', { data: { error, depreciationId } });
    throw error instanceof Error ? error : new Error('Error al eliminar la depreciación');
  }
}

// ============================================
// CONTABILIZACIÓN DE PERÍODOS
// ============================================

/** Un equipo (o período) que la masiva no pudo contabilizar y por qué. */
export interface BulkDepreciationError {
  vehicleId: string;
  /** `internNumber || domain || id corto`, como en los asientos. */
  label: string;
  message: string;
}

/** Cuentas ya validadas con las que se arma el asiento de un período. */
interface DepreciationEntryAccounts {
  depreciationExpenseAccountId: string;
  accumulatedDepreciationAccountId: string;
}

/** Período pendiente con lo mínimo de su depreciación para contabilizarlo. */
type PendingEntry = Prisma.DepreciationScheduleEntryGetPayload<{
  include: {
    depreciation: { select: { id: true; vehicleId: true; status: true; companyId: true } };
  };
}>;

/**
 * Asiento + marcas de un período, dentro de una transacción ya abierta. Es la
 * única pieza compartida entre la contabilización individual y la masiva.
 */
async function postEntryTx(
  tx: PrismaTransactionClient,
  entry: PendingEntry,
  vehicleLabel: string,
  accounts: DepreciationEntryAccounts,
  companyId: string,
  userId: string
) {
  const amount = Number(entry.amount);
  const fiscal = await resolveFiscalPeriodTx(companyId, entry.scheduledDate, tx);

  // Incremento atómico: UPDATE ... RETURNING evita race conditions
  const [{ last_entry_number: nextNumber }] = await tx.$queryRaw<[{ last_entry_number: number }]>`
    UPDATE accounting_settings
    SET last_entry_number = last_entry_number + 1, updated_at = NOW()
    WHERE company_id = ${companyId}::uuid
    RETURNING last_entry_number
  `;

  const journalEntry = await tx.journalEntry.create({
    data: {
      companyId,
      number: nextNumber,
      date: entry.scheduledDate,
      description: `Depreciación período ${entry.periodNumber}: Equipo ${vehicleLabel}`,
      createdBy: 'system',
      fiscalYearId: fiscal.fiscalYearId,
      periodId: fiscal.periodId,
      lines: {
        create: [
          {
            accountId: accounts.depreciationExpenseAccountId,
            debit: new Prisma.Decimal(amount),
            credit: new Prisma.Decimal(0),
            description: `Gasto depreciación - Equipo ${vehicleLabel}`,
          },
          {
            accountId: accounts.accumulatedDepreciationAccountId,
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(amount),
            description: `Depreciación acumulada - Equipo ${vehicleLabel}`,
          },
        ],
      },
    },
    select: { id: true, number: true },
  });

  // Marcar período como contabilizado
  await tx.depreciationScheduleEntry.update({
    where: { id: entry.id },
    data: {
      isPosted: true,
      journalEntryId: journalEntry.id,
      postedDate: new Date(),
      postedBy: userId,
    },
  });

  // Actualizar tracking en la depreciación
  await tx.vehicleDepreciation.update({
    where: { id: entry.depreciationId },
    data: {
      currentBookValue: entry.bookValueAfter,
      totalDepreciated: entry.accumulatedAmount,
      lastDepreciationDate: entry.scheduledDate,
    },
  });

  // Si es el último período, marcar depreciación como completada
  const remainingEntries = await tx.depreciationScheduleEntry.count({
    where: { depreciationId: entry.depreciationId, isPosted: false },
  });
  if (remainingEntries === 0) {
    await tx.vehicleDepreciation.update({
      where: { id: entry.depreciationId },
      data: { status: 'COMPLETED' },
    });
  }

  return journalEntry;
}

/** Ids listos para el asiento; las dos cuentas ya vienen garantizadas por la pre-validación. */
function toEntryAccounts(loaded: LoadedVehicleAssetAccounts): DepreciationEntryAccounts {
  const asserted = assertAssetAccountsForOperation(loaded, 'depreciation');
  return {
    depreciationExpenseAccountId: asserted.depreciationExpenseAccountId!,
    accumulatedDepreciationAccountId: asserted.accumulatedDepreciationAccountId!,
  };
}

const pendingEntryInclude = {
  depreciation: { select: { id: true, vehicleId: true, status: true, companyId: true } },
} as const;

/**
 * Contabiliza un período individual de depreciación (TSK-724c). Las cuentas se
 * resuelven depreciación → tipo de equipo → por defecto y se validan ANTES de
 * abrir la transacción; cualquier condición de negocio vuelve como
 * `{ success: false, error }` con el motivo completo, nunca como excepción.
 */
export async function postDepreciationEntry(
  scheduleEntryId: string
): Promise<ActionResult<{ journalEntryId: string; journalEntryNumber: number }>> {
  await checkPermission('equipment', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  try {
    const entry = await prisma.depreciationScheduleEntry.findUnique({
      where: { id: scheduleEntryId },
      include: pendingEntryInclude,
    });

    if (!entry || entry.depreciation.companyId !== companyId) {
      throw new BusinessError('Período de depreciación no encontrado');
    }
    if (entry.isPosted) throw new BusinessError('Este período ya está contabilizado');
    if (entry.depreciation.status !== 'ACTIVE') {
      throw new BusinessError('La depreciación no está activa');
    }

    // Verificar secuencia: el período anterior debe estar contabilizado
    if (entry.periodNumber > 1) {
      const previousEntry = await prisma.depreciationScheduleEntry.findUnique({
        where: {
          depreciationId_periodNumber: {
            depreciationId: entry.depreciationId,
            periodNumber: entry.periodNumber - 1,
          },
        },
        select: { isPosted: true },
      });
      if (!previousEntry?.isPosted) {
        throw new BusinessError('Debe contabilizar los períodos anteriores primero');
      }
    }

    // Cuentas resueltas y validadas fuera de la transacción
    const loaded = await loadVehicleAssetAccounts(companyId, entry.depreciation.vehicleId);
    if (!loaded) throw new BusinessError('Equipo no encontrado');
    const accounts = toEntryAccounts(loaded);

    // Verificar bloqueo de período
    if (
      loaded.lockedUntilDate &&
      moment(entry.scheduledDate).isSameOrBefore(moment(loaded.lockedUntilDate), 'day')
    ) {
      throw new BusinessError(
        `No se puede contabilizar la depreciación. El período ${moment(entry.scheduledDate).format('MM/YYYY')} está bloqueado.`
      );
    }

    const result = await prisma.$transaction((tx) =>
      postEntryTx(tx, entry, loaded.vehicleLabel, accounts, companyId, userId)
    );

    logger.info('Período de depreciación contabilizado', {
      data: { scheduleEntryId, journalEntryId: result.id },
    });
    revalidatePath(`/dashboard/equipment/${entry.depreciation.vehicleId}`);

    return { success: true, journalEntryId: result.id, journalEntryNumber: result.number };
  } catch (error) {
    return toActionResult(error, 'Error al contabilizar el período');
  }
}

/**
 * Contabiliza todos los períodos pendientes hasta una fecha dada (TSK-724c).
 * Las cuentas de cada equipo se resuelven y validan ANTES de la transacción: un
 * equipo sin cuentas (o con una no imputable) queda afuera con su mensaje en
 * `errors[]` y no frena a los demás.
 */
export async function postAllPendingDepreciations(
  upToDate: Date
): Promise<ActionResult<{ posted: number; errors: BulkDepreciationError[] }>> {
  await checkPermission('equipment', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: { lockedUntilDate: true },
    });

    // Todos los períodos pendientes hasta la fecha (excluyendo períodos bloqueados)
    const pendingEntries = await prisma.depreciationScheduleEntry.findMany({
      where: {
        isPosted: false,
        scheduledDate: {
          lte: upToDate,
          ...(settings?.lockedUntilDate ? { gt: settings.lockedUntilDate } : {}),
        },
        depreciation: { companyId, status: 'ACTIVE' },
      },
      include: pendingEntryInclude,
      orderBy: [{ scheduledDate: 'asc' }, { periodNumber: 'asc' }],
    });

    if (pendingEntries.length === 0) {
      return { success: true, posted: 0, errors: [] };
    }

    // Pre-validación por equipo, fuera de la transacción
    const vehicleIds = Array.from(new Set(pendingEntries.map((e) => e.depreciation.vehicleId)));
    const loadedByVehicle = await loadVehiclesAssetAccounts(companyId, vehicleIds);
    const errors: BulkDepreciationError[] = [];
    const accountsByVehicle = new Map<string, DepreciationEntryAccounts>();

    for (const vehicleId of vehicleIds) {
      const loaded = loadedByVehicle.get(vehicleId);
      if (!loaded) {
        errors.push({ vehicleId, label: vehicleId.slice(0, 8), message: 'Equipo no encontrado' });
        continue;
      }
      try {
        accountsByVehicle.set(vehicleId, toEntryAccounts(loaded));
      } catch (error) {
        if (!(error instanceof BusinessError)) throw error;
        errors.push({ vehicleId, label: loaded.vehicleLabel, message: error.message });
      }
    }

    const entriesToPost = pendingEntries.filter((e) =>
      accountsByVehicle.has(e.depreciation.vehicleId)
    );
    let posted = 0;

    await prisma.$transaction(async (tx) => {
      for (const entry of entriesToPost) {
        const vehicleId = entry.depreciation.vehicleId;
        const label = loadedByVehicle.get(vehicleId)?.vehicleLabel ?? vehicleId.slice(0, 8);
        try {
          // Verificar secuencia
          if (entry.periodNumber > 1) {
            const previousEntry = await tx.depreciationScheduleEntry.findUnique({
              where: {
                depreciationId_periodNumber: {
                  depreciationId: entry.depreciationId,
                  periodNumber: entry.periodNumber - 1,
                },
              },
              select: { isPosted: true },
            });
            if (!previousEntry?.isPosted) {
              errors.push({
                vehicleId,
                label,
                message: `Equipo ${label}: período ${entry.periodNumber} omitido (anterior no contabilizado)`,
              });
              continue;
            }
          }

          await postEntryTx(tx, entry, label, accountsByVehicle.get(vehicleId)!, companyId, userId);
          posted++;
        } catch (entryError) {
          errors.push({
            vehicleId,
            label,
            message: `Equipo ${label}: ${entryError instanceof Error ? entryError.message : 'Error desconocido'}`,
          });
        }
      }
    });

    logger.info('Depreciaciones masivas contabilizadas', {
      data: { posted, errors: errors.length, upToDate },
    });
    revalidatePath('/dashboard/equipment');

    return { success: true, posted, errors };
  } catch (error) {
    return toActionResult(error, 'Error al contabilizar depreciaciones');
  }
}

// ============================================
// AJUSTE DE VALOR
// ============================================

/**
 * Crea un ajuste de valor para un equipo con depreciación
 */
export async function createValueAdjustment(vehicleId: string, input: ValueAdjustmentInput) {
  await checkPermission('equipment', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const parsed = valueAdjustmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.errors.map((e) => e.message).join(', '));
  }

  const data = parsed.data;

  try {
    const depreciation = await prisma.vehicleDepreciation.findUnique({
      where: { vehicleId },
      include: {
        scheduleEntries: {
          orderBy: { periodNumber: 'asc' },
        },
        vehicle: {
          select: { id: true, internNumber: true, domain: true },
        },
      },
    });

    if (!depreciation || depreciation.companyId !== companyId) {
      throw new Error('Depreciación no encontrada para este equipo');
    }

    if (depreciation.status !== 'ACTIVE') {
      throw new Error('La depreciación no está activa');
    }

    const previousValue = Number(depreciation.currentBookValue);
    const differenceAmount = data.newValue - previousValue;

    // Obtener cuentas contables (solo lectura, fuera de la transacción)
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: {
        fixedAssetAccountId: true,
        accumulatedDepreciationAccountId: true,
        assetDisposalGainLossAccountId: true,
      },
    });

    const vehicle = depreciation.vehicle;
    const vehicleLabel = vehicle.internNumber || vehicle.domain || vehicle.id.slice(0, 8);

    await prisma.$transaction(async (tx) => {
      // Crear ajuste de valor
      let journalEntryId: string | undefined;

      // Crear asiento contable si las cuentas están configuradas
      if (
        settings?.fixedAssetAccountId &&
        settings?.accumulatedDepreciationAccountId &&
        settings?.assetDisposalGainLossAccountId
      ) {
        const fiscal = await resolveFiscalPeriodTx(companyId, data.date, tx);

        // Incremento atómico: UPDATE ... RETURNING evita race conditions
        const [{ last_entry_number: nextNumber }] = await tx.$queryRaw<[{ last_entry_number: number }]>`
          UPDATE accounting_settings
          SET last_entry_number = last_entry_number + 1, updated_at = NOW()
          WHERE company_id = ${companyId}::uuid
          RETURNING last_entry_number
        `;

        const absAmount = Math.abs(differenceAmount);

        const lines =
          differenceAmount > 0
            ? [
                {
                  accountId: settings.fixedAssetAccountId,
                  debit: new Prisma.Decimal(absAmount),
                  credit: new Prisma.Decimal(0),
                  description: `Revaluación - Equipo ${vehicleLabel}`,
                },
                {
                  accountId: settings.assetDisposalGainLossAccountId,
                  debit: new Prisma.Decimal(0),
                  credit: new Prisma.Decimal(absAmount),
                  description: `Resultado por revaluación - Equipo ${vehicleLabel}`,
                },
              ]
            : [
                {
                  accountId: settings.assetDisposalGainLossAccountId,
                  debit: new Prisma.Decimal(absAmount),
                  credit: new Prisma.Decimal(0),
                  description: `Deterioro de valor - Equipo ${vehicleLabel}`,
                },
                {
                  accountId: settings.accumulatedDepreciationAccountId,
                  debit: new Prisma.Decimal(0),
                  credit: new Prisma.Decimal(absAmount),
                  description: `Ajuste dep. acumulada - Equipo ${vehicleLabel}`,
                },
              ];

        const journalEntry = await tx.journalEntry.create({
          data: {
            companyId,
            number: nextNumber,
            date: data.date,
            description: `Ajuste de valor equipo ${vehicleLabel}: ${data.reason}`,
            createdBy: 'system',
            fiscalYearId: fiscal.fiscalYearId,
            periodId: fiscal.periodId,
            lines: { create: lines },
          },
        });

        journalEntryId = journalEntry.id;
      }

      await tx.assetValueAdjustment.create({
        data: {
          vehicleId,
          companyId,
          date: data.date,
          previousValue: new Prisma.Decimal(previousValue),
          newValue: new Prisma.Decimal(data.newValue),
          differenceAmount: new Prisma.Decimal(differenceAmount),
          reason: data.reason,
          journalEntryId,
          createdBy: userId,
        },
      });

      // Actualizar valor libro actual
      await tx.vehicleDepreciation.update({
        where: { vehicleId },
        data: {
          currentBookValue: new Prisma.Decimal(data.newValue),
        },
      });

      // Recalcular schedule de períodos no contabilizados
      const lastPostedEntry = depreciation.scheduleEntries
        .filter((e) => e.isPosted)
        .pop();

      const unpostedEntries = depreciation.scheduleEntries.filter((e) => !e.isPosted);

      if (unpostedEntries.length > 0) {
        const startPeriodNumber = unpostedEntries[0].periodNumber;
        const previousAccumulated = lastPostedEntry
          ? Number(lastPostedEntry.accumulatedAmount)
          : 0;

        const newSchedule = recalculateScheduleFromPeriod(
          {
            method: depreciation.method,
            newBookValue: data.newValue,
            salvageValue: Number(depreciation.salvageValue),
            remainingMonths: unpostedEntries.length,
            depreciationRate: depreciation.depreciationRate
              ? Number(depreciation.depreciationRate)
              : undefined,
            startPeriodNumber,
            startDate: unpostedEntries[0].scheduledDate,
          },
          previousAccumulated,
        );

        // Eliminar entries no contabilizados
        await tx.depreciationScheduleEntry.deleteMany({
          where: {
            depreciationId: depreciation.id,
            isPosted: false,
          },
        });

        // Crear nuevos entries
        await tx.depreciationScheduleEntry.createMany({
          data: newSchedule.map((entry) => ({
            depreciationId: depreciation.id,
            periodNumber: entry.periodNumber,
            scheduledDate: entry.scheduledDate,
            amount: new Prisma.Decimal(entry.amount),
            accumulatedAmount: new Prisma.Decimal(entry.accumulatedAmount),
            bookValueAfter: new Prisma.Decimal(entry.bookValueAfter),
          })),
        });
      }
    });

    logger.info('Ajuste de valor creado', {
      data: { vehicleId, previousValue, newValue: data.newValue, differenceAmount },
    });

    revalidatePath(`/dashboard/equipment/${vehicleId}`);
  } catch (error) {
    logger.error('Error creating value adjustment', { data: { error, vehicleId } });
    throw error instanceof Error ? error : new Error('Error al crear el ajuste de valor');
  }
}

/**
 * Obtiene el resumen de depreciaciones pendientes para contabilización masiva
 */
export async function getPendingDepreciationsSummary(upToDate: Date) {
  await checkPermission('equipment', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const pendingEntries = await prisma.depreciationScheduleEntry.findMany({
      where: {
        isPosted: false,
        scheduledDate: { lte: upToDate },
        depreciation: {
          companyId,
          status: 'ACTIVE',
        },
      },
      include: {
        depreciation: {
          include: {
            vehicle: {
              select: { id: true, internNumber: true, domain: true },
            },
          },
        },
      },
      orderBy: [{ scheduledDate: 'asc' }, { periodNumber: 'asc' }],
    });

    const totalAmount = pendingEntries.reduce((sum, e) => sum + Number(e.amount), 0);
    const vehicleIds = Array.from(new Set(pendingEntries.map((e) => e.depreciation.vehicleId)));
    const vehicleCount = vehicleIds.length;

    // Aviso previo (TSK-724c): equipos que la masiva va a omitir por falta de cuentas.
    const loadedByVehicle = await loadVehiclesAssetAccounts(companyId, vehicleIds);
    const vehiclesWithoutAccounts: Array<{
      vehicleId: string;
      vehicleLabel: string;
      message: string;
    }> = [];
    for (const loaded of loadedByVehicle.values()) {
      try {
        assertAssetAccountsForOperation(loaded, 'depreciation');
      } catch (error) {
        if (!(error instanceof BusinessError)) throw error;
        vehiclesWithoutAccounts.push({
          vehicleId: loaded.vehicleId,
          vehicleLabel: loaded.vehicleLabel,
          message: error.message,
        });
      }
    }

    return {
      vehiclesWithoutAccounts,
      entries: pendingEntries.map((e) => ({
        id: e.id,
        periodNumber: e.periodNumber,
        scheduledDate: e.scheduledDate,
        amount: Number(e.amount),
        vehicleId: e.depreciation.vehicleId,
        vehicleLabel:
          e.depreciation.vehicle.internNumber ||
          e.depreciation.vehicle.domain ||
          e.depreciation.vehicleId.slice(0, 8),
      })),
      totalEntries: pendingEntries.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      vehicleCount,
    };
  } catch (error) {
    logger.error('Error getting pending depreciations summary', { data: { error } });
    throw error instanceof Error
      ? error
      : new Error('Error al obtener el resumen de depreciaciones pendientes');
  }
}
