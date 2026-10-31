'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
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
import {
  debitCheckSchema,
  type CreateCheckFormData,
  type DebitCheckFormData,
  type DepositCheckFormData,
  type EndorseCheckFormData,
  type UpdateCheckFormData,
} from '../../shared/validators';
import type { CheckListItem, CheckWithDetails } from '../../shared/types';
import { checkPermission } from '@/shared/lib/permissions';
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { businessToday } from '@/shared/utils/date-input';
import { applyCheckEventTx } from '@/modules/commercial/shared/effects/check.server';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import type { Prisma } from '@/generated/prisma/client';

/** Resultado de las acciones del ciclo del cheque que generan asiento (TSK-735). */
type CheckEventResult = ActionResult<{ warnings: string[] }>;

// ============================================
// CONSULTAS
// ============================================

export async function getChecksPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.treasury.checks', 'view', { redirect: true });
  const userId = await getCurrentUserId();
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
  const userId = await getCurrentUserId();
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
        isElectronic: true,
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
  const userId = await getCurrentUserId();
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
// EDITAR CHEQUE (solo en cartera / PORTFOLIO)
// ============================================

export async function updateCheck(data: UpdateCheckFormData) {
  await checkPermission('commercial.treasury.checks', 'update', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.findFirst({
      where: { id: data.checkId, companyId },
      select: { id: true, status: true },
    });

    if (!check) throw new Error('Cheque no encontrado');
    // Solo se permite editar la metadata mientras el cheque sigue en cartera
    if (check.status !== 'PORTFOLIO') {
      throw new Error('Solo se pueden editar cheques en cartera');
    }

    await prisma.check.update({
      where: { id: check.id },
      data: {
        checkNumber: data.checkNumber,
        bankName: data.bankName,
        branch: data.branch || null,
        accountNumber: data.accountNumber || null,
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        drawerName: data.drawerName,
        drawerTaxId: data.drawerTaxId || null,
        payeeName: data.payeeName || null,
        notes: data.notes || null,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/checks');
    return { success: true };
  } catch (error) {
    logger.error('Error al editar cheque', { data: { error, companyId } });
    throw new Error(error instanceof Error ? error.message : 'Error al editar cheque');
  }
}

// ============================================
// DEPOSITAR CHEQUE (PORTFOLIO → DEPOSITED)
// ============================================

export async function depositCheck(data: DepositCheckFormData): Promise<CheckEventResult> {
  await checkPermission('commercial.treasury.checks', 'update', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.findFirst({
      where: { id: data.checkId, companyId },
    });

    if (!check) throw new BusinessError('Cheque no encontrado');
    if (check.status !== 'PORTFOLIO') {
      throw new BusinessError('Solo se pueden depositar cheques en cartera');
    }
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id: data.bankAccountId, companyId },
      select: { id: true },
    });
    if (!bankAccount) throw new BusinessError('Cuenta bancaria no encontrada');

    const { warnings } = await prisma.$transaction(async (tx) => {
      // Asiento Banco / cuenta del cheque (TSK-735): si falla, no se mueve nada.
      const entry = await applyCheckEventTx(
        tx,
        { companyId, userId },
        {
          checkId: check.id,
          event: 'DEPOSIT',
          date: data.depositDate,
          bankAccountId: data.bankAccountId,
        }
      );

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

      return entry;
    });

    revalidatePath('/dashboard/commercial/treasury/checks');
    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    return { success: true, warnings };
  } catch (error) {
    return toActionResult(error, 'Error al depositar cheque');
  }
}

// ============================================
// ACREDITAR CHEQUE (DEPOSITED → CLEARED)
// ============================================

export async function clearCheck(checkId: string) {
  await checkPermission('commercial.treasury.checks', 'approve', { redirect: true });
  const userId = await getCurrentUserId();
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

export async function rejectCheck(checkId: string, reason: string): Promise<CheckEventResult> {
  await checkPermission('commercial.treasury.checks', 'approve', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.findFirst({
      where: { id: checkId, companyId },
    });

    if (!check) throw new BusinessError('Cheque no encontrado');
    if (check.status !== 'DEPOSITED') {
      throw new BusinessError('Solo se pueden rechazar cheques depositados');
    }

    const today = businessToday();
    const { warnings } = await prisma.$transaction(async (tx) => {
      // Asiento Cheques rechazados / Banco (TSK-735), con fecha de hoy en Argentina.
      const entry = await applyCheckEventTx(
        tx,
        { companyId, userId },
        { checkId: check.id, event: 'REJECT', date: today }
      );

      await removeDepositMovementTx(tx, check);

      // Actualizar cheque
      await tx.check.update({
        where: { id: check.id },
        data: {
          status: 'REJECTED',
          rejectedAt: today,
          rejectionReason: reason,
          bankMovementId: null,
        },
      });

      return entry;
    });

    revalidatePath('/dashboard/commercial/treasury/checks');
    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    return { success: true, warnings };
  } catch (error) {
    return toActionResult(error, 'Error al rechazar cheque');
  }
}

/**
 * Deshace el movimiento bancario del depósito y su ingreso en el saldo (el depósito
 * lo sumó al saldo; borrar solo el movimiento lo dejaba inflado).
 */
async function removeDepositMovementTx(
  tx: Tx,
  check: { bankMovementId: string | null; bankAccountId: string | null; amount: Prisma.Decimal }
): Promise<void> {
  if (!check.bankMovementId) return;
  await tx.bankMovement.delete({ where: { id: check.bankMovementId } });
  if (check.bankAccountId) {
    await tx.bankAccount.update({
      where: { id: check.bankAccountId },
      data: { balance: { decrement: check.amount } },
    });
  }
}

// ============================================
// DEBITAR CHEQUE PROPIO (DELIVERED → CASHED)
// ============================================

/**
 * El banco debitó un cheque propio entregado (TSK-735): egreso bancario como el
 * pago bancario de una OP (WITHDRAWAL, resta el saldo) y asiento cuenta del cheque /
 * Banco. El e-cheq propio ya fue al banco en el asiento de la OP pero no en el saldo
 * (la OP no crea movimiento para el e-cheq): el egreso se registra igual, sin asiento.
 */
export async function debitCheck(data: DebitCheckFormData): Promise<CheckEventResult> {
  await checkPermission('commercial.treasury.checks', 'approve', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = debitCheckSchema.safeParse(data);
    if (!parsed.success) throw new BusinessError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
    const { checkId, date, bankAccountId } = parsed.data;

    const check = await prisma.check.findFirst({
      where: { id: checkId, companyId },
      select: { id: true, type: true, status: true, amount: true, checkNumber: true },
    });
    if (!check) throw new BusinessError('Cheque no encontrado');
    if (check.type !== 'OWN' || check.status !== 'DELIVERED') {
      throw new BusinessError('Solo se pueden debitar cheques propios entregados');
    }
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId },
      select: { id: true },
    });
    if (!bankAccount) throw new BusinessError('Cuenta bancaria no encontrada');

    const { warnings } = await prisma.$transaction(async (tx) => {
      const entry = await applyCheckEventTx(
        tx,
        { companyId, userId },
        { checkId: check.id, event: 'DEBIT', date, bankAccountId }
      );

      const bankMovement = await tx.bankMovement.create({
        data: {
          companyId,
          bankAccountId,
          type: 'WITHDRAWAL',
          amount: check.amount,
          date,
          description: `Débito cheque N° ${check.checkNumber}`,
          reference: check.checkNumber,
          reconciled: true,
          reconciledAt: new Date(),
          reconciledBy: userId,
          createdBy: userId,
        },
      });
      await tx.bankAccount.update({
        where: { id: bankAccountId },
        data: { balance: { decrement: check.amount } },
      });

      await tx.check.update({
        where: { id: check.id },
        data: {
          status: 'CASHED',
          bankAccountId,
          bankMovementId: bankMovement.id,
          clearedAt: date,
        },
      });

      return entry;
    });

    revalidatePath('/dashboard/commercial/treasury/checks');
    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    return { success: true, warnings };
  } catch (error) {
    return toActionResult(error, 'Error al debitar cheque');
  }
}

// ============================================
// ENDOSAR CHEQUE (PORTFOLIO → ENDORSED)
// ============================================

export async function endorseCheck(data: EndorseCheckFormData) {
  await checkPermission('commercial.treasury.checks', 'update', { redirect: true });
  const userId = await getCurrentUserId();
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

export async function voidCheck(checkId: string): Promise<CheckEventResult> {
  await checkPermission('commercial.treasury.checks', 'delete', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const check = await prisma.check.findFirst({
      where: { id: checkId, companyId },
    });

    if (!check) throw new BusinessError('Cheque no encontrado');
    if (['CLEARED', 'CASHED', 'VOIDED'].includes(check.status)) {
      throw new BusinessError('No se puede anular un cheque acreditado, cobrado o ya anulado');
    }

    const { warnings } = await prisma.$transaction(async (tx) => {
      // Asiento de anulación (TSK-735); un depositado revierte antes el del depósito.
      // Va antes del cambio de estado: la regla depende del estado previo.
      const entry = await applyCheckEventTx(
        tx,
        { companyId, userId },
        { checkId: check.id, event: 'VOID', date: businessToday() }
      );

      // Si estaba depositado, deshacer el movimiento bancario y el saldo
      if (check.status === 'DEPOSITED') {
        await removeDepositMovementTx(tx, check);
      }

      await tx.check.update({
        where: { id: check.id },
        data: {
          status: 'VOIDED',
          bankMovementId: null,
        },
      });

      return entry;
    });

    revalidatePath('/dashboard/commercial/treasury/checks');
    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    return { success: true, warnings };
  } catch (error) {
    return toActionResult(error, 'Error al anular cheque');
  }
}

// ============================================
// ELIMINAR CHEQUE (solo PORTFOLIO/DELIVERED)
// ============================================

export async function deleteCheck(checkId: string) {
  await checkPermission('commercial.treasury.checks', 'delete', { redirect: true });
  const userId = await getCurrentUserId();
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
  const userId = await getCurrentUserId();
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
  const userId = await getCurrentUserId();
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
