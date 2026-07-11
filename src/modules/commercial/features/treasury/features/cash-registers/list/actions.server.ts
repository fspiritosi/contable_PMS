'use server';

import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import type { CashRegisterWithActiveSession } from '../../../shared/types';
import { checkPermission } from '@/shared/lib/permissions';

interface GetCashRegistersParams {
  includeInactive?: boolean;
}

/**
 * Cuentas contables de activo disponibles para asociar a una caja.
 */
export async function getAvailableAccountsForCashRegister() {
  await checkPermission('commercial.treasury.cash-registers', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.account.findMany({
    where: { companyId, isActive: true, type: 'ASSET' },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
}

/**
 * Obtiene la lista de cajas de la empresa activa
 */
export async function getCashRegisters(
  params: GetCashRegistersParams = {}
): Promise<CashRegisterWithActiveSession[]> {
  const { includeInactive = false } = params;
  await checkPermission('commercial.treasury.cash-registers', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const where = {
      companyId,
      ...(!includeInactive && { status: 'ACTIVE' as const }),
    };

    const cashRegisters = await prisma.cashRegister.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        location: true,
        status: true,
        isDefault: true,
        accountId: true,
        createdAt: true,
        updatedAt: true,
        sessions: {
          where: { status: 'OPEN' },
          select: {
            id: true,
            sessionNumber: true,
            status: true,
            openedAt: true,
            openingBalance: true,
            expectedBalance: true,
            openedBy: true,
          },
          take: 1,
        },
      },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
    });

    // Transformar resultado para incluir activeSession
    return cashRegisters.map((register) => ({
      ...register,
      openingBalance: Number(register.sessions[0]?.openingBalance ?? 0),
      expectedBalance: Number(register.sessions[0]?.expectedBalance ?? 0),
      activeSession: register.sessions[0]
        ? {
            ...register.sessions[0],
            openingBalance: Number(register.sessions[0].openingBalance),
            expectedBalance: Number(register.sessions[0].expectedBalance),
          }
        : null,
      sessions: undefined,
    })) as CashRegisterWithActiveSession[];
  } catch (error) {
    logger.error('Error al obtener cajas', { data: { error } });
    throw new Error('Error al obtener cajas');
  }
}

/**
 * Obtiene el detalle de una caja específica
 */
export async function getCashRegister(id: string) {
  await checkPermission('commercial.treasury.cash-registers', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const cashRegister = await prisma.cashRegister.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        code: true,
        name: true,
        location: true,
        status: true,
        isDefault: true,
        accountId: true,
        createdAt: true,
        updatedAt: true,
        sessions: {
          where: { status: 'OPEN' },
          select: {
            id: true,
            sessionNumber: true,
            status: true,
            openedAt: true,
            openingBalance: true,
            expectedBalance: true,
            openedBy: true,
          },
          take: 1,
        },
      },
    });

    if (!cashRegister) {
      throw new Error('Caja no encontrada');
    }

    return {
      ...cashRegister,
      activeSession: cashRegister.sessions[0]
        ? {
            ...cashRegister.sessions[0],
            openingBalance: Number(cashRegister.sessions[0].openingBalance),
            expectedBalance: Number(cashRegister.sessions[0].expectedBalance),
          }
        : null,
    };
  } catch (error) {
    logger.error('Error al obtener caja', { data: { error, id } });
    throw new Error('Error al obtener caja');
  }
}

/**
 * Verifica si existe una caja con el código especificado
 */
export async function checkCashRegisterCodeExists(code: string, excludeId?: string): Promise<boolean> {
  await checkPermission('commercial.treasury.cash-registers', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.cashRegister.findFirst({
      where: {
        companyId,
        code,
        ...(excludeId && { id: { not: excludeId } }),
      },
      select: { id: true },
    });

    return !!existing;
  } catch (error) {
    logger.error('Error al verificar código de caja', { data: { error, code } });
    return false;
  }
}
