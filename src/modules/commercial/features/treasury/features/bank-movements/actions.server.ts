'use server';

import { auth } from '@clerk/nextjs/server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import { BankMovementType } from '@/generated/prisma/enums';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  parseSearchParams,
  stateToPrismaParams,
  buildFiltersWhere,
  buildDateRangeFiltersWhere,
} from '@/shared/components/common/DataTable/helpers';
import { bankMovementSchema, type BankMovementFormData } from '../../shared/validators';
import { checkPermission } from '@/shared/lib/permissions';

// Tipo para el cliente de transacción de Prisma
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Crea un nuevo movimiento bancario y genera asiento contable
 */
export async function createBankMovement(data: BankMovementFormData) {
  await checkPermission('commercial.treasury.bank-accounts', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Validar datos
    const validated = bankMovementSchema.parse(data);

    // Verificar que la cuenta bancaria existe y está activa
    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id: validated.bankAccountId,
        companyId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        balance: true,
        accountId: true,
      },
    });

    if (!bankAccount) {
      throw new Error('Cuenta bancaria no encontrada o inactiva');
    }

    // Verificar que la cuenta contable contrapartida existe
    const counterpartAccount = await prisma.account.findFirst({
      where: {
        id: validated.accountId,
        companyId,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    if (!counterpartAccount) {
      throw new Error('Cuenta contable no encontrada o inactiva');
    }

    const amount = new Prisma.Decimal(validated.amount);
    const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST'].includes(validated.type);

    // Crear movimiento, actualizar saldo y generar asiento en transacción
    const movement = await prisma.$transaction(async (tx) => {
      // Calcular nuevo saldo
      let newBalance = bankAccount.balance;

      if (isIncome) {
        newBalance = bankAccount.balance.add(amount);
      } else if (['WITHDRAWAL', 'TRANSFER_OUT', 'CHECK', 'DEBIT', 'FEE'].includes(validated.type)) {
        newBalance = bankAccount.balance.sub(amount);
      }

      // Crear movimiento
      const newMovement = await tx.bankMovement.create({
        data: {
          bankAccountId: validated.bankAccountId,
          companyId,
          type: validated.type,
          amount,
          date: validated.date,
          description: validated.description,
          reference: validated.reference || null,
          statementNumber: validated.statementNumber || null,
          createdBy: userId,
        },
      });

      // Actualizar saldo de la cuenta
      await tx.bankAccount.update({
        where: { id: validated.bankAccountId },
        data: { balance: newBalance },
      });

      // Generar asiento contable si la cuenta bancaria tiene cuenta contable vinculada
      if (bankAccount.accountId) {
        await createJournalEntryForBankMovement(
          {
            companyId,
            date: validated.date,
            description: validated.description,
            amount: parseFloat(validated.amount),
            isIncome,
            bankAccountId: bankAccount.accountId,
            counterpartAccountId: validated.accountId,
            bankName: bankAccount.bankName,
            accountNumber: bankAccount.accountNumber,
          },
          tx
        );
      }

      return newMovement;
    });

    logger.info('Movimiento bancario creado', {
      data: {
        movementId: movement.id,
        type: movement.type,
        amount: validated.amount,
        bankAccount: `${bankAccount.bankName} - ${bankAccount.accountNumber}`,
        counterpartAccount: `${counterpartAccount.code} - ${counterpartAccount.name}`,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return { success: true, id: movement.id };
  } catch (error) {
    logger.error('Error al crear movimiento bancario', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al crear movimiento bancario');
  }
}

/**
 * Genera asiento contable para un movimiento bancario manual
 */
async function createJournalEntryForBankMovement(
  input: {
    companyId: string;
    date: Date;
    description: string;
    amount: number;
    isIncome: boolean;
    bankAccountId: string;
    counterpartAccountId: string;
    bankName: string;
    accountNumber: string;
  },
  tx: PrismaTransactionClient
) {
  const { companyId, date, description, amount, isIncome, bankAccountId, counterpartAccountId, bankName, accountNumber } = input;

  // Obtener settings para el siguiente número de asiento
  const settings = await tx.accountingSettings.findUnique({
    where: { companyId },
    select: { lastEntryNumber: true },
  });

  if (!settings) {
    logger.warn('No se encontró configuración contable, no se generará asiento', {
      data: { companyId },
    });
    return;
  }

  const nextNumber = settings.lastEntryNumber + 1;
  const bankLabel = `${bankName} - ${accountNumber}`;

  // Crear asiento:
  // Ingreso (DEPOSIT, TRANSFER_IN, INTEREST):
  //   Debe: Cuenta bancaria (activo aumenta)
  //   Haber: Cuenta contrapartida
  // Egreso (WITHDRAWAL, TRANSFER_OUT, CHECK, DEBIT, FEE):
  //   Debe: Cuenta contrapartida
  //   Haber: Cuenta bancaria (activo disminuye)
  const entry = await tx.journalEntry.create({
    data: {
      companyId,
      number: nextNumber,
      date,
      description: `Mov. bancario - ${description} (${bankLabel})`,
      createdBy: 'system',
      lines: {
        create: isIncome
          ? [
              {
                accountId: bankAccountId,
                debit: new Prisma.Decimal(amount),
                credit: new Prisma.Decimal(0),
                description: `${bankLabel} - ${description}`,
              },
              {
                accountId: counterpartAccountId,
                debit: new Prisma.Decimal(0),
                credit: new Prisma.Decimal(amount),
                description: description,
              },
            ]
          : [
              {
                accountId: counterpartAccountId,
                debit: new Prisma.Decimal(amount),
                credit: new Prisma.Decimal(0),
                description: description,
              },
              {
                accountId: bankAccountId,
                debit: new Prisma.Decimal(0),
                credit: new Prisma.Decimal(amount),
                description: `${bankLabel} - ${description}`,
              },
            ],
      },
    },
  });

  // Actualizar el último número de asiento
  await tx.accountingSettings.update({
    where: { companyId },
    data: { lastEntryNumber: nextNumber },
  });

  logger.info('Asiento contable generado para movimiento bancario', {
    data: { entryId: entry.id, number: nextNumber },
  });
}

/**
 * Obtiene los movimientos de una cuenta bancaria
 */
export async function getBankAccountMovements(bankAccountId: string, limit = 50) {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const movements = await prisma.bankMovement.findMany({
      where: {
        bankAccountId,
        companyId,
      },
      select: {
        id: true,
        type: true,
        amount: true,
        date: true,
        description: true,
        reference: true,
        statementNumber: true,
        reconciled: true,
        reconciledAt: true,
        createdBy: true,
        createdAt: true,
      },
      orderBy: { date: 'desc' },
      take: limit,
    });

    return movements.map((m) => ({
      ...m,
      amount: Number(m.amount),
    }));
  } catch (error) {
    logger.error('Error al obtener movimientos bancarios', { data: { error, bankAccountId } });
    throw new Error('Error al obtener movimientos bancarios');
  }
}

/**
 * Obtiene movimientos bancarios con paginación server-side para DataTable
 */
export async function getBankMovementsPaginated(
  bankAccountId: string,
  searchParams: DataTableSearchParams,
  options?: { reconciled?: boolean }
) {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { search } = parsed;
    const { skip, take, orderBy: prismaOrderBy } = stateToPrismaParams(parsed);

    // Build faceted filter clauses
    const filtersWhere = buildFiltersWhere(parsed.filters, {
      type: 'type',
      reconciled: 'reconciled',
    }, { exclude: ['date'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(parsed.filters, ['date']);

    // Handle reconciled filter: convert string to boolean
    if (filtersWhere.reconciled !== undefined) {
      filtersWhere.reconciled = filtersWhere.reconciled === 'true';
    }

    const where: Prisma.BankMovementWhereInput = {
      bankAccountId,
      companyId,
      ...(options?.reconciled !== undefined && { reconciled: options.reconciled }),
      ...filtersWhere,
      ...dateFiltersWhere,
      ...(search && {
        OR: [
          { description: { contains: search, mode: 'insensitive' } },
          { reference: { contains: search, mode: 'insensitive' } },
          { statementNumber: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const orderBy = prismaOrderBy && Object.keys(prismaOrderBy).length > 0 ? prismaOrderBy : { date: 'desc' as const };

    const [data, total] = await Promise.all([
      prisma.bankMovement.findMany({
        where,
        select: {
          id: true,
          type: true,
          amount: true,
          date: true,
          description: true,
          reference: true,
          statementNumber: true,
          reconciled: true,
          reconciledAt: true,
          createdBy: true,
          createdAt: true,
          receipt: {
            select: { id: true, fullNumber: true },
          },
          paymentOrder: {
            select: { id: true, fullNumber: true },
          },
        },
        orderBy,
        skip,
        take,
      }),
      prisma.bankMovement.count({ where }),
    ]);

    return {
      data: data.map((m) => ({
        ...m,
        amount: Number(m.amount),
      })),
      total,
    };
  } catch (error) {
    logger.error('Error al obtener movimientos bancarios paginados', { data: { error, bankAccountId } });
    throw error;
  }
}

/**
 * Obtiene las cuentas contables disponibles para movimientos bancarios
 */
export async function getAccountsForBankMovement() {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const accounts = await prisma.account.findMany({
      where: {
        companyId,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
      },
      orderBy: { code: 'asc' },
    });

    return accounts;
  } catch (error) {
    logger.error('Error al obtener cuentas contables', { data: { error } });
    return [];
  }
}

/**
 * Concilia un movimiento bancario
 */
export async function reconcileBankMovement(movementId: string, reconcile: boolean) {
  await checkPermission('commercial.treasury.bank-accounts', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que el movimiento existe
    const movement = await prisma.bankMovement.findFirst({
      where: {
        id: movementId,
        companyId,
      },
      select: {
        id: true,
        reconciled: true,
        bankAccount: {
          select: {
            bankName: true,
            accountNumber: true,
          },
        },
      },
    });

    if (!movement) {
      throw new Error('Movimiento no encontrado');
    }

    // No hacer nada si ya está en el estado deseado
    if (movement.reconciled === reconcile) {
      return { success: true };
    }

    // Actualizar estado de conciliación
    await prisma.bankMovement.update({
      where: { id: movementId },
      data: {
        reconciled: reconcile,
        reconciledAt: reconcile ? new Date() : null,
        reconciledBy: reconcile ? userId : null,
      },
    });

    logger.info(`Movimiento bancario ${reconcile ? 'conciliado' : 'desconciliado'}`, {
      data: {
        movementId,
        bankAccount: `${movement.bankAccount.bankName} - ${movement.bankAccount.accountNumber}`,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return { success: true };
  } catch (error) {
    logger.error('Error al conciliar movimiento', { data: { error, movementId } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al conciliar movimiento');
  }
}

/**
 * Concilia múltiples movimientos bancarios
 */
export async function reconcileMultipleBankMovements(movementIds: string[], reconcile: boolean) {
  await checkPermission('commercial.treasury.bank-accounts', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Actualizar todos los movimientos
    const result = await prisma.bankMovement.updateMany({
      where: {
        id: { in: movementIds },
        companyId,
      },
      data: {
        reconciled: reconcile,
        reconciledAt: reconcile ? new Date() : null,
        reconciledBy: reconcile ? userId : null,
      },
    });

    logger.info(`${result.count} movimientos bancarios ${reconcile ? 'conciliados' : 'desconciliados'}`, {
      data: { count: result.count },
    });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return { success: true, count: result.count };
  } catch (error) {
    logger.error('Error al conciliar movimientos', { data: { error, movementIds } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al conciliar movimientos');
  }
}

/**
 * Elimina un movimiento bancario (solo si no está conciliado)
 */
export async function deleteBankMovement(movementId: string) {
  await checkPermission('commercial.treasury.bank-accounts', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que el movimiento existe y no está conciliado
    const movement = await prisma.bankMovement.findFirst({
      where: {
        id: movementId,
        companyId,
      },
      select: {
        id: true,
        type: true,
        amount: true,
        reconciled: true,
        bankAccount: {
          select: {
            id: true,
            balance: true,
          },
        },
      },
    });

    if (!movement) {
      throw new Error('Movimiento no encontrado');
    }

    if (movement.reconciled) {
      throw new Error('No se puede eliminar un movimiento conciliado');
    }

    // Eliminar movimiento y actualizar saldo en transacción
    await prisma.$transaction(async (tx) => {
      // Calcular nuevo saldo (revertir el movimiento)
      let newBalance = movement.bankAccount.balance;

      // Movimientos que aumentan el saldo (al revertir, disminuyen)
      if (['DEPOSIT', 'TRANSFER_IN', 'INTEREST'].includes(movement.type)) {
        newBalance = movement.bankAccount.balance.sub(movement.amount);
      }
      // Movimientos que disminuyen el saldo (al revertir, aumentan)
      else if (['WITHDRAWAL', 'TRANSFER_OUT', 'CHECK', 'DEBIT', 'FEE'].includes(movement.type)) {
        newBalance = movement.bankAccount.balance.add(movement.amount);
      }

      // Actualizar saldo
      await tx.bankAccount.update({
        where: { id: movement.bankAccount.id },
        data: { balance: newBalance },
      });

      // Eliminar movimiento
      await tx.bankMovement.delete({
        where: { id: movementId },
      });
    });

    logger.info('Movimiento bancario eliminado', {
      data: {
        movementId,
        type: movement.type,
        amount: Number(movement.amount),
      },
    });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar movimiento bancario', { data: { error, movementId } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al eliminar movimiento bancario');
  }
}

/**
 * Obtiene recibos confirmados sin movimiento bancario vinculado para una cuenta bancaria
 */
export async function getUnlinkedReceipts(bankAccountId: string) {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Buscar recibos CONFIRMED sin BankMovement vinculado
    // Incluye: con pagos bancarios a esta cuenta O sin pagos (para vincular después)
    const receipts = await prisma.receipt.findMany({
      where: {
        companyId,
        status: 'CONFIRMED',
        bankMovements: {
          none: {},
        },
        OR: [
          { payments: { some: { bankAccountId } } },
          { payments: { none: {} } },
        ],
      },
      select: {
        id: true,
        fullNumber: true,
        date: true,
        totalAmount: true,
        customer: {
          select: {
            name: true,
          },
        },
        payments: {
          where: { bankAccountId },
          select: {
            amount: true,
            paymentMethod: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    return receipts.map((r) => ({
      id: r.id,
      fullNumber: r.fullNumber,
      date: r.date,
      totalAmount: Number(r.totalAmount),
      customerName: r.customer.name,
      bankPaymentAmount: r.payments.reduce((sum: number, p: { amount: unknown }) => sum + Number(p.amount), 0),
      hasPayments: r.payments.length > 0,
    }));
  } catch (error) {
    logger.error('Error al obtener recibos sin vincular', { data: { error, bankAccountId } });
    throw new Error('Error al obtener recibos sin vincular');
  }
}

/**
 * Obtiene órdenes de pago confirmadas sin movimiento bancario vinculado para una cuenta bancaria
 */
export async function getUnlinkedPaymentOrders(bankAccountId: string) {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Incluye: con pagos bancarios a esta cuenta O sin pagos (para vincular después)
    const paymentOrders = await prisma.paymentOrder.findMany({
      where: {
        companyId,
        status: 'CONFIRMED',
        bankMovements: {
          none: {},
        },
        OR: [
          { payments: { some: { bankAccountId } } },
          { payments: { none: {} } },
        ],
      },
      select: {
        id: true,
        fullNumber: true,
        date: true,
        totalAmount: true,
        supplier: {
          select: {
            tradeName: true,
            businessName: true,
          },
        },
        payments: {
          where: { bankAccountId },
          select: {
            amount: true,
            paymentMethod: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    return paymentOrders.map((po) => ({
      id: po.id,
      fullNumber: po.fullNumber,
      date: po.date,
      totalAmount: Number(po.totalAmount),
      supplierName: po.supplier.tradeName || po.supplier.businessName,
      bankPaymentAmount: po.payments.reduce((sum: number, p: { amount: unknown }) => sum + Number(p.amount), 0),
      hasPayments: po.payments.length > 0,
    }));
  } catch (error) {
    logger.error('Error al obtener órdenes de pago sin vincular', { data: { error, bankAccountId } });
    throw new Error('Error al obtener órdenes de pago sin vincular');
  }
}

/**
 * Vincula un movimiento bancario a un recibo o una orden de pago
 */
export async function linkBankMovementToDocument(
  movementId: string,
  documentType: 'RECEIPT' | 'PAYMENT_ORDER',
  documentId: string
) {
  await checkPermission('commercial.treasury.bank-accounts', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que el movimiento existe y no está ya vinculado
    const movement = await prisma.bankMovement.findFirst({
      where: { id: movementId, companyId },
      select: { id: true, receiptId: true, paymentOrderId: true },
    });

    if (!movement) throw new Error('Movimiento no encontrado');
    if (movement.receiptId || movement.paymentOrderId) {
      throw new Error('El movimiento ya está vinculado a un documento');
    }

    // Vincular y conciliar
    await prisma.bankMovement.update({
      where: { id: movementId },
      data: {
        ...(documentType === 'RECEIPT' ? { receiptId: documentId } : { paymentOrderId: documentId }),
        reconciled: true,
        reconciledAt: new Date(),
        reconciledBy: userId,
      },
    });

    logger.info('Movimiento bancario vinculado a documento', {
      data: { movementId, documentType, documentId },
    });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return { success: true };
  } catch (error) {
    logger.error('Error al vincular movimiento', { data: { error, movementId } });
    if (error instanceof Error) throw error;
    throw new Error('Error al vincular movimiento');
  }
}

/**
 * Desvincula un movimiento bancario de su documento asociado
 */
export async function unlinkBankMovementFromDocument(movementId: string) {
  await checkPermission('commercial.treasury.bank-accounts', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const movement = await prisma.bankMovement.findFirst({
      where: { id: movementId, companyId },
      select: { id: true, receiptId: true, paymentOrderId: true },
    });

    if (!movement) throw new Error('Movimiento no encontrado');
    if (!movement.receiptId && !movement.paymentOrderId) {
      throw new Error('El movimiento no está vinculado a ningún documento');
    }

    await prisma.bankMovement.update({
      where: { id: movementId },
      data: {
        receiptId: null,
        paymentOrderId: null,
        reconciled: false,
        reconciledAt: null,
        reconciledBy: null,
      },
    });

    logger.info('Movimiento bancario desvinculado', { data: { movementId } });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return { success: true };
  } catch (error) {
    logger.error('Error al desvincular movimiento', { data: { error, movementId } });
    if (error instanceof Error) throw error;
    throw new Error('Error al desvincular movimiento');
  }
}

/**
 * Obtiene estadísticas de conciliación
 */
export async function getReconciliationStats(bankAccountId: string) {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const [total, reconciled, pending] = await Promise.all([
      prisma.bankMovement.count({
        where: { bankAccountId, companyId },
      }),
      prisma.bankMovement.count({
        where: { bankAccountId, companyId, reconciled: true },
      }),
      prisma.bankMovement.count({
        where: { bankAccountId, companyId, reconciled: false },
      }),
    ]);

    return {
      total,
      reconciled,
      pending,
      percentage: total > 0 ? Math.round((reconciled / total) * 100) : 0,
    };
  } catch (error) {
    logger.error('Error al obtener estadísticas de conciliación', { data: { error, bankAccountId } });
    throw new Error('Error al obtener estadísticas');
  }
}
