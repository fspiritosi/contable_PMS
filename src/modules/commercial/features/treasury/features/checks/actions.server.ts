'use server';

import { auth } from '@clerk/nextjs/server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  parseSearchParams,
  stateToPrismaParams,
  buildFiltersWhere,
  buildDateRangeFiltersWhere,
} from '@/shared/components/common/DataTable/helpers';
import type { CreateCheckFormData, DepositCheckFormData, EndorseCheckFormData } from '../../shared/validators';
import type { CheckListItem, CheckWithDetails } from '../../shared/types';
import { checkPermission } from '@/shared/lib/permissions';

// ============================================
// CONSULTAS
// ============================================

export async function getChecksPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.treasury.checks', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(parsed);

    const filtersWhere = buildFiltersWhere(parsed.filters, {
      status: 'status',
      type: 'type',
    }, { exclude: ['issueDate', 'dueDate', 'checkNumber', 'bankName', 'drawerName'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(parsed.filters, ['issueDate', 'dueDate']);

    // Filtros de texto
    const textFields = ['checkNumber', 'bankName', 'drawerName'] as const;
    const textWhere = textFields.reduce<Record<string, unknown>>((acc, field) => {
      const val = parsed.filters[field]?.[0];
      if (val) acc[field] = { contains: val, mode: 'insensitive' as const };
      return acc;
    }, {});

    const where = {
      companyId,
      ...filtersWhere,
      ...dateFiltersWhere,
      ...textWhere,
    };

    const [checks, totalRows] = await Promise.all([
      prisma.check.findMany({
        where,
        select: {
          id: true,
          type: true,
          status: true,
          checkNumber: true,
          bankName: true,
          amount: true,
          issueDate: true,
          dueDate: true,
          drawerName: true,
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, businessName: true } },
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
        },
        orderBy: orderBy || { dueDate: 'asc' },
        skip,
        take,
      }),
      prisma.check.count({ where }),
    ]);

    const data: CheckListItem[] = checks.map((c) => ({
      id: c.id,
      type: c.type,
      status: c.status,
      checkNumber: c.checkNumber,
      bankName: c.bankName,
      amount: Number(c.amount),
      issueDate: c.issueDate,
      dueDate: c.dueDate,
      drawerName: c.drawerName,
      customer: c.customer,
      supplier: c.supplier,
      bankAccount: c.bankAccount,
    }));

    return { data, totalRows };
  } catch (error) {
    logger.error('Error al obtener cheques', { data: { error, companyId } });
    throw new Error('Error al obtener cheques');
  }
}

export async function getCheckById(id: string): Promise<CheckWithDetails | null> {
  await checkPermission('commercial.treasury.checks', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        type: true,
        status: true,
        checkNumber: true,
        bankName: true,
        branch: true,
        accountNumber: true,
        amount: true,
        issueDate: true,
        dueDate: true,
        drawerName: true,
        drawerTaxId: true,
        payeeName: true,
        endorsedToName: true,
        endorsedToTaxId: true,
        endorsedAt: true,
        rejectedAt: true,
        rejectionReason: true,
        clearedAt: true,
        depositedAt: true,
        notes: true,
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, businessName: true } },
        bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
      },
    });

    if (!check) return null;

    return {
      ...check,
      amount: Number(check.amount),
    };
  } catch (error) {
    logger.error('Error al obtener cheque', { data: { error, companyId, id } });
    throw new Error('Error al obtener cheque');
  }
}

// ============================================
// CONTEOS FACETADOS
// ============================================

/**
 * Obtiene conteos globales para filtros facetados (server-side)
 */
export async function getCheckFacetCounts() {
  await checkPermission('commercial.treasury.checks', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [statusCounts, typeCounts] = await Promise.all([
    prisma.check.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { status: true },
    }),
    prisma.check.groupBy({
      by: ['type'],
      where: { companyId },
      _count: { type: true },
    }),
  ]);

  return {
    status: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.status])),
    type: Object.fromEntries(typeCounts.map((t) => [t.type, t._count.type])),
  };
}

// ============================================
// CREAR CHEQUE MANUAL
// ============================================

export async function createCheck(data: CreateCheckFormData) {
  await checkPermission('commercial.treasury.checks', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.create({
      data: {
        companyId,
        type: data.type,
        status: data.type === 'THIRD_PARTY' ? 'PORTFOLIO' : 'DELIVERED',
        checkNumber: data.checkNumber,
        bankName: data.bankName,
        branch: data.branch || null,
        accountNumber: data.accountNumber || null,
        amount: parseFloat(data.amount),
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        drawerName: data.drawerName,
        drawerTaxId: data.drawerTaxId || null,
        payeeName: data.payeeName || null,
        customerId: data.customerId || null,
        supplierId: data.supplierId || null,
        notes: data.notes || null,
        createdBy: userId,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/checks');
    return { success: true, id: check.id };
  } catch (error) {
    logger.error('Error al crear cheque', { data: { error, companyId } });
    throw new Error('Error al crear cheque');
  }
}

// ============================================
// DEPOSITAR CHEQUE (PORTFOLIO → DEPOSITED)
// ============================================

export async function depositCheck(data: DepositCheckFormData) {
  await checkPermission('commercial.treasury.checks', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.findFirst({
      where: { id: data.checkId, companyId },
    });

    if (!check) throw new Error('Cheque no encontrado');
    if (check.status !== 'PORTFOLIO') throw new Error('Solo se pueden depositar cheques en cartera');

    await prisma.$transaction(async (tx) => {
      // Crear movimiento bancario tipo CHECK
      const bankMovement = await tx.bankMovement.create({
        data: {
          bankAccountId: data.bankAccountId,
          companyId,
          type: 'CHECK',
          amount: check.amount,
          date: data.depositDate,
          description: `Depósito cheque N° ${check.checkNumber} - ${check.drawerName}`,
          reference: check.checkNumber,
          reconciled: false,
          createdBy: userId,
        },
      });

      // Actualizar saldo de la cuenta bancaria (cheque deposita = ingreso)
      await tx.bankAccount.update({
        where: { id: data.bankAccountId },
        data: { balance: { increment: check.amount } },
      });

      // Actualizar cheque
      await tx.check.update({
        where: { id: check.id },
        data: {
          status: 'DEPOSITED',
          bankAccountId: data.bankAccountId,
          bankMovementId: bankMovement.id,
          depositedAt: data.depositDate,
        },
      });
    });

    revalidatePath('/dashboard/commercial/treasury/checks');
    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    return { success: true };
  } catch (error) {
    logger.error('Error al depositar cheque', { data: { error, companyId } });
    throw new Error(error instanceof Error ? error.message : 'Error al depositar cheque');
  }
}

// ============================================
// ACREDITAR CHEQUE (DEPOSITED → CLEARED)
// ============================================

export async function clearCheck(checkId: string) {
  await checkPermission('commercial.treasury.checks', 'approve', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.findFirst({
      where: { id: checkId, companyId },
    });

    if (!check) throw new Error('Cheque no encontrado');
    if (check.status !== 'DEPOSITED') throw new Error('Solo se pueden acreditar cheques depositados');
    if (!check.bankAccountId) throw new Error('Cheque sin cuenta bancaria asociada');

    await prisma.$transaction(async (tx) => {
      // Marcar movimiento bancario como conciliado (el balance se recalcula dinámicamente)
      if (check.bankMovementId) {
        await tx.bankMovement.update({
          where: { id: check.bankMovementId },
          data: {
            reconciled: true,
            reconciledAt: new Date(),
            reconciledBy: userId,
          },
        });
      }

      // Actualizar cheque
      await tx.check.update({
        where: { id: check.id },
        data: {
          status: 'CLEARED',
          clearedAt: new Date(),
        },
      });
    });

    revalidatePath('/dashboard/commercial/treasury/checks');
    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    return { success: true };
  } catch (error) {
    logger.error('Error al acreditar cheque', { data: { error, companyId } });
    throw new Error(error instanceof Error ? error.message : 'Error al acreditar cheque');
  }
}

// ============================================
// RECHAZAR CHEQUE (DEPOSITED → REJECTED)
// ============================================

export async function rejectCheck(checkId: string, reason: string) {
  await checkPermission('commercial.treasury.checks', 'approve', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.findFirst({
      where: { id: checkId, companyId },
    });

    if (!check) throw new Error('Cheque no encontrado');
    if (check.status !== 'DEPOSITED') throw new Error('Solo se pueden rechazar cheques depositados');

    await prisma.$transaction(async (tx) => {
      // Eliminar movimiento bancario asociado
      if (check.bankMovementId) {
        await tx.bankMovement.delete({
          where: { id: check.bankMovementId },
        });
      }

      // Actualizar cheque
      await tx.check.update({
        where: { id: check.id },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectionReason: reason,
          bankMovementId: null,
        },
      });
    });

    revalidatePath('/dashboard/commercial/treasury/checks');
    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    return { success: true };
  } catch (error) {
    logger.error('Error al rechazar cheque', { data: { error, companyId } });
    throw new Error(error instanceof Error ? error.message : 'Error al rechazar cheque');
  }
}

// ============================================
// ENDOSAR CHEQUE (PORTFOLIO → ENDORSED)
// ============================================

export async function endorseCheck(data: EndorseCheckFormData) {
  await checkPermission('commercial.treasury.checks', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.findFirst({
      where: { id: data.checkId, companyId },
    });

    if (!check) throw new Error('Cheque no encontrado');
    if (check.status !== 'PORTFOLIO') throw new Error('Solo se pueden endosar cheques en cartera');

    await prisma.check.update({
      where: { id: check.id },
      data: {
        status: 'ENDORSED',
        endorsedToName: data.endorsedToName,
        endorsedToTaxId: data.endorsedToTaxId || null,
        supplierId: data.supplierId || null,
        endorsedAt: data.endorsedDate,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/checks');
    return { success: true };
  } catch (error) {
    logger.error('Error al endosar cheque', { data: { error, companyId } });
    throw new Error(error instanceof Error ? error.message : 'Error al endosar cheque');
  }
}

// ============================================
// ANULAR CHEQUE (→ VOIDED)
// ============================================

export async function voidCheck(checkId: string) {
  await checkPermission('commercial.treasury.checks', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.findFirst({
      where: { id: checkId, companyId },
    });

    if (!check) throw new Error('Cheque no encontrado');
    if (['CLEARED', 'CASHED', 'VOIDED'].includes(check.status)) {
      throw new Error('No se puede anular un cheque acreditado, cobrado o ya anulado');
    }

    await prisma.$transaction(async (tx) => {
      // Si estaba depositado, eliminar movimiento bancario
      if (check.status === 'DEPOSITED' && check.bankMovementId) {
        await tx.bankMovement.delete({
          where: { id: check.bankMovementId },
        });
      }

      await tx.check.update({
        where: { id: check.id },
        data: {
          status: 'VOIDED',
          bankMovementId: null,
        },
      });
    });

    revalidatePath('/dashboard/commercial/treasury/checks');
    return { success: true };
  } catch (error) {
    logger.error('Error al anular cheque', { data: { error, companyId } });
    throw new Error(error instanceof Error ? error.message : 'Error al anular cheque');
  }
}

// ============================================
// ELIMINAR CHEQUE (solo PORTFOLIO/DELIVERED)
// ============================================

export async function deleteCheck(checkId: string) {
  await checkPermission('commercial.treasury.checks', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.findFirst({
      where: { id: checkId, companyId },
    });

    if (!check) throw new Error('Cheque no encontrado');
    if (!['PORTFOLIO', 'DELIVERED'].includes(check.status)) {
      throw new Error('Solo se pueden eliminar cheques en cartera o entregados sin operaciones');
    }

    await prisma.check.delete({ where: { id: check.id } });

    revalidatePath('/dashboard/commercial/treasury/checks');
    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar cheque', { data: { error, companyId } });
    throw new Error(error instanceof Error ? error.message : 'Error al eliminar cheque');
  }
}

// ============================================
// HELPERS PARA CUENTAS BANCARIAS
// ============================================

export async function getActiveBankAccounts() {
  await checkPermission('commercial.treasury.checks', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        balance: true,
      },
      orderBy: { bankName: 'asc' },
    });

    return accounts.map((a) => ({
      ...a,
      balance: Number(a.balance),
    }));
  } catch (error) {
    logger.error('Error al obtener cuentas bancarias', { data: { error, companyId } });
    return [];
  }
}

// ============================================
// HELPERS PARA CASHFLOW
// ============================================

export async function getChecksForCashflow(startDate: Date, endDate: Date) {
  await checkPermission('commercial.treasury.checks', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const checks = await prisma.check.findMany({
      where: {
        companyId,
        dueDate: { gte: startDate, lte: endDate },
        status: { in: ['PORTFOLIO', 'DEPOSITED', 'DELIVERED'] },
      },
      select: {
        id: true,
        type: true,
        status: true,
        amount: true,
        dueDate: true,
        checkNumber: true,
        drawerName: true,
      },
    });

    return checks.map((c) => ({
      ...c,
      amount: Number(c.amount),
    }));
  } catch (error) {
    logger.error('Error al obtener cheques para cashflow', { data: { error, companyId } });
    throw new Error('Error al obtener cheques para cashflow');
  }
}
