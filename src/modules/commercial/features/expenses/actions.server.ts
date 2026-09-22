'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { parseSearchParams, stateToPrismaParams, buildFiltersWhere, buildDateRangeFiltersWhere } from '@/shared/components/common/DataTable/helpers';
import type { ExpenseFormInput, ExpenseCategoryFormInput } from './validators';
import {
  createJournalEntryForExpense,
  checkBudgetForExpense,
} from '@/modules/accounting/features/integrations/commercial';
import moment from 'moment';
import { checkPermission } from '@/shared/lib/permissions';
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import {
  ACCOUNTING_SETTINGS_PATH,
  settingsAccountLabel,
  type AccountingSettingsAccountField,
} from '@/shared/lib/accounts/settings-account-labels';
import { formatAccountLabel } from '@/modules/commercial/shared/line-accounts';
import {
  buildMissingSettingsAccountsMessage,
  findMissingSettingsAccounts,
} from '@/modules/commercial/shared/settings-accounts';

/**
 * Normaliza una fecha @db.Date (medianoche UTC) a mediodía UTC
 * para evitar desplazamiento de día por timezone del cliente.
 */
function normalizeDbDate(date: Date): Date {
  return moment.utc(date).startOf('day').add(12, 'hours').toDate();
}

function normalizeDbDateNullable(date: Date | null): Date | null {
  return date ? normalizeDbDate(date) : null;
}

// ============================================
// CATEGORÍAS DE GASTOS
// ============================================

/**
 * Obtiene las categorías de gastos activas de la empresa
 */
export async function getExpenseCategories() {
  await checkPermission('commercial.expenses', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.expenseCategory.findMany({
    where: { companyId, isActive: true },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Obtiene todas las categorías (incluyendo inactivas) para gestión
 */
export async function getAllExpenseCategories() {
  await checkPermission('commercial.expenses', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.expenseCategory.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      _count: { select: { expenses: true } },
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Crea una nueva categoría de gastos
 */
export async function createExpenseCategory(data: ExpenseCategoryFormInput) {
  await checkPermission('commercial.expenses', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const category = await prisma.expenseCategory.create({
      data: {
        companyId,
        name: data.name,
        description: data.description || null,
      },
    });

    logger.info('Categoría de gasto creada', { data: { categoryId: category.id, name: category.name } });
    revalidatePath('/dashboard/commercial/expenses');

    return { success: true, id: category.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('Ya existe una categoría con ese nombre');
    }
    logger.error('Error al crear categoría de gasto', { data: { error } });
    throw new Error('Error al crear categoría de gasto');
  }
}

/**
 * Actualiza una categoría de gastos
 */
export async function updateExpenseCategory(id: string, data: ExpenseCategoryFormInput) {
  await checkPermission('commercial.expenses', 'update', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const category = await prisma.expenseCategory.updateMany({
      where: { id, companyId },
      data: {
        name: data.name,
        description: data.description || null,
      },
    });

    if (category.count === 0) throw new Error('Categoría no encontrada');

    logger.info('Categoría de gasto actualizada', { data: { categoryId: id } });
    revalidatePath('/dashboard/commercial/expenses');

    return { success: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('Ya existe una categoría con ese nombre');
    }
    logger.error('Error al actualizar categoría de gasto', { data: { error, id } });
    if (error instanceof Error) throw error;
    throw new Error('Error al actualizar categoría de gasto');
  }
}

/**
 * Activa/desactiva una categoría de gastos
 */
export async function toggleExpenseCategory(id: string) {
  await checkPermission('commercial.expenses', 'update', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const category = await prisma.expenseCategory.findFirst({
      where: { id, companyId },
      select: { isActive: true },
    });

    if (!category) throw new Error('Categoría no encontrada');

    await prisma.expenseCategory.updateMany({
      where: { id, companyId },
      data: { isActive: !category.isActive },
    });

    logger.info('Categoría de gasto toggled', { data: { categoryId: id, isActive: !category.isActive } });
    revalidatePath('/dashboard/commercial/expenses');

    return { success: true };
  } catch (error) {
    logger.error('Error al toggle categoría de gasto', { data: { error, id } });
    if (error instanceof Error) throw error;
    throw new Error('Error al cambiar estado de categoría');
  }
}

// ============================================
// GASTOS - CRUD
// ============================================

/**
 * Obtiene gastos con paginación server-side para DataTable
 */
export async function getExpensesPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.expenses', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { search } = parsed;
    const { skip, take, orderBy: prismaOrderBy } = stateToPrismaParams(parsed);

    const filtersWhere = buildFiltersWhere(parsed.filters, {
      status: 'status',
      categoryId: 'categoryId',
    }, { exclude: ['date', 'dueDate', 'supplier_name', 'fullNumber'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(parsed.filters, ['date', 'dueDate']);

    // Filtro de texto para proveedor (relación anidada)
    const supplierNameFilter = parsed.filters['supplier_name'];
    const supplierWhere = supplierNameFilter?.[0]
      ? {
          supplier: {
            OR: [
              { businessName: { contains: supplierNameFilter[0], mode: 'insensitive' as const } },
              { tradeName: { contains: supplierNameFilter[0], mode: 'insensitive' as const } },
            ],
          },
        }
      : {};

    // Filtro de texto para número
    const fullNumberFilter = parsed.filters['fullNumber'];
    const fullNumberWhere = fullNumberFilter?.[0]
      ? { fullNumber: { contains: fullNumberFilter[0], mode: 'insensitive' as const } }
      : {};

    const where: Prisma.ExpenseWhereInput = {
      companyId,
      ...filtersWhere,
      ...dateFiltersWhere,
      ...supplierWhere,
      ...fullNumberWhere,
      ...(search && {
        OR: [
          { fullNumber: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { supplier: { businessName: { contains: search, mode: 'insensitive' } } },
          { category: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    // Manejar ordenamiento por relaciones
    const sortByField = parsed.sortBy;
    let orderBy: Prisma.ExpenseOrderByWithRelationInput | Prisma.ExpenseOrderByWithRelationInput[];

    if (sortByField === 'categoryId' || sortByField === 'category_name' || sortByField === 'category.name') {
      orderBy = { category: { name: parsed.sortOrder } };
    } else if (sortByField === 'supplier_name' || sortByField === 'supplier') {
      orderBy = { supplier: { businessName: parsed.sortOrder } };
    } else if (prismaOrderBy && Object.keys(prismaOrderBy).length > 0) {
      orderBy = prismaOrderBy;
    } else {
      orderBy = { number: 'desc' as const };
    }

    const [data, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        select: {
          id: true,
          number: true,
          fullNumber: true,
          description: true,
          amount: true,
          date: true,
          dueDate: true,
          status: true,
          createdAt: true,
          category: {
            select: { id: true, name: true },
          },
          supplier: {
            select: { id: true, businessName: true, tradeName: true },
          },
          _count: {
            select: { attachments: true, paymentOrderItems: true },
          },
        },
        orderBy,
        skip,
        take,
      }),
      prisma.expense.count({ where }),
    ]);

    return {
      data: data.map((expense) => ({
        ...expense,
        amount: Number(expense.amount),
        date: normalizeDbDate(expense.date),
        dueDate: normalizeDbDateNullable(expense.dueDate),
      })),
      total,
    };
  } catch (error) {
    logger.error('Error al obtener gastos paginados', { data: { error } });
    throw error;
  }
}

/**
 * Obtiene el detalle de un gasto
 */
export async function getExpenseById(id: string) {
  await checkPermission('commercial.expenses', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const expense = await prisma.expense.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        number: true,
        fullNumber: true,
        description: true,
        amount: true,
        date: true,
        dueDate: true,
        status: true,
        notes: true,
        createdBy: true,
        createdAt: true,
        category: {
          select: { id: true, name: true },
        },
        supplier: {
          select: { id: true, businessName: true, tradeName: true, taxId: true },
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            fileSize: true,
            mimeType: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        paymentOrderItems: {
          select: {
            id: true,
            amount: true,
            paymentOrder: {
              select: {
                id: true,
                fullNumber: true,
                date: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!expense) throw new Error('Gasto no encontrado');

    const paidAmount = expense.paymentOrderItems
      .filter((item) => item.paymentOrder.status === 'CONFIRMED')
      .reduce((sum, item) => sum + Number(item.amount), 0);

    return {
      ...expense,
      amount: Number(expense.amount),
      date: normalizeDbDate(expense.date),
      dueDate: normalizeDbDateNullable(expense.dueDate),
      paidAmount,
      pendingAmount: Number(expense.amount) - paidAmount,
      paymentOrderItems: expense.paymentOrderItems.map((item) => ({
        ...item,
        amount: Number(item.amount),
      })),
    };
  } catch (error) {
    logger.error('Error al obtener gasto', { data: { error, id } });
    if (error instanceof Error) throw error;
    throw new Error('Error al obtener gasto');
  }
}

/**
 * Crea un nuevo gasto (borrador)
 */
export async function createExpense(data: ExpenseFormInput) {
  await checkPermission('commercial.expenses', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const lastExpense = await prisma.expense.findFirst({
      where: { companyId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const nextNumber = (lastExpense?.number ?? 0) + 1;
    const fullNumber = `GTO-${String(nextNumber).padStart(5, '0')}`;

    const expense = await prisma.expense.create({
      data: {
        companyId,
        number: nextNumber,
        fullNumber,
        description: data.description,
        amount: new Prisma.Decimal(data.amount),
        date: data.date,
        dueDate: data.dueDate || null,
        categoryId: data.categoryId,
        supplierId: data.supplierId || null,
        notes: data.notes || null,
        status: 'DRAFT',
        createdBy: userId,
      },
    });

    logger.info('Gasto creado', {
      data: { expenseId: expense.id, fullNumber: expense.fullNumber },
    });

    revalidatePath('/dashboard/commercial/expenses');

    return { success: true, id: expense.id };
  } catch (error) {
    logger.error('Error al crear gasto', { data: { error } });
    if (error instanceof Error) throw error;
    throw new Error('Error al crear gasto');
  }
}

/**
 * Actualiza un gasto (solo si está en DRAFT)
 */
export async function updateExpense(id: string, data: ExpenseFormInput) {
  await checkPermission('commercial.expenses', 'update', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.expense.findFirst({
      where: { id, companyId, status: 'DRAFT' },
      select: { id: true },
    });

    if (!existing) throw new Error('Gasto no encontrado o no está en estado borrador');

    await prisma.expense.update({
      where: { id },
      data: {
        description: data.description,
        amount: new Prisma.Decimal(data.amount),
        date: data.date,
        dueDate: data.dueDate || null,
        categoryId: data.categoryId,
        supplierId: data.supplierId || null,
        notes: data.notes || null,
      },
    });

    logger.info('Gasto actualizado', { data: { expenseId: id } });
    revalidatePath('/dashboard/commercial/expenses');

    return { success: true };
  } catch (error) {
    logger.error('Error al actualizar gasto', { data: { error, id } });
    if (error instanceof Error) throw error;
    throw new Error('Error al actualizar gasto');
  }
}

/** Cuentas de Ajustes que usa el asiento del gasto: Debe Gastos Operativos / Haber Cuentas por Pagar. */
const EXPENSE_ENTRY_FIELDS = ['expensesAccountId', 'payablesAccountId'] as const satisfies readonly AccountingSettingsAccountField[];
type ExpenseEntryField = (typeof EXPENSE_ENTRY_FIELDS)[number];

/**
 * Pre-validación del asiento del gasto (TSK-728): las dos cuentas de Ajustes
 * cargadas e imputables. Lanza `BusinessError` con el label real del campo.
 */
async function assertExpenseEntryAccounts(
  companyId: string,
  documentLabel: string,
  settings: { expensesAccountId: string | null; payablesAccountId: string | null }
): Promise<void> {
  const missing = findMissingSettingsAccounts(settings, EXPENSE_ENTRY_FIELDS);
  if (missing.length > 0) {
    throw new BusinessError(buildMissingSettingsAccountsMessage(documentLabel, missing));
  }

  const toCheck: { field: ExpenseEntryField; accountId: string }[] = [];
  for (const field of EXPENSE_ENTRY_FIELDS) {
    const accountId = settings[field];
    if (accountId) toCheck.push({ field, accountId });
  }
  const ids = toCheck.map((a) => a.accountId);
  const [imputable, all] = await Promise.all([
    prisma.account.findMany({
      where: { ...buildImputableAccountsWhere({ companyId }), id: { in: ids } },
      select: { id: true },
    }),
    prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } }),
  ]);
  const imputableIds = new Set(imputable.map((a) => a.id));
  const failed = toCheck.find((a) => !imputableIds.has(a.accountId));
  if (!failed) return;

  const info = all.find((a) => a.id === failed.accountId);
  const cuenta = info
    ? `la cuenta ${formatAccountLabel(info)} (configurada como ${settingsAccountLabel(failed.field)}) no está activa o no es imputable`
    : `la cuenta configurada como ${settingsAccountLabel(failed.field)} ya no existe en el plan de cuentas`;
  throw new BusinessError(
    `No se puede confirmar ${documentLabel}: ${cuenta}. Corregila en ${ACCOUNTING_SETTINGS_PATH}.`
  );
}

/**
 * Confirma un gasto.
 * Antes de confirmar, verifica si el gasto excede el presupuesto mensual
 * de la cuenta de gastos. Si lo excede, retorna un budgetWarning (no bloqueante).
 *
 * Los errores esperables (gasto ya confirmado, cuenta de Ajustes faltante o no
 * imputable, período cerrado) vuelven como `{ success: false, error }` (TSK-728).
 */
export async function confirmExpense(
  id: string
): Promise<ActionResult<{ budgetWarning?: { message: string; executedPercent: number } }>> {
  await checkPermission('commercial.expenses', 'approve', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const expense = await prisma.expense.findFirst({
      where: { id, companyId, status: 'DRAFT' },
      select: { id: true, fullNumber: true, description: true, amount: true, categoryId: true, date: true },
    });

    if (!expense) throw new BusinessError('Gasto no encontrado o ya confirmado');

    // TSK-728: pre-validación fuera de la transacción: nada cambia si va a fallar por configuración
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: { expensesAccountId: true, payablesAccountId: true },
    });
    if (!settings) {
      throw new BusinessError(
        `No se encontró configuración contable para la empresa. Configurala en ${ACCOUNTING_SETTINGS_PATH}.`
      );
    }
    await assertExpenseEntryAccounts(companyId, `el gasto ${expense.fullNumber}`, settings);

    // Verificación presupuestaria (no bloqueante)
    let budgetWarning: { message: string; executedPercent: number } | undefined;
    try {
      if (settings.expensesAccountId) {
        const check = await checkBudgetForExpense(
          settings.expensesAccountId,
          Number(expense.amount),
          companyId,
          expense.date
        );
        if (check?.hasWarning) {
          budgetWarning = {
            message: check.message,
            executedPercent: check.executedPercent,
          };
        }
      }
    } catch (error) {
      logger.warn('Error en verificación presupuestaria (no bloqueante)', {
        data: { expenseId: id, error },
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id },
        data: { status: 'CONFIRMED' },
      });

      // Crear asiento contable. Si falla, la transacción entera se revierte.
      // TSK-728: antes solo se relanzaba "período cerrado" y cualquier otro fallo
      // dejaba el gasto confirmado sin asiento.
      const entryId = await createJournalEntryForExpense(id, companyId, tx);
      await tx.expense.update({
        where: { id },
        data: { journalEntryId: entryId },
      });
    });

    logger.info('Gasto confirmado', { data: { expenseId: id } });
    revalidatePath('/dashboard/commercial/expenses');

    return { success: true, budgetWarning };
  } catch (error) {
    if (error instanceof BusinessError) {
      logger.warn('Confirmación de gasto rechazada', {
        data: { expenseId: id, companyId, userId, motivo: error.message },
      });
    }
    return toActionResult(error, 'Error al confirmar gasto');
  }
}

/**
 * Cancela un gasto (solo si DRAFT o CONFIRMED sin pagos)
 */
export async function cancelExpense(id: string) {
  await checkPermission('commercial.expenses', 'delete', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const expense = await prisma.expense.findFirst({
      where: {
        id,
        companyId,
        status: { in: ['DRAFT', 'CONFIRMED'] },
      },
      select: {
        id: true,
        status: true,
        paymentOrderItems: {
          where: { paymentOrder: { status: 'CONFIRMED' } },
          select: { id: true },
        },
      },
    });

    if (!expense) throw new Error('Gasto no encontrado o no se puede cancelar');

    if (expense.paymentOrderItems.length > 0) {
      throw new Error('No se puede cancelar un gasto con pagos confirmados');
    }

    await prisma.expense.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    logger.info('Gasto cancelado', { data: { expenseId: id } });
    revalidatePath('/dashboard/commercial/expenses');

    return { success: true };
  } catch (error) {
    logger.error('Error al cancelar gasto', { data: { error, id } });
    if (error instanceof Error) throw error;
    throw new Error('Error al cancelar gasto');
  }
}

/**
 * Elimina un gasto (solo si DRAFT)
 */
export async function deleteExpense(id: string) {
  await checkPermission('commercial.expenses', 'delete', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const expense = await prisma.expense.findFirst({
      where: { id, companyId, status: 'DRAFT' },
      select: { id: true, fullNumber: true },
    });

    if (!expense) throw new Error('Gasto no encontrado o no está en estado borrador');

    await prisma.expense.delete({ where: { id } });

    logger.info('Gasto eliminado', { data: { expenseId: id, fullNumber: expense.fullNumber } });
    revalidatePath('/dashboard/commercial/expenses');

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar gasto', { data: { error, id } });
    if (error instanceof Error) throw error;
    throw new Error('Error al eliminar gasto');
  }
}

// ============================================
// Facet Counts
// ============================================

export async function getExpenseFacetCounts() {
  await checkPermission('commercial.expenses', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [statusCounts, categoryCounts] = await Promise.all([
    prisma.expense.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { status: true },
    }),
    prisma.expense.groupBy({
      by: ['categoryId'],
      where: { companyId },
      _count: { categoryId: true },
    }),
  ]);

  return {
    status: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.status])),
    categoryId: Object.fromEntries(categoryCounts.map((c) => [c.categoryId, c._count.categoryId])),
  };
}

// ============================================
// GASTOS PENDIENTES (para Órdenes de Pago)
// ============================================

/**
 * Obtiene gastos pendientes de pago (para seleccionar en órdenes de pago)
 */
export async function getPendingExpenses(supplierId?: string) {
  await checkPermission('commercial.expenses', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const expenses = await prisma.expense.findMany({
      where: {
        companyId,
        status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
        ...(supplierId && { supplierId }),
      },
      select: {
        id: true,
        fullNumber: true,
        description: true,
        amount: true,
        date: true,
        dueDate: true,
        status: true,
        category: { select: { name: true } },
        supplier: { select: { businessName: true } },
        paymentOrderItems: {
          where: { paymentOrder: { status: 'CONFIRMED' } },
          select: { amount: true },
        },
      },
      orderBy: { date: 'asc' },
    });

    return expenses.map((expense) => {
      const paidAmount = expense.paymentOrderItems.reduce((sum, item) => sum + Number(item.amount), 0);
      const total = Number(expense.amount);
      return {
        id: expense.id,
        fullNumber: expense.fullNumber,
        description: expense.description,
        categoryName: expense.category.name,
        supplierName: expense.supplier?.businessName || null,
        date: normalizeDbDate(expense.date),
        dueDate: normalizeDbDateNullable(expense.dueDate),
        total,
        paidAmount,
        pendingAmount: total - paidAmount,
        status: expense.status,
      };
    });
  } catch (error) {
    logger.error('Error al obtener gastos pendientes', { data: { error } });
    throw new Error('Error al obtener gastos pendientes');
  }
}
