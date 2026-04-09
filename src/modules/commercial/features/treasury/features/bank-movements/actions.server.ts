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
import { bankMovementSchema, bankTransferSchema, type BankMovementFormData, type BankTransferFormData } from '../../shared/validators';
import { checkPermission } from '@/shared/lib/permissions';
import moment from 'moment';

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
    const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST', 'CHECK'].includes(validated.type);

    // Crear movimiento, actualizar saldo y generar asiento en transacción
    const movement = await prisma.$transaction(async (tx) => {
      // Calcular nuevo saldo
      let newBalance = bankAccount.balance;

      if (isIncome) {
        newBalance = bankAccount.balance.add(amount);
      } else if (['WITHDRAWAL', 'TRANSFER_OUT', 'DEBIT', 'FEE'].includes(validated.type)) {
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
            select: {
              id: true,
              fullNumber: true,
              date: true,
              totalAmount: true,
              status: true,
              customer: { select: { name: true } },
            },
          },
          paymentOrder: {
            select: {
              id: true,
              fullNumber: true,
              date: true,
              totalAmount: true,
              status: true,
              notes: true,
              supplier: { select: { businessName: true } },
              items: {
                select: {
                  expense: { select: { description: true } },
                },
                take: 1,
              },
            },
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
        receipt: m.receipt
          ? {
              id: m.receipt.id,
              fullNumber: m.receipt.fullNumber,
              date: m.receipt.date,
              total: Number(m.receipt.totalAmount),
              status: m.receipt.status,
              customer: m.receipt.customer,
            }
          : null,
        paymentOrder: m.paymentOrder
          ? {
              id: m.paymentOrder.id,
              fullNumber: m.paymentOrder.fullNumber,
              date: m.paymentOrder.date,
              total: Number(m.paymentOrder.totalAmount),
              status: m.paymentOrder.status,
              supplier: m.paymentOrder.supplier,
              expenseDescription: m.paymentOrder.items?.[0]?.expense?.description || m.paymentOrder.notes || null,
            }
          : null,
      })),
      total,
    };
  } catch (error) {
    logger.error('Error al obtener movimientos bancarios paginados', { data: { error, bankAccountId } });
    throw error;
  }
}

/**
 * Obtiene los totales de movimientos filtrados (entradas, salidas, neto)
 */
export async function getBankMovementsTotals(
  bankAccountId: string,
  searchParams: DataTableSearchParams
) {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { search } = parsed;

    const filtersWhere = buildFiltersWhere(parsed.filters, {
      type: 'type',
      reconciled: 'reconciled',
    }, { exclude: ['date'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(parsed.filters, ['date']);

    if (filtersWhere.reconciled !== undefined) {
      filtersWhere.reconciled = filtersWhere.reconciled === 'true';
    }

    const where: Prisma.BankMovementWhereInput = {
      bankAccountId,
      companyId,
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

    const movements = await prisma.bankMovement.findMany({
      where,
      select: { type: true, amount: true },
    });

    const INCOME_TYPES = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST', 'CHECK'];
    let totalEntries = 0;
    let totalExits = 0;

    for (const m of movements) {
      const amount = Number(m.amount);
      if (INCOME_TYPES.includes(m.type)) {
        totalEntries += amount;
      } else {
        totalExits += amount;
      }
    }

    return {
      totalEntries,
      totalExits,
      netBalance: totalEntries - totalExits,
    };
  } catch (error) {
    logger.error('Error al obtener totales de movimientos', { data: { error, bankAccountId } });
    throw new Error('Error al obtener totales de movimientos');
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
    // Verificar que el movimiento existe, no está conciliado y no está vinculado
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
        receiptId: true,
        paymentOrderId: true,
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

    if (movement.receiptId || movement.paymentOrderId) {
      throw new Error('No se puede eliminar un movimiento vinculado a un documento');
    }

    // Eliminar movimiento y actualizar saldo en transacción
    await prisma.$transaction(async (tx) => {
      // Calcular nuevo saldo (revertir el movimiento)
      let newBalance = movement.bankAccount.balance;

      // Movimientos que aumentan el saldo (al revertir, disminuyen)
      if (['DEPOSIT', 'TRANSFER_IN', 'INTEREST', 'CHECK'].includes(movement.type)) {
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
 * Obtiene cuentas bancarias activas para transferencias (excluye la cuenta origen)
 */
export async function getBankAccountsForTransfer(excludeAccountId?: string) {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const accounts = await prisma.bankAccount.findMany({
    where: {
      companyId,
      status: 'ACTIVE',
      ...(excludeAccountId && { id: { not: excludeAccountId } }),
    },
    select: {
      id: true,
      bankName: true,
      accountNumber: true,
      accountType: true,
      balance: true,
    },
    orderBy: { bankName: 'asc' },
  });

  return accounts.map((a) => ({
    ...a,
    balance: Number(a.balance),
  }));
}

/**
 * Obtiene cajas con sesión abierta para transferencias banco→caja
 */
export async function getCashRegistersForTransfer() {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const cashRegisters = await prisma.cashRegister.findMany({
    where: {
      companyId,
      status: 'ACTIVE',
      sessions: {
        some: { status: 'OPEN' },
      },
    },
    select: {
      id: true,
      code: true,
      name: true,
      sessions: {
        where: { status: 'OPEN' },
        select: {
          id: true,
          expectedBalance: true,
        },
        take: 1,
      },
    },
    orderBy: { code: 'asc' },
  });

  return cashRegisters.map((cr) => ({
    id: cr.id,
    code: cr.code,
    name: cr.name,
    activeSessionId: cr.sessions[0]?.id || null,
    currentBalance: cr.sessions[0] ? Number(cr.sessions[0].expectedBalance) : 0,
  }));
}

/**
 * Realiza una transferencia entre cuentas propias (banco→banco o banco→caja)
 */
export async function createBankTransfer(data: BankTransferFormData) {
  await checkPermission('commercial.treasury.bank-accounts', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const validated = bankTransferSchema.parse(data);
    const amount = new Prisma.Decimal(validated.amount);
    const transferRef = `TRF-${moment(validated.date).format('YYYYMMDD')}-${Date.now().toString(36).toUpperCase()}`;

    // Verificar cuenta origen
    const sourceAccount = await prisma.bankAccount.findFirst({
      where: { id: validated.sourceBankAccountId, companyId, status: 'ACTIVE' },
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        balance: true,
        accountId: true,
      },
    });

    if (!sourceAccount) throw new Error('Cuenta origen no encontrada o inactiva');

    if (validated.destinationType === 'BANK') {
      // Transferencia Banco → Banco
      const destAccount = await prisma.bankAccount.findFirst({
        where: { id: validated.destinationBankAccountId!, companyId, status: 'ACTIVE' },
        select: {
          id: true,
          bankName: true,
          accountNumber: true,
          balance: true,
          accountId: true,
        },
      });

      if (!destAccount) throw new Error('Cuenta destino no encontrada o inactiva');

      await prisma.$transaction(async (tx) => {
        // 1. Crear TRANSFER_OUT en cuenta origen
        await tx.bankMovement.create({
          data: {
            bankAccountId: sourceAccount.id,
            companyId,
            type: BankMovementType.TRANSFER_OUT,
            amount,
            date: validated.date,
            description: validated.description,
            reference: validated.reference || transferRef,
            createdBy: userId,
          },
        });

        // 2. Crear TRANSFER_IN en cuenta destino
        await tx.bankMovement.create({
          data: {
            bankAccountId: destAccount.id,
            companyId,
            type: BankMovementType.TRANSFER_IN,
            amount,
            date: validated.date,
            description: validated.description,
            reference: validated.reference || transferRef,
            createdBy: userId,
          },
        });

        // 3. Actualizar saldos
        await tx.bankAccount.update({
          where: { id: sourceAccount.id },
          data: { balance: sourceAccount.balance.sub(amount) },
        });

        await tx.bankAccount.update({
          where: { id: destAccount.id },
          data: { balance: destAccount.balance.add(amount) },
        });

        // 4. Asiento contable si ambas cuentas tienen cuenta contable
        if (sourceAccount.accountId && destAccount.accountId) {
          const settings = await tx.accountingSettings.findUnique({
            where: { companyId },
            select: { lastEntryNumber: true },
          });

          if (settings) {
            const nextNumber = settings.lastEntryNumber + 1;
            await tx.journalEntry.create({
              data: {
                companyId,
                number: nextNumber,
                date: validated.date,
                description: `Transferencia bancaria - ${validated.description}`,
                createdBy: 'system',
                lines: {
                  create: [
                    {
                      accountId: destAccount.accountId,
                      debit: amount,
                      credit: new Prisma.Decimal(0),
                      description: `Transferencia desde ${sourceAccount.bankName} ${sourceAccount.accountNumber}`,
                    },
                    {
                      accountId: sourceAccount.accountId,
                      debit: new Prisma.Decimal(0),
                      credit: amount,
                      description: `Transferencia a ${destAccount.bankName} ${destAccount.accountNumber}`,
                    },
                  ],
                },
              },
            });

            await tx.accountingSettings.update({
              where: { companyId },
              data: { lastEntryNumber: nextNumber },
            });
          }
        }
      });

      logger.info('Transferencia banco→banco realizada', {
        data: {
          from: `${sourceAccount.bankName} ${sourceAccount.accountNumber}`,
          to: `${destAccount.bankName} ${destAccount.accountNumber}`,
          amount: validated.amount,
          reference: transferRef,
        },
      });
    } else {
      // Transferencia Banco → Caja
      const cashRegister = await prisma.cashRegister.findFirst({
        where: { id: validated.destinationCashRegisterId!, companyId, status: 'ACTIVE' },
        select: {
          id: true,
          code: true,
          name: true,
          accountId: true,
          sessions: {
            where: { status: 'OPEN' },
            select: { id: true, expectedBalance: true },
            take: 1,
          },
        },
      });

      if (!cashRegister) throw new Error('Caja destino no encontrada o inactiva');
      if (!cashRegister.sessions[0]) throw new Error('La caja no tiene una sesión abierta');

      const session = cashRegister.sessions[0];

      await prisma.$transaction(async (tx) => {
        // 1. Crear TRANSFER_OUT en banco
        await tx.bankMovement.create({
          data: {
            bankAccountId: sourceAccount.id,
            companyId,
            type: BankMovementType.TRANSFER_OUT,
            amount,
            date: validated.date,
            description: validated.description,
            reference: validated.reference || transferRef,
            createdBy: userId,
          },
        });

        // 2. Actualizar saldo banco
        await tx.bankAccount.update({
          where: { id: sourceAccount.id },
          data: { balance: sourceAccount.balance.sub(amount) },
        });

        // 3. Crear movimiento INCOME en caja
        await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            cashRegisterId: cashRegister.id,
            companyId,
            type: 'INCOME',
            amount,
            date: validated.date,
            description: validated.description,
            reference: validated.reference || transferRef,
            createdBy: userId,
          },
        });

        // 4. Actualizar expectedBalance de la sesión
        await tx.cashRegisterSession.update({
          where: { id: session.id },
          data: { expectedBalance: session.expectedBalance.add(amount) },
        });

        // 5. Asiento contable si ambos tienen cuenta contable
        if (sourceAccount.accountId && cashRegister.accountId) {
          const settings = await tx.accountingSettings.findUnique({
            where: { companyId },
            select: { lastEntryNumber: true },
          });

          if (settings) {
            const nextNumber = settings.lastEntryNumber + 1;
            await tx.journalEntry.create({
              data: {
                companyId,
                number: nextNumber,
                date: validated.date,
                description: `Transferencia banco→caja - ${validated.description}`,
                createdBy: 'system',
                lines: {
                  create: [
                    {
                      accountId: cashRegister.accountId,
                      debit: amount,
                      credit: new Prisma.Decimal(0),
                      description: `Transferencia desde ${sourceAccount.bankName} ${sourceAccount.accountNumber}`,
                    },
                    {
                      accountId: sourceAccount.accountId,
                      debit: new Prisma.Decimal(0),
                      credit: amount,
                      description: `Transferencia a caja ${cashRegister.code}`,
                    },
                  ],
                },
              },
            });

            await tx.accountingSettings.update({
              where: { companyId },
              data: { lastEntryNumber: nextNumber },
            });
          }
        }
      });

      logger.info('Transferencia banco→caja realizada', {
        data: {
          from: `${sourceAccount.bankName} ${sourceAccount.accountNumber}`,
          to: `Caja ${cashRegister.code} - ${cashRegister.name}`,
          amount: validated.amount,
          reference: transferRef,
        },
      });
    }

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    revalidatePath('/dashboard/commercial/treasury/cash-registers');

    return { success: true };
  } catch (error) {
    logger.error('Error al realizar transferencia', { data: { error } });
    if (error instanceof Error) throw error;
    throw new Error('Error al realizar la transferencia');
  }
}

/**
 * Obtiene TODOS los movimientos de una cuenta bancaria según filtros (sin paginación, para exportar)
 */
export async function getAllBankMovementsForExport(
  bankAccountId: string,
  searchParams: DataTableSearchParams
) {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { search } = parsed;

    const filtersWhere = buildFiltersWhere(parsed.filters, {
      type: 'type',
      reconciled: 'reconciled',
    }, { exclude: ['date'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(parsed.filters, ['date']);

    if (filtersWhere.reconciled !== undefined) {
      filtersWhere.reconciled = filtersWhere.reconciled === 'true';
    }

    const where: Prisma.BankMovementWhereInput = {
      bankAccountId,
      companyId,
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

    const data = await prisma.bankMovement.findMany({
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
        createdAt: true,
        receipt: {
          select: { id: true, fullNumber: true },
        },
        paymentOrder: {
          select: { id: true, fullNumber: true },
        },
      },
      orderBy: { date: 'desc' },
    });

    return data.map((m) => ({
      ...m,
      amount: Number(m.amount),
    }));
  } catch (error) {
    logger.error('Error al obtener movimientos para exportar', { data: { error, bankAccountId } });
    throw new Error('Error al obtener movimientos para exportar');
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
