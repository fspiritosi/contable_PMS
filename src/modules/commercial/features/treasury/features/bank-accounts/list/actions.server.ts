'use server';

import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import { checkPermission } from '@/shared/lib/permissions';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  buildFiltersWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import type { BankAccountWithBalance } from '../../../shared/types';

interface GetBankAccountsParams {
  includeInactive?: boolean;
}

/**
 * Obtiene la lista de cuentas bancarias de la empresa activa
 */
export async function getBankAccounts(
  params: GetBankAccountsParams = {}
): Promise<BankAccountWithBalance[]> {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const { includeInactive = false } = params;
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const where = {
      companyId,
      ...(!includeInactive && { status: 'ACTIVE' as const }),
    };

    const bankAccounts = await prisma.bankAccount.findMany({
      where,
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        accountType: true,
        cbu: true,
        alias: true,
        currency: true,
        balance: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            movements: true,
          },
        },
      },
      orderBy: [{ bankName: 'asc' }, { accountNumber: 'asc' }],
    });

    return bankAccounts.map((account) => ({
      ...account,
      balance: Number(account.balance),
    })) as BankAccountWithBalance[];
  } catch (error) {
    logger.error('Error al obtener cuentas bancarias', { data: { error } });
    throw new Error('Error al obtener cuentas bancarias');
  }
}

/**
 * Obtiene cuentas bancarias con paginación server-side para DataTable
 */
export async function getBankAccountsPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    const filtersWhere = buildFiltersWhere(state.filters, {
      status: 'status',
      accountType: 'accountType',
      currency: 'currency',
    }, { exclude: ['bankName', 'accountNumber', 'cbu'] });

    // Filtros de texto
    const textFields = ['bankName', 'accountNumber', 'cbu'] as const;
    const textWhere = textFields.reduce<Record<string, unknown>>((acc, field) => {
      const val = state.filters[field]?.[0];
      if (val) acc[field] = { contains: val, mode: 'insensitive' as const };
      return acc;
    }, {});

    const where = {
      companyId,
      ...filtersWhere,
      ...textWhere,
    };

    const [bankAccounts, total] = await Promise.all([
      prisma.bankAccount.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || [{ bankName: 'asc' }, { accountNumber: 'asc' }],
        select: {
          id: true,
          bankName: true,
          accountNumber: true,
          accountType: true,
          cbu: true,
          alias: true,
          currency: true,
          balance: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              movements: true,
            },
          },
        },
      }),
      prisma.bankAccount.count({ where }),
    ]);

    const data = bankAccounts.map((account) => ({
      ...account,
      balance: Number(account.balance),
    })) as BankAccountWithBalance[];

    return { data, total };
  } catch (error) {
    logger.error('Error al obtener cuentas bancarias paginadas', { data: { error } });
    throw new Error('Error al obtener cuentas bancarias');
  }
}

/**
 * Obtiene el detalle de una cuenta bancaria específica
 */
export async function getBankAccount(id: string) {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        accountType: true,
        cbu: true,
        alias: true,
        currency: true,
        balance: true,
        status: true,
        accountId: true,
        createdAt: true,
        updatedAt: true,
        account: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    if (!bankAccount) {
      throw new Error('Cuenta bancaria no encontrada');
    }

    return {
      ...bankAccount,
      balance: Number(bankAccount.balance),
    };
  } catch (error) {
    logger.error('Error al obtener cuenta bancaria', { data: { error, id } });
    throw new Error('Error al obtener cuenta bancaria');
  }
}

/**
 * Verifica si existe una cuenta con el número especificado
 */
export async function checkAccountNumberExists(accountNumber: string, excludeId?: string): Promise<boolean> {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.bankAccount.findFirst({
      where: {
        companyId,
        accountNumber,
        ...(excludeId && { id: { not: excludeId } }),
      },
      select: { id: true },
    });

    return !!existing;
  } catch (error) {
    logger.error('Error al verificar número de cuenta', { data: { error, accountNumber } });
    return false;
  }
}

/**
 * Obtiene conteos globales para filtros facetados (server-side)
 */
export async function getBankAccountFacetCounts() {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [statusCounts, accountTypeCounts] = await Promise.all([
    prisma.bankAccount.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { status: true },
    }),
    prisma.bankAccount.groupBy({
      by: ['accountType'],
      where: { companyId },
      _count: { accountType: true },
    }),
  ]);

  return {
    status: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.status])),
    accountType: Object.fromEntries(accountTypeCounts.map((a) => [a.accountType, a._count.accountType])),
  };
}

/**
 * Obtiene cuentas contables disponibles para vincular
 */
export async function getAvailableAccounts() {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const accounts = await prisma.account.findMany({
      where: {
        companyId,
        isActive: true,
        type: 'ASSET', // Solo cuentas de activo
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
      orderBy: { code: 'asc' },
    });

    return accounts;
  } catch (error) {
    logger.error('Error al obtener cuentas contables', { data: { error } });
    return [];
  }
}
