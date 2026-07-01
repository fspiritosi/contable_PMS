'use server';

import moment from 'moment';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { revalidateAccountingRoutes } from '../../shared/utils';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';

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
    expensesAccountId?: string | null;
    resultAccountId?: string | null;
    withholdingIvaEmittedAccountId?: string | null;
    withholdingGananciasEmittedAccountId?: string | null;
    withholdingIibbEmittedAccountId?: string | null;
    withholdingSussEmittedAccountId?: string | null;
    withholdingIvaSufferedAccountId?: string | null;
    withholdingGananciasSufferedAccountId?: string | null;
    withholdingIibbSufferedAccountId?: string | null;
    withholdingSussSufferedAccountId?: string | null;
    // Cuentas de Activos Fijos
    fixedAssetAccountId?: string | null;
    accumulatedDepreciationAccountId?: string | null;
    depreciationExpenseAccountId?: string | null;
    assetDisposalGainLossAccountId?: string | null;
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
 * Obtiene la información de bloqueo de períodos contables
 */
export async function getLockedPeriod(companyId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.settings', 'view', { redirect: true });

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: {
        lockedUntilDate: true,
        fiscalYearStart: true,
        fiscalYearEnd: true,
      },
    });

    if (!settings) return null;

    return {
      lockedUntilDate: settings.lockedUntilDate,
      fiscalYearStart: settings.fiscalYearStart,
      fiscalYearEnd: settings.fiscalYearEnd,
    };
  } catch (error) {
    logger.error('Error al obtener período bloqueado', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Bloquea o desbloquea períodos contables hasta una fecha determinada.
 * La fecha debe ser el último día de un mes dentro del ejercicio fiscal.
 * Pasar null para desbloquear todos los períodos.
 */
export async function setLockedPeriod(companyId: string, lockedUntilDate: Date | null) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.settings', 'update', { redirect: true });

  try {
    if (lockedUntilDate) {
      const settings = await prisma.accountingSettings.findUnique({
        where: { companyId },
        select: { fiscalYearStart: true, fiscalYearEnd: true },
      });

      if (!settings) {
        throw new Error('No se encontró configuración contable');
      }

      const lockDate = moment(lockedUntilDate);
      const fiscalStart = moment(settings.fiscalYearStart);
      const fiscalEnd = moment(settings.fiscalYearEnd);

      // Validar que la fecha esté dentro del ejercicio fiscal
      if (!lockDate.isBetween(fiscalStart, fiscalEnd, 'day', '[]')) {
        throw new Error('La fecha de bloqueo debe estar dentro del ejercicio fiscal');
      }

      // Validar que sea fin de mes
      if (!lockDate.isSame(lockDate.clone().endOf('month'), 'day')) {
        throw new Error('La fecha de bloqueo debe ser el último día de un mes');
      }
    }

    await prisma.accountingSettings.update({
      where: { companyId },
      data: { lockedUntilDate },
    });

    logger.info('Período contable actualizado', {
      data: {
        companyId,
        userId,
        lockedUntilDate: lockedUntilDate ? moment(lockedUntilDate).format('DD/MM/YYYY') : null,
      },
    });

    revalidateAccountingRoutes(companyId);
  } catch (error) {
    logger.error('Error al actualizar período bloqueado', { data: { error, companyId, userId } });
    throw error;
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
