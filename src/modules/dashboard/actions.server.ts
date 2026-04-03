'use server';

import { auth } from '@clerk/nextjs/server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import moment from 'moment';
import 'moment/locale/es';

moment.locale('es');

// Parsear período "YYYY-MM" o usar mes actual
function parsePeriod(period?: string) {
  const m = period ? moment(period, 'YYYY-MM', true) : moment();
  if (!m.isValid()) return moment();
  return m;
}

// ============================================
// KPIs PRINCIPALES
// ============================================

export async function getDashboardKPIs(period?: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const ref = parsePeriod(period);
    const startOfMonth = ref.clone().startOf('month').toDate();
    const endOfMonth = ref.clone().endOf('month').toDate();
    const isCurrentMonth = ref.isSame(moment(), 'month');

    // Para pendientes y alertas: si es mes actual, usar "hoy"; si es histórico, usar fin de ese mes
    const cutoffDate = isCurrentMonth ? new Date() : endOfMonth;

    const [
      salesInvoices,
      purchaseInvoices,
      monthExpenses,
      pendingSalesInvoices,
      pendingPurchaseInvoices,
      pendingExpenses,
      criticalStockProducts,
      bankAccounts,
    ] = await Promise.all([
      // Ventas del mes seleccionado (excluyendo NC)
      prisma.salesInvoice.findMany({
        where: {
          companyId,
          issueDate: { gte: startOfMonth, lte: endOfMonth },
          status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
          voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
        },
        select: { total: true },
      }),

      // Compras del mes seleccionado (excluyendo NC)
      prisma.purchaseInvoice.findMany({
        where: {
          companyId,
          issueDate: { gte: startOfMonth, lte: endOfMonth },
          status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
          voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
        },
        select: { total: true },
      }),

      // Gastos del mes seleccionado
      prisma.expense.findMany({
        where: {
          companyId,
          date: { gte: startOfMonth, lte: endOfMonth },
          status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
        },
        select: { amount: true },
      }),

      // Facturas de venta pendientes de cobro emitidas hasta fin del período (no NC)
      prisma.salesInvoice.findMany({
        where: {
          companyId,
          issueDate: { lte: endOfMonth },
          status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
          voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
        },
        select: { total: true },
      }),

      // Facturas de compra pendientes de pago emitidas hasta fin del período (no NC)
      prisma.purchaseInvoice.findMany({
        where: {
          companyId,
          issueDate: { lte: endOfMonth },
          status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
          voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
        },
        select: { total: true },
      }),

      // Gastos pendientes de pago emitidos hasta fin del período
      prisma.expense.findMany({
        where: {
          companyId,
          date: { lte: endOfMonth },
          status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
        },
        select: { amount: true },
      }),

      // Productos con stock crítico (siempre actual)
      prisma.product.findMany({
        where: {
          companyId,
          trackStock: true,
          minStock: { gt: 0 },
          status: 'ACTIVE',
        },
        select: {
          id: true,
          minStock: true,
          warehouseStocks: {
            select: { quantity: true },
          },
        },
      }),

      // Saldo bancario (siempre actual)
      prisma.bankAccount.findMany({
        where: { companyId, status: 'ACTIVE' },
        select: { balance: true },
      }),
    ]);

    // Calcular KPIs
    const salesTotal = salesInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const purchasesTotal = purchaseInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const expensesTotal = monthExpenses.reduce((sum, exp) => sum + Number(exp.amount), 0);

    const receivablesTotal = pendingSalesInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const payablesInvoiceTotal = pendingPurchaseInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const payablesExpenseTotal = pendingExpenses.reduce((sum, exp) => sum + Number(exp.amount), 0);

    // Stock crítico: filtrar en JS los que tienen stock total < minStock
    const criticalCount = criticalStockProducts.filter((product) => {
      const totalStock = product.warehouseStocks.reduce((sum, ws) => sum + Number(ws.quantity), 0);
      return totalStock < Number(product.minStock);
    }).length;

    const totalBankBalance = bankAccounts.reduce((sum, acc) => sum + Number(acc.balance), 0);

    return {
      salesThisMonth: { total: salesTotal, count: salesInvoices.length },
      purchasesThisMonth: { total: purchasesTotal, count: purchaseInvoices.length },
      expensesThisMonth: { total: expensesTotal, count: monthExpenses.length },
      pendingReceivables: { total: receivablesTotal, count: pendingSalesInvoices.length },
      pendingPayables: {
        total: payablesInvoiceTotal + payablesExpenseTotal,
        count: pendingPurchaseInvoices.length + pendingExpenses.length,
      },
      criticalStockCount: criticalCount,
      bankBalance: totalBankBalance,
    };
  } catch (error) {
    logger.error('Error al obtener KPIs del dashboard', { data: { error, companyId } });
    throw new Error('Error al obtener datos del dashboard');
  }
}

// ============================================
// TENDENCIA DE VENTAS
// ============================================

export async function getSalesTrend(period?: string, months: number = 6) {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const ref = parsePeriod(period);
    const rangeStart = ref.clone().subtract(months - 1, 'months').startOf('month').toDate();
    const endOfRef = ref.clone().endOf('month').toDate();

    const invoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        issueDate: { gte: rangeStart, lte: endOfRef },
        status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
        voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
      },
      select: { issueDate: true, total: true },
    });

    // Generar los meses terminando en el mes de referencia
    const monthsData: Array<{ month: string; monthKey: string; total: number }> = [];
    for (let i = months - 1; i >= 0; i--) {
      const m = ref.clone().subtract(i, 'months');
      monthsData.push({
        month: m.format('MMM YY'),
        monthKey: m.format('YYYY-MM'),
        total: 0,
      });
    }

    // Agrupar facturas por mes
    for (const inv of invoices) {
      const key = moment(inv.issueDate).format('YYYY-MM');
      const monthEntry = monthsData.find((m) => m.monthKey === key);
      if (monthEntry) {
        monthEntry.total += Number(inv.total);
      }
    }

    return monthsData.map(({ month, total }) => ({ month, total }));
  } catch (error) {
    logger.error('Error al obtener tendencia de ventas', { data: { error, companyId } });
    throw new Error('Error al obtener tendencia de ventas');
  }
}

// ============================================
// TENDENCIA DE COMPRAS
// ============================================

export async function getPurchasesTrend(period?: string, months: number = 6) {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const ref = parsePeriod(period);
    const rangeStart = ref.clone().subtract(months - 1, 'months').startOf('month').toDate();
    const endOfRef = ref.clone().endOf('month').toDate();

    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        issueDate: { gte: rangeStart, lte: endOfRef },
        status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
        voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
      },
      select: { issueDate: true, total: true },
    });

    const monthsData: Array<{ month: string; monthKey: string; total: number }> = [];
    for (let i = months - 1; i >= 0; i--) {
      const m = ref.clone().subtract(i, 'months');
      monthsData.push({
        month: m.format('MMM YY'),
        monthKey: m.format('YYYY-MM'),
        total: 0,
      });
    }

    for (const inv of invoices) {
      const key = moment(inv.issueDate).format('YYYY-MM');
      const monthEntry = monthsData.find((m) => m.monthKey === key);
      if (monthEntry) {
        monthEntry.total += Number(inv.total);
      }
    }

    return monthsData.map(({ month, total }) => ({ month, total }));
  } catch (error) {
    logger.error('Error al obtener tendencia de compras', { data: { error, companyId } });
    throw new Error('Error al obtener tendencia de compras');
  }
}

// ============================================
// RENTABILIDAD MENSUAL
// ============================================

export async function getProfitabilityTrend(period?: string, excludeCategoryIds?: string[], months: number = 6) {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const ref = parsePeriod(period);
    const rangeStart = ref.clone().subtract(months - 1, 'months').startOf('month').toDate();
    const endOfRef = ref.clone().endOf('month').toDate();

    const [salesInvoices, purchaseInvoices, expenses] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: {
          companyId,
          issueDate: { gte: rangeStart, lte: endOfRef },
          status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
          voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
        },
        select: { issueDate: true, total: true },
      }),
      prisma.purchaseInvoice.findMany({
        where: {
          companyId,
          issueDate: { gte: rangeStart, lte: endOfRef },
          status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
          voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
        },
        select: { issueDate: true, total: true },
      }),
      prisma.expense.findMany({
        where: {
          companyId,
          date: { gte: rangeStart, lte: endOfRef },
          status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
          ...(excludeCategoryIds && excludeCategoryIds.length > 0
            ? { categoryId: { notIn: excludeCategoryIds } }
            : {}),
        },
        select: { date: true, amount: true },
      }),
    ]);

    // Generar los meses del rango
    const monthsData: Array<{
      month: string;
      monthKey: string;
      sales: number;
      purchases: number;
      expenses: number;
      profit: number;
    }> = [];
    for (let i = months - 1; i >= 0; i--) {
      const m = ref.clone().subtract(i, 'months');
      monthsData.push({
        month: m.format('MMM YY'),
        monthKey: m.format('YYYY-MM'),
        sales: 0,
        purchases: 0,
        expenses: 0,
        profit: 0,
      });
    }

    for (const inv of salesInvoices) {
      const key = moment(inv.issueDate).format('YYYY-MM');
      const entry = monthsData.find((m) => m.monthKey === key);
      if (entry) entry.sales += Number(inv.total);
    }

    for (const inv of purchaseInvoices) {
      const key = moment(inv.issueDate).format('YYYY-MM');
      const entry = monthsData.find((m) => m.monthKey === key);
      if (entry) entry.purchases += Number(inv.total);
    }

    for (const exp of expenses) {
      const key = moment(exp.date).format('YYYY-MM');
      const entry = monthsData.find((m) => m.monthKey === key);
      if (entry) entry.expenses += Number(exp.amount);
    }

    // Calcular rentabilidad
    for (const m of monthsData) {
      m.profit = m.sales - m.purchases - m.expenses;
    }

    return monthsData.map(({ month, sales, purchases, expenses, profit }) => ({
      month,
      sales,
      purchases,
      expenses,
      profit,
    }));
  } catch (error) {
    logger.error('Error al obtener tendencia de rentabilidad', { data: { error, companyId } });
    throw new Error('Error al obtener tendencia de rentabilidad');
  }
}

// ============================================
// CATEGORÍAS DE GASTOS (para filtro)
// ============================================

export async function getExpenseCategories() {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const categories = await prisma.expenseCategory.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return categories;
  } catch (error) {
    logger.error('Error al obtener categorías de gastos', { data: { error, companyId } });
    throw new Error('Error al obtener categorías de gastos');
  }
}

// ============================================
// PRODUCTOS CON STOCK CRÍTICO
// ============================================

export async function getCriticalStockProducts() {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const products = await prisma.product.findMany({
      where: {
        companyId,
        trackStock: true,
        minStock: { gt: 0 },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        code: true,
        unitOfMeasure: true,
        minStock: true,
        warehouseStocks: {
          select: { quantity: true },
        },
      },
    });

    // Filtrar y mapear
    const criticalProducts = products
      .map((product) => {
        const totalStock = product.warehouseStocks.reduce((sum, ws) => sum + Number(ws.quantity), 0);
        const minStock = Number(product.minStock);
        return {
          productId: product.id,
          productName: product.name,
          productCode: product.code,
          totalStock,
          minStock,
          unitOfMeasure: product.unitOfMeasure,
          stockPercentage: minStock > 0 ? Math.round((totalStock / minStock) * 100) : 0,
        };
      })
      .filter((p) => p.totalStock < p.minStock)
      .sort((a, b) => a.stockPercentage - b.stockPercentage)
      .slice(0, 10);

    return criticalProducts;
  } catch (error) {
    logger.error('Error al obtener productos con stock crítico', { data: { error, companyId } });
    throw new Error('Error al obtener productos con stock crítico');
  }
}

// ============================================
// ALERTAS RECIENTES
// ============================================

export async function getRecentAlerts(period?: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const ref = parsePeriod(period);
    const endOfMonth = ref.clone().endOf('month').toDate();
    const isCurrentMonth = ref.isSame(moment(), 'month');
    // Para mes actual usar hoy, para histórico usar fin de ese mes
    const cutoffDate = isCurrentMonth ? new Date() : endOfMonth;

    const [overdueReceivables, overduePayables, overdueExpenses] = await Promise.all([
      // Facturas de venta vencidas al corte
      prisma.salesInvoice.findMany({
        where: {
          companyId,
          dueDate: { lt: cutoffDate },
          issueDate: { lte: endOfMonth },
          status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
          voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
        },
        select: {
          fullNumber: true,
          total: true,
          dueDate: true,
          customer: { select: { name: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 5,
      }),

      // Facturas de compra vencidas al corte
      prisma.purchaseInvoice.findMany({
        where: {
          companyId,
          dueDate: { lt: cutoffDate },
          issueDate: { lte: endOfMonth },
          status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
          voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
        },
        select: {
          fullNumber: true,
          total: true,
          dueDate: true,
          supplier: { select: { businessName: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 5,
      }),

      // Gastos vencidos al corte
      prisma.expense.findMany({
        where: {
          companyId,
          dueDate: { lt: cutoffDate },
          date: { lte: endOfMonth },
          status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
        },
        select: {
          fullNumber: true,
          amount: true,
          dueDate: true,
          description: true,
        },
        orderBy: { dueDate: 'asc' },
        take: 3,
      }),
    ]);

    type Alert = {
      type: 'overdue_receivable' | 'overdue_payable' | 'overdue_expense';
      title: string;
      description: string;
      date: Date | null;
      amount: number;
    };

    const alerts: Alert[] = [];

    for (const inv of overdueReceivables) {
      alerts.push({
        type: 'overdue_receivable',
        title: `Cobro vencido - ${inv.fullNumber}`,
        description: inv.customer.name,
        date: inv.dueDate,
        amount: Number(inv.total),
      });
    }

    for (const inv of overduePayables) {
      alerts.push({
        type: 'overdue_payable',
        title: `Pago vencido - ${inv.fullNumber}`,
        description: inv.supplier.businessName,
        date: inv.dueDate,
        amount: Number(inv.total),
      });
    }

    for (const exp of overdueExpenses) {
      // Expense.dueDate usa @db.Date (medianoche UTC) → normalizar a mediodía para evitar desfase de timezone
      const normalizedDate = exp.dueDate
        ? moment.utc(exp.dueDate).startOf('day').add(12, 'hours').toDate()
        : null;
      alerts.push({
        type: 'overdue_expense',
        title: `Gasto vencido - ${exp.fullNumber}`,
        description: exp.description,
        date: normalizedDate,
        amount: Number(exp.amount),
      });
    }

    // Ordenar por fecha (más vencida primero)
    alerts.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.getTime() - b.date.getTime();
    });

    return alerts.slice(0, 8);
  } catch (error) {
    logger.error('Error al obtener alertas', { data: { error, companyId } });
    throw new Error('Error al obtener alertas');
  }
}

// ============================================
// TOP 10 DEUDAS DE CLIENTES
// ============================================

export async function getTopClientDebts(limit = 10) {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Facturas de venta pendientes (no NC), agrupadas por cliente
    const pendingInvoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
        voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
      },
      select: {
        total: true,
        customerId: true,
        customer: { select: { name: true, taxId: true } },
        receiptItems: { select: { amount: true } },
      },
    });

    // Agrupar por cliente y calcular deuda pendiente
    const debtMap = new Map<string, { name: string; taxId: string | null; totalDebt: number; invoiceCount: number }>();

    for (const inv of pendingInvoices) {
      const paid = inv.receiptItems.reduce((sum, ri) => sum + Number(ri.amount), 0);
      const pending = Number(inv.total) - paid;
      if (pending <= 0) continue;

      const existing = debtMap.get(inv.customerId);
      if (existing) {
        existing.totalDebt += pending;
        existing.invoiceCount += 1;
      } else {
        debtMap.set(inv.customerId, {
          name: inv.customer.name,
          taxId: inv.customer.taxId,
          totalDebt: pending,
          invoiceCount: 1,
        });
      }
    }

    return Array.from(debtMap.values())
      .sort((a, b) => b.totalDebt - a.totalDebt)
      .slice(0, limit);
  } catch (error) {
    logger.error('Error al obtener deudas de clientes', { data: { error, companyId } });
    throw new Error('Error al obtener deudas de clientes');
  }
}

// ============================================
// TOP 10 DEUDAS DE PROVEEDORES
// ============================================

export async function getTopSupplierDebts(limit = 10) {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const pendingInvoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
        voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
      },
      select: {
        total: true,
        supplierId: true,
        supplier: { select: { businessName: true, taxId: true } },
        paymentOrderItems: { select: { amount: true } },
      },
    });

    const debtMap = new Map<string, { name: string; taxId: string; totalDebt: number; invoiceCount: number }>();

    for (const inv of pendingInvoices) {
      const paid = inv.paymentOrderItems.reduce((sum, poi) => sum + Number(poi.amount), 0);
      const pending = Number(inv.total) - paid;
      if (pending <= 0) continue;

      const existing = debtMap.get(inv.supplierId);
      if (existing) {
        existing.totalDebt += pending;
        existing.invoiceCount += 1;
      } else {
        debtMap.set(inv.supplierId, {
          name: inv.supplier.businessName,
          taxId: inv.supplier.taxId,
          totalDebt: pending,
          invoiceCount: 1,
        });
      }
    }

    return Array.from(debtMap.values())
      .sort((a, b) => b.totalDebt - a.totalDebt)
      .slice(0, limit);
  } catch (error) {
    logger.error('Error al obtener deudas de proveedores', { data: { error, companyId } });
    throw new Error('Error al obtener deudas de proveedores');
  }
}

// ============================================
// TOP 10 PRODUCTOS MÁS VENDIDOS (últimos 30 días)
// ============================================

export async function getTopSellingProducts(limit = 10) {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const thirtyDaysAgo = moment().subtract(30, 'days').toDate();

    const lines = await prisma.salesInvoiceLine.findMany({
      where: {
        invoice: {
          companyId,
          issueDate: { gte: thirtyDaysAgo },
          status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
          voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
        },
      },
      select: {
        productId: true,
        quantity: true,
        total: true,
        product: { select: { code: true, name: true } },
      },
    });

    const productMap = new Map<string, { code: string; name: string; totalQty: number; totalAmount: number }>();

    for (const line of lines) {
      const existing = productMap.get(line.productId);
      const qty = Number(line.quantity);
      const amount = Number(line.total);
      if (existing) {
        existing.totalQty += qty;
        existing.totalAmount += amount;
      } else {
        productMap.set(line.productId, {
          code: line.product.code,
          name: line.product.name,
          totalQty: qty,
          totalAmount: amount,
        });
      }
    }

    return Array.from(productMap.values())
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, limit);
  } catch (error) {
    logger.error('Error al obtener productos más vendidos', { data: { error, companyId } });
    throw new Error('Error al obtener productos más vendidos');
  }
}

// ============================================
// VENTAS SEMANALES (semana actual vs anterior)
// ============================================

export async function getWeeklySalesComparison() {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const currentWeekStart = moment().startOf('isoWeek').toDate();
    const previousWeekStart = moment().subtract(1, 'week').startOf('isoWeek').toDate();
    const currentWeekEnd = moment().endOf('isoWeek').toDate();

    const invoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        issueDate: { gte: previousWeekStart, lte: currentWeekEnd },
        status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
        voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
      },
      select: { issueDate: true, total: true },
    });

    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const result = dayNames.map((day) => ({ day, currentWeek: 0, previousWeek: 0 }));

    for (const inv of invoices) {
      const m = moment(inv.issueDate);
      const dayIndex = m.isoWeekday() - 1; // 0=Lun, 6=Dom
      const total = Number(inv.total);

      if (m.isSameOrAfter(moment(currentWeekStart)) && m.isSameOrBefore(moment(currentWeekEnd))) {
        result[dayIndex].currentWeek += total;
      } else {
        result[dayIndex].previousWeek += total;
      }
    }

    return result;
  } catch (error) {
    logger.error('Error al obtener comparación semanal', { data: { error, companyId } });
    throw new Error('Error al obtener comparación semanal');
  }
}

// ============================================
// MEDIOS DE PAGO DE COBROS
// ============================================

export async function getPaymentMethodBreakdown() {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const thirtyDaysAgo = moment().subtract(30, 'days').toDate();

    const payments = await prisma.receiptPayment.findMany({
      where: {
        receipt: {
          companyId,
          status: 'CONFIRMED',
          date: { gte: thirtyDaysAgo },
        },
      },
      select: { paymentMethod: true, amount: true },
    });

    const methodLabels: Record<string, string> = {
      CASH: 'Efectivo',
      CHECK: 'Cheque',
      TRANSFER: 'Transferencia',
      DEBIT_CARD: 'Tarjeta Débito',
      CREDIT_CARD: 'Tarjeta Crédito',
      ACCOUNT: 'Cuenta Corriente',
    };

    const methodMap = new Map<string, { method: string; total: number; count: number }>();

    for (const p of payments) {
      const label = methodLabels[p.paymentMethod] || p.paymentMethod;
      const existing = methodMap.get(p.paymentMethod);
      if (existing) {
        existing.total += Number(p.amount);
        existing.count += 1;
      } else {
        methodMap.set(p.paymentMethod, {
          method: label,
          total: Number(p.amount),
          count: 1,
        });
      }
    }

    return Array.from(methodMap.values()).sort((a, b) => b.total - a.total);
  } catch (error) {
    logger.error('Error al obtener medios de pago', { data: { error, companyId } });
    throw new Error('Error al obtener medios de pago');
  }
}

// ============================================
// PRÓXIMOS VENCIMIENTOS (30 días)
// ============================================

export async function getUpcomingDueDates(limit = 10) {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('dashboard', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const thirtyDaysFromNow = moment().add(30, 'days').toDate();

    const [salesInvoices, purchaseInvoices] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: {
          companyId,
          status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
          dueDate: { lte: thirtyDaysFromNow },
          voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
        },
        select: {
          fullNumber: true,
          total: true,
          dueDate: true,
          customer: { select: { name: true } },
        },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.purchaseInvoice.findMany({
        where: {
          companyId,
          status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
          dueDate: { lte: thirtyDaysFromNow },
          voucherType: { notIn: ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C'] },
        },
        select: {
          fullNumber: true,
          total: true,
          dueDate: true,
          supplier: { select: { businessName: true } },
        },
        orderBy: { dueDate: 'asc' },
      }),
    ]);

    type DueItem = {
      type: 'sale' | 'purchase';
      number: string;
      entity: string;
      dueDate: Date | null;
      total: number;
      daysUntilDue: number;
    };

    const items: DueItem[] = [];

    for (const inv of salesInvoices) {
      const daysUntilDue = inv.dueDate ? moment(inv.dueDate).diff(moment(), 'days') : 0;
      items.push({
        type: 'sale',
        number: inv.fullNumber,
        entity: inv.customer.name,
        dueDate: inv.dueDate,
        total: Number(inv.total),
        daysUntilDue,
      });
    }

    for (const inv of purchaseInvoices) {
      const daysUntilDue = inv.dueDate ? moment(inv.dueDate).diff(moment(), 'days') : 0;
      items.push({
        type: 'purchase',
        number: inv.fullNumber,
        entity: inv.supplier.businessName,
        dueDate: inv.dueDate,
        total: Number(inv.total),
        daysUntilDue,
      });
    }

    // Ordenar por dueDate asc (más próximos/vencidos primero)
    items.sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.getTime() - b.dueDate.getTime();
    });

    return items.slice(0, limit);
  } catch (error) {
    logger.error('Error al obtener próximos vencimientos', { data: { error, companyId } });
    throw new Error('Error al obtener próximos vencimientos');
  }
}
