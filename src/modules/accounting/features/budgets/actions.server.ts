'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { revalidateAccountingRoutes } from '../../shared/utils';
import { NOT_CLOSING_ENTRY_SQL } from '../../shared/utils/closing-entries';
import {
  AccountType,
  AccountNature,
  BudgetStatus,
} from '@/generated/prisma/enums';
import {
  createBudgetSchema,
  updateBudgetSchema,
  createRevisionSchema,
  type CreateBudgetInput,
  type UpdateBudgetInput,
  type CreateRevisionInput,
} from './validators';
import moment from 'moment';

// ============================================
// FUNCIONES AUXILIARES (no exportadas)
// ============================================

/**
 * Calcula el año fiscal actual basado en la fecha actual y fiscalYearStart.
 * Si estamos antes del mes de inicio fiscal, el año fiscal es el año anterior.
 */
function getCurrentFiscalYear(fiscalYearStart: Date): number {
  const startMonth = moment.utc(fiscalYearStart).month(); // 0-based (día UTC, TSK-760)
  const now = moment();
  const currentMonth = now.month();
  const currentYear = now.year();

  // Si el mes actual es anterior al mes de inicio fiscal,
  // estamos en el año fiscal que comenzó el año pasado
  if (currentMonth < startMonth) {
    return currentYear - 1;
  }
  return currentYear;
}

/**
 * Obtiene los labels de los 12 meses del ejercicio fiscal.
 * Ej: si fiscalYearStart es julio, retorna ['Jul', 'Ago', 'Sep', ..., 'Jun'].
 */
function getFiscalMonthLabels(fiscalYearStart: Date): string[] {
  const startMonth = moment.utc(fiscalYearStart).month(); // 0-based (día UTC, TSK-760)
  return Array.from({ length: 12 }, (_, i) =>
    moment()
      .month((startMonth + i) % 12)
      .format('MMM')
  );
}

/**
 * Calcula el ejecutado mensual de una cuenta en un rango fiscal.
 * Query optimizada con $queryRaw usando EXTRACT(MONTH) y GROUP BY.
 * Retorna array de 12 números alineados al año fiscal.
 *
 * Para cuentas EXPENSE (naturaleza DEBIT): ejecutado = debit - credit
 * Para cuentas REVENUE (naturaleza CREDIT): ejecutado = credit - debit
 */
async function calculateBudgetExecution(
  accountId: string,
  companyId: string,
  fiscalYearStart: Date,
  fiscalYearEnd: Date,
  accountNature: AccountNature
): Promise<number[]> {
  const results = await prisma.$queryRaw<
    {
      month_num: number;
      year_num: number;
      total_debit: Prisma.Decimal;
      total_credit: Prisma.Decimal;
    }[]
  >`
    SELECT
      EXTRACT(MONTH FROM je.date)::int AS month_num,
      EXTRACT(YEAR FROM je.date)::int AS year_num,
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.account_id = ${accountId}::uuid
      AND je.company_id = ${companyId}::uuid
      AND je.status = 'POSTED'
      AND je.date >= ${fiscalYearStart}
      AND je.date <= ${fiscalYearEnd}
      AND ${NOT_CLOSING_ENTRY_SQL} -- la refundición no es ejecución (TSK-760 B19)
    GROUP BY EXTRACT(MONTH FROM je.date), EXTRACT(YEAR FROM je.date)
  `;

  // Inicializar array de 12 meses con 0
  const monthlyExecuted = new Array<number>(12).fill(0);

  // El mes de inicio del año fiscal (1-based para comparar con EXTRACT(MONTH))
  const startMonth = moment(fiscalYearStart).month() + 1; // 1-based
  const startYear = moment(fiscalYearStart).year();

  for (const row of results) {
    const monthNum = Number(row.month_num); // 1-based (1=Jan, 12=Dec)
    const yearNum = Number(row.year_num);

    // Calcular el índice en el array de 12 posiciones
    // basado en la distancia desde el inicio del año fiscal
    let index: number;
    if (yearNum === startYear) {
      index = monthNum - startMonth;
    } else {
      // Año siguiente al de inicio fiscal
      index = 12 - startMonth + monthNum;
    }

    if (index >= 0 && index < 12) {
      const debit = Number(row.total_debit);
      const credit = Number(row.total_credit);

      // EXPENSE (DEBIT nature): ejecutado = debit - credit
      // REVENUE (CREDIT nature): ejecutado = credit - debit
      if (accountNature === AccountNature.DEBIT) {
        monthlyExecuted[index] = debit - credit;
      } else {
        monthlyExecuted[index] = credit - debit;
      }
    }
  }

  return monthlyExecuted;
}

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene los datos iniciales para la página de presupuestos.
 * Verifica que existan AccountingSettings y cuentas de resultado.
 */
export async function getBudgetsPageData() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.budgets', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  try {
    const [settings, resultAccountsCount] = await Promise.all([
      prisma.accountingSettings.findUnique({
        where: { companyId },
        select: {
          fiscalYearStart: true,
          fiscalYearEnd: true,
        },
      }),
      prisma.account.count({
        where: {
          companyId,
          isActive: true,
          type: { in: [AccountType.EXPENSE, AccountType.REVENUE] },
        },
      }),
    ]);

    const hasSettings = settings !== null;
    const hasResultAccounts = resultAccountsCount > 0;
    const currentFiscalYear = settings
      ? getCurrentFiscalYear(settings.fiscalYearStart)
      : moment().year();

    return {
      hasSettings,
      hasResultAccounts,
      settings,
      currentFiscalYear,
    };
  } catch (error) {
    logger.error('Error al obtener datos de página de presupuestos', {
      data: { error, companyId },
    });
    throw error;
  }
}

/**
 * Lista presupuestos con filtro opcional por año fiscal.
 * Incluye info de cuenta y cantidad de revisiones.
 * Convierte totalAmount Decimal a Number().
 */
export async function getBudgets(fiscalYear?: number) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.budgets', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  try {
    const whereCondition: Prisma.BudgetWhereInput = {
      companyId,
    };

    if (fiscalYear !== undefined) {
      whereCondition.fiscalYear = fiscalYear;
    }

    const budgets = await prisma.budget.findMany({
      where: whereCondition,
      select: {
        id: true,
        accountId: true,
        fiscalYear: true,
        status: true,
        totalAmount: true,
        notes: true,
        createdAt: true,
        account: {
          select: {
            code: true,
            name: true,
            type: true,
          },
        },
        _count: {
          select: { revisions: true },
        },
      },
      orderBy: [
        { fiscalYear: 'desc' },
        { account: { code: 'asc' } },
      ],
    });

    return budgets.map((budget) => ({
      id: budget.id,
      accountId: budget.accountId,
      account: budget.account,
      fiscalYear: budget.fiscalYear,
      status: budget.status,
      totalAmount: Number(budget.totalAmount),
      notes: budget.notes,
      revisionsCount: budget._count.revisions,
      createdAt: budget.createdAt,
    }));
  } catch (error) {
    logger.error('Error al obtener presupuestos', {
      data: { error, companyId, fiscalYear },
    });
    throw error;
  }
}

/**
 * Obtiene detalle de un presupuesto con cálculo de ejecutado mensual.
 * Usa query optimizada con GROUP BY para ejecutado por mes.
 * Retorna desvíos absolutos y porcentuales por mes.
 */
export async function getBudgetDetail(budgetId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.budgets', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  try {
    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
      select: {
        id: true,
        companyId: true,
        accountId: true,
        fiscalYear: true,
        status: true,
        monthlyAmounts: true,
        totalAmount: true,
        notes: true,
        account: {
          select: {
            code: true,
            name: true,
            type: true,
            nature: true,
          },
        },
        revisions: {
          select: {
            id: true,
            previousAmounts: true,
            newAmounts: true,
            previousTotal: true,
            newTotal: true,
            reason: true,
            createdBy: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!budget) return null;

    if (budget.companyId !== companyId) {
      throw new Error('El presupuesto no pertenece a la empresa');
    }

    // Obtener settings para calcular rango fiscal
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: { fiscalYearStart: true, fiscalYearEnd: true },
    });

    if (!settings) {
      throw new Error('La empresa no tiene configuración contable');
    }

    // Calcular las fechas de inicio y fin del año fiscal correspondiente
    // Mes y día de inicio por día UTC (TSK-760): Ajustes se guarda a 00:00Z o 03:00Z.
    const fiscalStartMonth = moment.utc(settings.fiscalYearStart).month(); // 0-based
    const fiscalStartDay = moment.utc(settings.fiscalYearStart).date();
    const fiscalYearStartDate = moment()
      .year(budget.fiscalYear)
      .month(fiscalStartMonth)
      .date(fiscalStartDay)
      .startOf('day')
      .toDate();

    // El fin del año fiscal es el inicio + 1 año - 1 día
    const fiscalYearEndDate = moment(fiscalYearStartDate)
      .add(1, 'year')
      .subtract(1, 'day')
      .endOf('day')
      .toDate();

    // Calcular ejecutado mensual
    const monthlyExecuted = await calculateBudgetExecution(
      budget.accountId,
      companyId,
      fiscalYearStartDate,
      fiscalYearEndDate,
      budget.account.nature
    );

    const monthlyAmounts = budget.monthlyAmounts as number[];

    // Calcular varianza mensual: presupuestado - ejecutado
    const monthlyVariance = monthlyAmounts.map(
      (budgeted, i) => budgeted - monthlyExecuted[i]
    );

    // Calcular varianza porcentual
    const monthlyVariancePercent = monthlyAmounts.map((budgeted, i) => {
      if (budgeted === 0) {
        return monthlyExecuted[i] === 0 ? 0 : -100;
      }
      return ((budgeted - monthlyExecuted[i]) / budgeted) * 100;
    });

    const totalAmount = Number(budget.totalAmount);
    const totalExecuted = monthlyExecuted.reduce((sum, val) => sum + val, 0);
    const totalVariance = totalAmount - totalExecuted;
    const totalVariancePercent =
      totalAmount === 0
        ? totalExecuted === 0
          ? 0
          : -100
        : ((totalAmount - totalExecuted) / totalAmount) * 100;

    return {
      id: budget.id,
      accountId: budget.accountId,
      account: budget.account,
      fiscalYear: budget.fiscalYear,
      status: budget.status,
      monthlyAmounts,
      monthlyExecuted,
      monthlyVariance,
      monthlyVariancePercent,
      totalAmount,
      totalExecuted,
      totalVariance,
      totalVariancePercent,
      notes: budget.notes,
      revisions: budget.revisions.map((rev) => ({
        id: rev.id,
        previousAmounts: rev.previousAmounts as number[],
        newAmounts: rev.newAmounts as number[],
        previousTotal: Number(rev.previousTotal),
        newTotal: Number(rev.newTotal),
        reason: rev.reason,
        createdBy: rev.createdBy,
        createdAt: rev.createdAt,
      })),
      fiscalYearStart: fiscalYearStartDate,
      monthLabels: getFiscalMonthLabels(settings.fiscalYearStart),
    };
  } catch (error) {
    logger.error('Error al obtener detalle de presupuesto', {
      data: { error, budgetId, companyId },
    });
    throw error;
  }
}

/**
 * Retorna cuentas hoja (sin hijos) de tipo EXPENSE o REVENUE, activas.
 * Excluye cuentas que ya tienen presupuesto para el año fiscal dado.
 */
export async function getBudgetableAccounts(fiscalYear: number) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.budgets', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  try {
    const accounts = await prisma.account.findMany({
      where: {
        companyId,
        isActive: true,
        type: { in: [AccountType.EXPENSE, AccountType.REVENUE] },
        children: { none: {} }, // Solo cuentas hoja (sin hijos)
        budgets: {
          none: {
            fiscalYear,
            companyId,
          },
        },
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
    logger.error('Error al obtener cuentas presupuestables', {
      data: { error, companyId, fiscalYear },
    });
    throw error;
  }
}

/**
 * Retorna lista de años fiscales disponibles basados en el
 * fiscalYearStart de AccountingSettings y presupuestos existentes.
 */
export async function getAvailableFiscalYears() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.budgets', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: { fiscalYearStart: true },
    });

    if (!settings) return [];

    const currentFiscalYear = getCurrentFiscalYear(settings.fiscalYearStart);

    // Obtener años fiscales que ya tienen presupuestos
    const existingYears = await prisma.budget.findMany({
      where: { companyId },
      select: { fiscalYear: true },
      distinct: ['fiscalYear'],
      orderBy: { fiscalYear: 'desc' },
    });

    const yearsSet = new Set(existingYears.map((b) => b.fiscalYear));

    // Agregar año fiscal actual y siguiente
    yearsSet.add(currentFiscalYear);
    yearsSet.add(currentFiscalYear + 1);

    // Ordenar descendente
    return Array.from(yearsSet).sort((a, b) => b - a);
  } catch (error) {
    logger.error('Error al obtener años fiscales disponibles', {
      data: { error, companyId },
    });
    throw error;
  }
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Crea un nuevo presupuesto en estado DRAFT.
 * Valida: schema Zod, cuenta existe y es EXPENSE/REVENUE, es cuenta hoja,
 * unicidad companyId+accountId+fiscalYear.
 * Calcula totalAmount como suma de monthlyAmounts.
 */
export async function createBudget(input: CreateBudgetInput) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.budgets', 'create', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  // Validar con Zod
  const parsed = createBudgetSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Datos inválidos: ${parsed.error.issues.map((e: { message: string }) => e.message).join(', ')}`
    );
  }

  const data = parsed.data;

  try {
    // Verificar que la cuenta existe, es de tipo resultado y es hoja
    const account = await prisma.account.findUnique({
      where: { id: data.accountId },
      select: {
        id: true,
        companyId: true,
        type: true,
        isActive: true,
        children: { select: { id: true }, take: 1 },
      },
    });

    if (!account || account.companyId !== companyId) {
      throw new Error('La cuenta no existe o no pertenece a la empresa');
    }

    if (!account.isActive) {
      throw new Error('La cuenta no está activa');
    }

    if (
      account.type !== AccountType.EXPENSE &&
      account.type !== AccountType.REVENUE
    ) {
      throw new Error(
        'Solo se pueden crear presupuestos para cuentas de Gastos o Ingresos'
      );
    }

    if (account.children.length > 0) {
      throw new Error(
        'Solo se pueden crear presupuestos para cuentas hoja (sin subcuentas)'
      );
    }

    // Verificar unicidad
    const existing = await prisma.budget.findUnique({
      where: {
        companyId_accountId_fiscalYear: {
          companyId,
          accountId: data.accountId,
          fiscalYear: data.fiscalYear,
        },
      },
      select: { id: true },
    });

    if (existing) {
      throw new Error(
        'Ya existe un presupuesto para esta cuenta y año fiscal'
      );
    }

    // Calcular total
    const totalAmount = data.monthlyAmounts.reduce((sum, val) => sum + val, 0);

    const budget = await prisma.budget.create({
      data: {
        companyId,
        accountId: data.accountId,
        fiscalYear: data.fiscalYear,
        status: BudgetStatus.DRAFT,
        monthlyAmounts: data.monthlyAmounts,
        totalAmount,
        notes: data.notes ?? null,
        createdBy: userId,
      },
      select: { id: true },
    });

    logger.info('Presupuesto creado', {
      data: { budgetId: budget.id, accountId: data.accountId, fiscalYear: data.fiscalYear, userId },
    });

    revalidateAccountingRoutes(companyId);

    return { success: true as const, id: budget.id };
  } catch (error) {
    logger.error('Error al crear presupuesto', {
      data: { error, companyId, userId },
    });
    throw error;
  }
}

/**
 * Actualiza un presupuesto DRAFT (montos y notas).
 * Solo permitido si status === DRAFT.
 * Recalcula totalAmount.
 */
export async function updateBudget(id: string, input: UpdateBudgetInput) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.budgets', 'update', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  // Validar con Zod
  const parsed = updateBudgetSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Datos inválidos: ${parsed.error.issues.map((e: { message: string }) => e.message).join(', ')}`
    );
  }

  const data = parsed.data;

  try {
    const budget = await prisma.budget.findUnique({
      where: { id },
      select: { id: true, companyId: true, status: true },
    });

    if (!budget || budget.companyId !== companyId) {
      throw new Error('Presupuesto no encontrado');
    }

    if (budget.status !== BudgetStatus.DRAFT) {
      throw new Error('Solo se pueden editar presupuestos en estado Borrador');
    }

    const totalAmount = data.monthlyAmounts.reduce((sum, val) => sum + val, 0);

    await prisma.budget.update({
      where: { id },
      data: {
        monthlyAmounts: data.monthlyAmounts,
        totalAmount,
        notes: data.notes ?? null,
      },
    });

    logger.info('Presupuesto actualizado', {
      data: { budgetId: id, userId },
    });

    revalidateAccountingRoutes(companyId);

    return { success: true as const };
  } catch (error) {
    logger.error('Error al actualizar presupuesto', {
      data: { error, budgetId: id, companyId, userId },
    });
    throw error;
  }
}

/**
 * Cambia estado de DRAFT a ACTIVE.
 * Valida que totalAmount > 0.
 */
export async function activateBudget(id: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.budgets', 'approve', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  try {
    const budget = await prisma.budget.findUnique({
      where: { id },
      select: { id: true, companyId: true, status: true, totalAmount: true },
    });

    if (!budget || budget.companyId !== companyId) {
      throw new Error('Presupuesto no encontrado');
    }

    if (budget.status !== BudgetStatus.DRAFT) {
      throw new Error('Solo se pueden activar presupuestos en estado Borrador');
    }

    if (Number(budget.totalAmount) <= 0) {
      throw new Error(
        'No se puede activar un presupuesto con monto total igual a 0'
      );
    }

    await prisma.budget.update({
      where: { id },
      data: { status: BudgetStatus.ACTIVE },
    });

    logger.info('Presupuesto activado', {
      data: { budgetId: id, userId },
    });

    revalidateAccountingRoutes(companyId);

    return { success: true as const };
  } catch (error) {
    logger.error('Error al activar presupuesto', {
      data: { error, budgetId: id, companyId, userId },
    });
    throw error;
  }
}

/**
 * Crea una revisión formal de un presupuesto ACTIVE.
 * Guarda previousAmounts/newAmounts en BudgetRevision,
 * actualiza monthlyAmounts y totalAmount del Budget.
 * Usa transacción Prisma.
 */
export async function createBudgetRevision(input: CreateRevisionInput) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.budgets', 'update', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  // Validar con Zod
  const parsed = createRevisionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Datos inválidos: ${parsed.error.issues.map((e: { message: string }) => e.message).join(', ')}`
    );
  }

  const data = parsed.data;

  try {
    const budget = await prisma.budget.findUnique({
      where: { id: data.budgetId },
      select: {
        id: true,
        companyId: true,
        status: true,
        monthlyAmounts: true,
        totalAmount: true,
      },
    });

    if (!budget || budget.companyId !== companyId) {
      throw new Error('Presupuesto no encontrado');
    }

    if (budget.status !== BudgetStatus.ACTIVE) {
      throw new Error(
        'Solo se pueden crear revisiones de presupuestos en estado Activo'
      );
    }

    const previousAmounts = budget.monthlyAmounts as number[];
    const previousTotal = Number(budget.totalAmount);
    const newTotal = data.newAmounts.reduce((sum, val) => sum + val, 0);

    const result = await prisma.$transaction(async (tx) => {
      // Crear la revisión
      const revision = await tx.budgetRevision.create({
        data: {
          budgetId: data.budgetId,
          previousAmounts: previousAmounts,
          newAmounts: data.newAmounts,
          previousTotal,
          newTotal,
          reason: data.reason,
          createdBy: userId,
        },
        select: { id: true },
      });

      // Actualizar el presupuesto con los nuevos montos
      await tx.budget.update({
        where: { id: data.budgetId },
        data: {
          monthlyAmounts: data.newAmounts,
          totalAmount: newTotal,
        },
      });

      return revision;
    });

    logger.info('Revisión de presupuesto creada', {
      data: {
        budgetId: data.budgetId,
        revisionId: result.id,
        previousTotal,
        newTotal,
        userId,
      },
    });

    revalidateAccountingRoutes(companyId);

    return { success: true as const, revisionId: result.id };
  } catch (error) {
    logger.error('Error al crear revisión de presupuesto', {
      data: { error, budgetId: input.budgetId, companyId, userId },
    });
    throw error;
  }
}

/**
 * Cambia estado de ACTIVE a CLOSED.
 */
export async function closeBudget(id: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.budgets', 'approve', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  try {
    const budget = await prisma.budget.findUnique({
      where: { id },
      select: { id: true, companyId: true, status: true },
    });

    if (!budget || budget.companyId !== companyId) {
      throw new Error('Presupuesto no encontrado');
    }

    if (budget.status !== BudgetStatus.ACTIVE) {
      throw new Error('Solo se pueden cerrar presupuestos en estado Activo');
    }

    await prisma.budget.update({
      where: { id },
      data: { status: BudgetStatus.CLOSED },
    });

    logger.info('Presupuesto cerrado', {
      data: { budgetId: id, userId },
    });

    revalidateAccountingRoutes(companyId);

    return { success: true as const };
  } catch (error) {
    logger.error('Error al cerrar presupuesto', {
      data: { error, budgetId: id, companyId, userId },
    });
    throw error;
  }
}

/**
 * Elimina un presupuesto DRAFT.
 * Las revisiones se eliminan en cascada.
 */
export async function deleteBudget(id: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.budgets', 'delete', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  try {
    const budget = await prisma.budget.findUnique({
      where: { id },
      select: { id: true, companyId: true, status: true },
    });

    if (!budget || budget.companyId !== companyId) {
      throw new Error('Presupuesto no encontrado');
    }

    if (budget.status !== BudgetStatus.DRAFT) {
      throw new Error('Solo se pueden eliminar presupuestos en estado Borrador');
    }

    await prisma.budget.delete({
      where: { id },
    });

    logger.info('Presupuesto eliminado', {
      data: { budgetId: id, userId },
    });

    revalidateAccountingRoutes(companyId);

    return { success: true as const };
  } catch (error) {
    logger.error('Error al eliminar presupuesto', {
      data: { error, budgetId: id, companyId, userId },
    });
    throw error;
  }
}
