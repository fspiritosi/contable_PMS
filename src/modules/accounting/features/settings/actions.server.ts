'use server';

import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { getActiveCompanyId } from '@/shared/lib/company';
import { revalidateAccountingRoutes } from '../../shared/utils';
import type { IsoDay, YearMonth } from '../../shared/utils/journal-entry-types';
import { buildPeriodLockStatusTx, closeMonthTx, reopenMonthTx } from './period-closing';
import type { PeriodLockStatus } from './period-lock-common';

/**
 * Obtiene la configuración contable de una empresa
 */
export async function getAccountingSettings(companyId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.settings', 'view', { redirect: true });

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
    });

    return settings;
  } catch (error) {
    logger.error('Error al obtener configuración contable', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Crea o actualiza la configuración contable de una empresa
 */
export async function saveAccountingSettings(
  companyId: string,
  input: {
    fiscalYearStart: Date;
    fiscalYearEnd: Date;
    salesAccountId?: string | null;
    purchasesAccountId?: string | null;
    receivablesAccountId?: string | null;
    payablesAccountId?: string | null;
    vatDebitAccountId?: string | null;
    vatCreditAccountId?: string | null;
    defaultCashAccountId?: string | null;
    defaultBankAccountId?: string | null;
    bankChargesAccountId?: string | null; // TSK-718
    expensesAccountId?: string | null;
    resultAccountId?: string | null;
    partnerContributionsAccountId?: string | null;
    withholdingIvaEmittedAccountId?: string | null;
    withholdingGananciasEmittedAccountId?: string | null;
    withholdingIibbEmittedAccountId?: string | null;
    withholdingSussEmittedAccountId?: string | null;
    withholdingIvaSufferedAccountId?: string | null;
    withholdingGananciasSufferedAccountId?: string | null;
    withholdingIibbSufferedAccountId?: string | null;
    withholdingSussSufferedAccountId?: string | null;
    // Cuentas de Percepciones e Impuestos Internos (TSK-644)
    perceptionIvaCollectedAccountId?: string | null;
    perceptionIibbCollectedAccountId?: string | null;
    perceptionMunicipalCollectedAccountId?: string | null;
    perceptionIvaSufferedAccountId?: string | null;
    perceptionIibbSufferedAccountId?: string | null;
    perceptionMunicipalSufferedAccountId?: string | null;
    internalTaxesAccountId?: string | null;
    // Cuentas de Activos Fijos
    fixedAssetAccountId?: string | null;
    accumulatedDepreciationAccountId?: string | null;
    depreciationExpenseAccountId?: string | null;
    assetDisposalGainLossAccountId?: string | null;
    requireCostCenter?: boolean;
  }
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.settings', 'update', { redirect: true });

  try {
    // Validar que el ejercicio no sea mayor a un año
    const yearInMs = 366 * 24 * 60 * 60 * 1000; // 366 días para contemplar años bisiestos
    if (input.fiscalYearEnd.getTime() - input.fiscalYearStart.getTime() > yearInMs) {
      throw new Error('El ejercicio fiscal no puede ser mayor a un año');
    }

    // Validar que la fecha de fin sea posterior a la de inicio
    if (input.fiscalYearEnd <= input.fiscalYearStart) {
      throw new Error('La fecha de fin debe ser posterior a la fecha de inicio');
    }

    const settings = await prisma.accountingSettings.upsert({
      where: { companyId },
      create: {
        ...input,
        companyId,
      },
      update: input,
    });

    logger.info('Configuración contable guardada', { data: { companyId, userId } });
    revalidateAccountingRoutes(companyId);

    return settings;
  } catch (error) {
    logger.error('Error al guardar configuración contable', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Estado del panel "Bloqueo de Períodos" (TSK-760, Fase 8): meses del ejercicio abierto
 * más antiguo y del siguiente, con borradores y la acción disponible. `null` = sin Ajustes.
 */
export async function getPeriodLockStatus(): Promise<PeriodLockStatus | null> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.settings', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return buildPeriodLockStatusTx(prisma, companyId);
}

/**
 * Cierra un mes (A1, D2): solo el primer mes abierto; con borradores, `postDrafts`
 * los registra todos en la misma transacción o no cierra nada. Recalcula
 * `lockedUntilDate`. Recibe `{ year, month }` (B22).
 */
export async function closeAccountingPeriod(
  input: YearMonth & { postDrafts: boolean }
): Promise<ActionResult<{ lockedUntil: IsoDay; postedDrafts: number }>> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.settings', 'update', { redirect: true });
  if (input.postDrafts) await checkPermission('accounting.entries', 'approve', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const result = await prisma.$transaction(
      (tx) => closeMonthTx(tx, { ...input, companyId, userId }),
      { timeout: 30_000, maxWait: 10_000 } // H10: registrar N borradores puede pasar los 5 s
    );
    logger.info('Mes contable cerrado', { data: { companyId, userId, ...input, ...result } });
    revalidateAccountingRoutes(companyId);
    return { success: true, ...result };
  } catch (error) {
    return toActionResult(error, 'Error al cerrar el mes contable');
  }
}

/**
 * Reabre un mes (A1, B5): solo el último cerrado y nunca uno de un ejercicio cerrado.
 * Recalcula `lockedUntilDate` (piso: fin del último ejercicio cerrado).
 */
export async function reopenAccountingPeriod(
  input: YearMonth
): Promise<ActionResult<{ lockedUntil: IsoDay | null }>> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.settings', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const result = await prisma.$transaction((tx) => reopenMonthTx(tx, { ...input, companyId }));
    logger.info('Mes contable reabierto', { data: { companyId, userId, ...input, ...result } });
    revalidateAccountingRoutes(companyId);
    return { success: true, ...result };
  } catch (error) {
    return toActionResult(error, 'Error al reabrir el mes contable');
  }
}

/**
 * Obtiene todas las cuentas activas de la empresa para los selectores
 */
export async function getActiveAccounts(companyId: string, includeIds?: string[]) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.settings', 'view', { redirect: true });

  try {
    // Config contable: solo cuentas imputables (hojas). El formulario filtra
    // por tipo en cada campo. Se preservan los ids ya configurados (includeIds)
    // aunque hoy no cumplan el filtro, para no perder valores guardados.
    const imputableWhere = buildImputableAccountsWhere({ companyId });
    const where =
      includeIds && includeIds.length > 0
        ? { OR: [imputableWhere, { companyId, id: { in: includeIds } }] }
        : imputableWhere;

    const accounts = await prisma.account.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        nature: true,
      },
      orderBy: {
        code: 'asc',
      },
    });

    return accounts;
  } catch (error) {
    logger.error('Error al obtener cuentas', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Cuántos ítems ACTIVOS todavía caen en la "Cuenta de ventas/compras por
 * defecto" porque no tienen la suya (TSK-721). Se cuenta por `usage`: un ítem
 * solo de compra sin cuenta de ingresos no es un problema, y viceversa.
 *
 * Prisma directo sobre `product`, sin importar de `commercial` (regla
 * `module-communication.md`): los literales de `usage` se duplican a propósito
 * respecto de `products/shared/imputation-filter.ts` (el test de integración
 * `product-imputation-filter.integration.test.ts` los ata). No cubre las
 * líneas de compra sin ítem (formulario "Opcional", importación AFIP), que
 * siempre usan la cuenta por defecto.
 */
export async function getItemsWithoutAccountCounts(
  companyId: string
): Promise<{ saleItemsWithoutIncome: number; purchaseItemsWithoutExpense: number }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.settings', 'view', { redirect: true });

  const [saleItemsWithoutIncome, purchaseItemsWithoutExpense] = await Promise.all([
    prisma.product.count({
      where: {
        companyId,
        status: 'ACTIVE',
        usage: { in: ['SALE', 'PURCHASE_SALE'] },
        defaultIncomeAccountId: null,
      },
    }),
    prisma.product.count({
      where: {
        companyId,
        status: 'ACTIVE',
        usage: { in: ['PURCHASE', 'PURCHASE_SALE'] },
        defaultExpenseAccountId: null,
      },
    }),
  ]);

  return { saleItemsWithoutIncome, purchaseItemsWithoutExpense };
}

export type ItemsWithoutAccountCounts = Awaited<ReturnType<typeof getItemsWithoutAccountCounts>>;
