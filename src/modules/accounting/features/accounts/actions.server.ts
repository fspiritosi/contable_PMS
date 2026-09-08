'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import type { AccountType } from '@/generated/prisma/enums';
import type { Account } from '@/generated/prisma/client';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { revalidateAccountingRoutes, getAccountRollupBalances } from '../../shared/utils';
import {
  collectSubtreeIds,
  resolveFixedAssetCascade,
  type FixedAssetCascadeReason,
} from '../../shared/utils/account-subtree';
import { type CreateAccountInput } from '../../shared/types';
import {
  validateAccountCode,
  validateAccountNature,
  validateAccountParent,
  validateAccountParentSameType,
  natureForType,
} from '../../shared/validators';
import {
  validateAccountCodeFormat,
  AccountCodeFormatError,
  getParentCode,
} from '../../shared/utils/account-code';
import { getCurrentFiscalYear, getNextFiscalYear } from '../../shared/utils/fiscal-year';
import { MODEL_CHART_OF_ACCOUNTS } from './data/model-chart-of-accounts';
import { isModelFixedAssetCode } from './data/model-fixed-assets';
import { randomUUID } from 'crypto';

/**
 * Normaliza el código con `validateAccountCodeFormat` traduciendo el error de
 * formato a un `Error` con mensaje claro para la UI.
 */
function normalizeAccountCode(code: string): string {
  try {
    return validateAccountCodeFormat(code);
  } catch (error) {
    if (error instanceof AccountCodeFormatError) {
      throw new Error(error.message);
    }
    throw error;
  }
}

/**
 * Recalcula `isLeaf` de una cuenta padre en base a la cantidad real de hijas.
 * Una cuenta sin hijas vuelve a ser hoja (imputable).
 */
async function recomputeIsLeaf(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  parentId: string
): Promise<void> {
  const childCount = await tx.account.count({ where: { parentId } });
  await tx.account.update({
    where: { id: parentId },
    data: { isLeaf: childCount === 0 },
  });
}

/**
 * Crea una nueva cuenta contable
 */
export async function createAccount(params: { companyId: string, input: CreateAccountInput }) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.accounts', 'create', { redirect: true });
  try {
    const { companyId, input } = params;

    // Normalizar y validar formato de código antes de unicidad.
    const normalizedCode = normalizeAccountCode(input.code);

    // Validaciones
    await validateAccountCode(companyId, normalizedCode);
    await validateAccountParent(companyId, input.parentId);
    await validateAccountParentSameType(companyId, input.parentId, input.type);
    validateAccountNature(input.type, input.nature);

    // La cuenta nace hoja (imputable); si tiene padre, el padre deja de ser hoja.
    const account = await prisma.$transaction(async (tx) => {
      // TSK-618: la cuenta nueva HEREDA la marca de Bien de Uso del padre. Sin
      // esto, una hija creada después de tildar el rubro queda desalineada en
      // silencio. Un valor explícito en el input gana: el modal deja destildar
      // la hija en el mismo alta (el caso de una Amortización Acumulada).
      let inheritedIsFixedAsset = false;
      if (input.parentId) {
        const parent = await tx.account.findUnique({
          where: { id: input.parentId },
          select: { isFixedAsset: true },
        });
        inheritedIsFixedAsset = parent?.isFixedAsset ?? false;
      }

      const created = await tx.account.create({
        data: {
          code: normalizedCode,
          name: input.name,
          type: input.type,
          nature: input.nature,
          description: input.description,
          parentId: input.parentId,
          companyId: companyId,
          isLeaf: true,
          isFixedAsset: input.isFixedAsset ?? inheritedIsFixedAsset,
        },
      });

      if (input.parentId) {
        await tx.account.update({
          where: { id: input.parentId },
          data: { isLeaf: false },
        });
      }

      return created;
    });

    logger.info('Cuenta contable creada', {
      data: { accountId: account.id, userId, isFixedAsset: account.isFixedAsset },
    });
    revalidateAccountingRoutes(companyId);

    return account;
  } catch (error) {
    logger.error('Error al crear cuenta contable', { data: { error, userId } });
    throw error;
  }
}

/**
 * Alcance real de la cascada de la marca de Bien de Uso en un guardado (TSK-618).
 */
export interface FixedAssetCascadeResult {
  applied: boolean;
  /** Valor propagado. Irrelevante si `applied` es false. */
  value: boolean;
  reason: FixedAssetCascadeReason | null;
  /** Descendientes reescritos (NO incluye la cuenta editada). */
  affectedAccountIds: string[];
}

export type UpdateAccountResult = Account & {
  fixedAssetCascade: FixedAssetCascadeResult;
};

/**
 * Actualiza una cuenta contable existente.
 *
 * TSK-618: propaga la marca de Bien de Uso al subárbol, pero **solo cuando el
 * valor cambia** (ver `resolveFixedAssetCascade`). Si se propagara en cada
 * guardado, editar el nombre del rubro pisaría las excepciones destildadas a
 * mano —típicamente las Amortizaciones Acumuladas, que cuelgan del rubro pero
 * son regularizadoras— y el síntoma aparecería recién en producción.
 */
export async function updateAccount(
  companyId: string,
  accountId: string,
  input: Partial<CreateAccountInput>
): Promise<UpdateAccountResult> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.accounts', 'update', { redirect: true });

  try {
    // Validar que la cuenta exista y pertenezca a la empresa
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new Error('Cuenta no encontrada');
    }

    if (account.companyId !== companyId) {
      throw new Error('La cuenta no pertenece a la empresa');
    }

    // Normalizar código si cambia.
    let normalizedCode: string | undefined;
    if (input.code && input.code !== account.code) {
      normalizedCode = normalizeAccountCode(input.code);
      if (normalizedCode !== account.code) {
        await validateAccountCode(companyId, normalizedCode, accountId);
      }
    }

    // Tipo efectivo de la cuenta tras la edición (para validar el padre).
    const effectiveType: AccountType = input.type ?? account.type;

    if (input.parentId !== undefined) {
      await validateAccountParent(companyId, input.parentId);
      await validateAccountParentSameType(companyId, input.parentId, effectiveType, accountId);
    }

    if (input.type && input.nature) {
      validateAccountNature(input.type, input.nature);
    }

    const parentChanged =
      input.parentId !== undefined && input.parentId !== account.parentId;

    // TSK-618: valor de Bien de Uso del padre nuevo, solo si hace falta.
    let newParentIsFixedAsset: boolean | null = null;
    if (parentChanged && input.parentId) {
      const newParent = await prisma.account.findUnique({
        where: { id: input.parentId },
        select: { isFixedAsset: true },
      });
      newParentIsFixedAsset = newParent?.isFixedAsset ?? null;
    }

    // ¿Hay cascada? Decisión pura, testeada sin base.
    const cascade = resolveFixedAssetCascade({
      current: account.isFixedAsset,
      input: input.isFixedAsset,
      parentChanged,
      newParentIsFixedAsset,
    });

    // El subárbol solo se lee cuando hay algo que propagar: una edición común
    // de nombre o descripción NO dispara el findMany de todas las cuentas.
    let descendantIds: string[] = [];
    if (cascade) {
      const allAccounts = await prisma.account.findMany({
        where: { companyId },
        select: { id: true, parentId: true },
      });
      descendantIds = collectSubtreeIds(allAccounts, accountId).filter((id) => id !== accountId);
    }

    const updatedAccount = await prisma.$transaction(async (tx) => {
      const updated = await tx.account.update({
        where: { id: accountId },
        data: {
          ...input,
          ...(normalizedCode ? { code: normalizedCode } : {}),
          // La cascada por cambio de padre pisa lo que haya mandado el
          // formulario: al mover una cuenta de rubro, manda el rubro nuevo.
          ...(cascade ? { isFixedAsset: cascade.value } : {}),
        },
      });

      // Si cambió el padre, recomputar isLeaf del padre anterior y del nuevo.
      if (parentChanged) {
        if (account.parentId) {
          await recomputeIsLeaf(tx, account.parentId);
        }
        if (input.parentId) {
          await tx.account.update({
            where: { id: input.parentId },
            data: { isLeaf: false },
          });
        }
      }

      // Un solo updateMany para todo el subárbol: nada de N updates en un for.
      // El `companyId` en el where es defensa en profundidad: los ids ya salen
      // de un findMany filtrado por empresa.
      if (cascade && descendantIds.length > 0) {
        await tx.account.updateMany({
          where: { id: { in: descendantIds }, companyId },
          data: { isFixedAsset: cascade.value },
        });
      }

      return updated;
    });

    logger.info('Cuenta contable actualizada', {
      data: {
        accountId,
        userId,
        isFixedAsset: updatedAccount.isFixedAsset,
        cascadeReason: cascade?.reason ?? null,
        affected: cascade ? descendantIds.length : 0,
      },
    });
    revalidateAccountingRoutes(companyId);

    return {
      ...updatedAccount,
      fixedAssetCascade: {
        applied: cascade !== null,
        value: cascade?.value ?? updatedAccount.isFixedAsset,
        reason: cascade?.reason ?? null,
        affectedAccountIds: cascade ? descendantIds : [],
      },
    };
  } catch (error) {
    logger.error('Error al actualizar cuenta contable', { data: { error, accountId, userId } });
    throw error;
  }
}

/**
 * Elimina una cuenta contable (soft delete)
 */
export async function deleteAccount(companyId: string, accountId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.accounts', 'delete', { redirect: true });

  try {
    // Validar que la cuenta exista y pertenezca a la empresa
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: {
        children: true,
        entries: true,
      },
    });

    if (!account) {
      throw new Error('Cuenta no encontrada');
    }

    if (account.companyId !== companyId) {
      throw new Error('La cuenta no pertenece a la empresa');
    }

    // No permitir eliminar si tiene subcuentas
    if (account.children.length > 0) {
      throw new Error('No se puede eliminar una cuenta con subcuentas');
    }

    // No permitir eliminar si tiene movimientos
    if (account.entries.length > 0) {
      throw new Error('No se puede eliminar una cuenta con movimientos');
    }

    // Soft delete + recomputar isLeaf del padre (si quedó sin hijas).
    await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: { isActive: false },
      });

      if (account.parentId) {
        await recomputeIsLeaf(tx, account.parentId);
      }
    });

    logger.info('Cuenta contable eliminada', { data: { accountId, userId } });
    revalidateAccountingRoutes(companyId);

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar cuenta contable', { data: { error, accountId, userId } });
    throw error;
  }
}

/**
 * Obtiene todas las cuentas de una empresa
 */
export async function getAccounts(companyId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.accounts', 'view', { redirect: true });

  try {
    const accounts = await prisma.account.findMany({
      where: {
        companyId,
        isActive: true,
      },
      orderBy: { code: 'asc' },
    });

    return accounts;
  } catch (error) {
    logger.error('Error al obtener cuentas contables', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Obtiene una cuenta contable por ID
 */
export async function getAccountById(companyId: string, accountId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.accounts', 'view', { redirect: true });

  try {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: {
        children: {
          where: { isActive: true },
          orderBy: { code: 'asc' },
        },
      },
    });

    if (!account) {
      throw new Error('Cuenta no encontrada');
    }

    if (account.companyId !== companyId) {
      throw new Error('La cuenta no pertenece a la empresa');
    }

    return account;
  } catch (error) {
    logger.error('Error al obtener cuenta contable', { data: { error, accountId, userId } });
    throw error;
  }
}

/**
 * Obtiene las cuentas **imputables** (hojas activas y vigentes) de una empresa,
 * opcionalmente restringidas a ciertos tipos. Para alimentar selects de imputación.
 *
 * NO reemplaza a `getAccounts` (que sí debe traer cuentas de sumatoria para el
 * selector de padre). Usa el filtro compartido `buildImputableAccountsWhere`.
 */
export async function getImputableAccounts(companyId: string, types?: AccountType[]) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.accounts', 'view', { redirect: true });

  try {
    const accounts = await prisma.account.findMany({
      where: buildImputableAccountsWhere({ companyId, types }),
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        nature: true,
      },
      orderBy: { code: 'asc' },
    });

    return accounts;
  } catch (error) {
    logger.error('Error al obtener cuentas imputables', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Resultado de deshabilitar una cuenta (y su subárbol).
 */
export interface DisableAccountResult {
  /** Cuenta raíz sobre la que se invocó la acción. */
  accountId: string;
  /** IDs de todas las cuentas afectadas (raíz + descendientes). */
  affectedAccountIds: string[];
  /** Cuentas cortadas en el ejercicio en curso (saldo 0). */
  cutInCurrentFiscalYear: Array<{ accountId: string; balance: number }>;
  /** Cuentas cortadas en el próximo ejercicio (con saldo). */
  cutInNextFiscalYear: Array<{ accountId: string; balance: number }>;
  currentFiscalYear: { id: string | null; number: number | null; startDate: Date };
  nextFiscalYear: { id: string | null; number: number | null; startDate: Date } | null;
}

/**
 * Deshabilita una cuenta (y su subárbol en cascada) programando el corte por ejercicio.
 *
 * Regla por cuenta (evaluada individualmente, incluso en cascada):
 * - saldo (roll-up) == 0 → corte en el ejercicio EN CURSO (`disabledFrom = currentFY.startDate`).
 * - saldo != 0           → corte en el PRÓXIMO ejercicio (`disabledFrom = nextFY.startDate`).
 *
 * Todo dentro de una transacción. Convierte los Decimals a Number.
 */
export async function disableAccount(
  companyId: string,
  accountId: string
): Promise<DisableAccountResult> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.accounts', 'update', { redirect: true });

  try {
    // Cuenta raíz válida y de la empresa.
    const root = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, companyId: true },
    });
    if (!root) throw new Error('Cuenta no encontrada');
    if (root.companyId !== companyId) {
      throw new Error('La cuenta no pertenece a la empresa');
    }

    // Ejercicio en curso (necesario para el corte con saldo 0).
    const currentFY = await getCurrentFiscalYear(companyId);
    if (!currentFY) {
      throw new Error(
        'No hay un ejercicio fiscal en curso. Configure el ejercicio fiscal antes de deshabilitar cuentas.'
      );
    }

    // Todas las cuentas de la empresa para recorrer el subárbol.
    // El recorrido (raíz primero + descendientes) vive en `collectSubtreeIds`,
    // el mismo helper puro que usa la cascada de Bien de Uso (TSK-618). Mismo
    // algoritmo y mismo orden que el DFS que estaba inline acá.
    const allAccounts = await prisma.account.findMany({
      where: { companyId },
      select: { id: true, parentId: true },
    });
    const affectedAccountIds = collectSubtreeIds(allAccounts, accountId);

    // Saldos con roll-up (cubre hojas y sumatorias) — ya en number.
    const rollup = await getAccountRollupBalances(companyId);

    // ¿Se necesita el próximo ejercicio? (alguna cuenta con saldo != 0).
    const needsNext = affectedAccountIds.some(
      (id) => Math.abs(rollup.get(id)?.balance ?? 0) > 0.001
    );

    let nextFY: Awaited<ReturnType<typeof getNextFiscalYear>> = null;
    if (needsNext) {
      nextFY = await getNextFiscalYear(companyId, currentFY);
      if (!nextFY) {
        throw new Error(
          'Hay cuentas con saldo que deben deshabilitarse en el próximo ejercicio, pero no existe. Cree el próximo ejercicio fiscal.'
        );
      }
    }

    const cutInCurrentFiscalYear: Array<{ accountId: string; balance: number }> = [];
    const cutInNextFiscalYear: Array<{ accountId: string; balance: number }> = [];

    await prisma.$transaction(async (tx) => {
      for (const id of affectedAccountIds) {
        const balance = rollup.get(id)?.balance ?? 0;
        const isZero = Math.abs(balance) <= 0.001;

        const cutFY = isZero ? currentFY : nextFY!;
        await tx.account.update({
          where: { id },
          data: {
            disabledFrom: cutFY.startDate,
            disabledFromFiscalYearId: cutFY.id,
          },
        });

        if (isZero) {
          cutInCurrentFiscalYear.push({ accountId: id, balance });
        } else {
          cutInNextFiscalYear.push({ accountId: id, balance });
        }
      }
    });

    logger.info('Cuenta(s) deshabilitada(s) por ejercicio', {
      data: {
        accountId,
        userId,
        affected: affectedAccountIds.length,
        current: cutInCurrentFiscalYear.length,
        next: cutInNextFiscalYear.length,
      },
    });
    revalidateAccountingRoutes(companyId);

    return {
      accountId,
      affectedAccountIds,
      cutInCurrentFiscalYear,
      cutInNextFiscalYear,
      currentFiscalYear: {
        id: currentFY.id,
        number: currentFY.number,
        startDate: currentFY.startDate,
      },
      nextFiscalYear: nextFY
        ? { id: nextFY.id, number: nextFY.number, startDate: nextFY.startDate }
        : null,
    };
  } catch (error) {
    logger.error('Error al deshabilitar cuenta', { data: { error, accountId, userId } });
    throw error;
  }
}

/**
 * Carga el Plan de Cuentas Modelo (Ticket #382) en una empresa que aún no tiene
 * cuentas. Crea el árbol completo (277 cuentas) en una transacción, derivando el
 * padre de cada cuenta a partir de su código. Idempotente por diseño: solo se
 * permite cuando la empresa no tiene ninguna cuenta.
 */
export async function loadModelChartOfAccounts(companyId: string): Promise<{ created: number }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.accounts', 'create', { redirect: true });

  const EMPTY_ONLY_ERROR =
    'El plan de cuentas modelo solo puede cargarse cuando la empresa no tiene cuentas.';

  try {
    const existingCount = await prisma.account.count({ where: { companyId } });
    if (existingCount > 0) {
      throw new Error(EMPTY_ONLY_ERROR);
    }

    // Pre-generar los ids para poder enlazar padres sin round-trips a la base.
    const idByCode = new Map<string, string>();
    for (const account of MODEL_CHART_OF_ACCOUNTS) {
      idByCode.set(account.code, randomUUID());
    }

    // Ordenar por código ascendente => los padres se insertan antes que las hijas.
    const data = MODEL_CHART_OF_ACCOUNTS.map((account) => {
      const parentCode = getParentCode(account.code);
      const parentId = parentCode ? idByCode.get(parentCode) ?? null : null;
      return {
        id: idByCode.get(account.code)!,
        companyId,
        code: account.code,
        name: account.name,
        type: account.type,
        nature: natureForType(account.type),
        isLeaf: account.isLeaf,
        parentId,
        // TSK-618: el rubro Bienes de Uso (1.2.2) nace marcado, para que una
        // empresa nueva tenga la sugerencia de adjunto funcionando sin
        // configurar nada. Sigue siendo editable desde el ABM.
        isFixedAsset: isModelFixedAssetCode(account.code),
      };
    }).sort((a, b) => a.code.localeCompare(b.code));

    const result = await prisma.$transaction(
      async (tx) => {
        // Recheck dentro de la transacción para evitar carreras.
        const count = await tx.account.count({ where: { companyId } });
        if (count > 0) {
          throw new Error(EMPTY_ONLY_ERROR);
        }
        return tx.account.createMany({ data });
      },
      { timeout: 30000, maxWait: 10000 }
    );

    logger.info('Plan de cuentas modelo cargado', {
      data: { companyId, userId, created: result.count },
    });
    revalidateAccountingRoutes(companyId);

    return { created: result.count };
  } catch (error) {
    logger.error('Error al cargar plan de cuentas modelo', { data: { error, companyId, userId } });
    throw error;
  }
}
