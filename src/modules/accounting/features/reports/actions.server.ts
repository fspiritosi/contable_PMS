'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { AccountNature, AccountType, BudgetStatus, JournalEntryStatus } from '@/generated/prisma/enums';
import moment from 'moment';
import {
  calculateAllAccountBalances,
  verifyAccountingEquation,
} from '../../shared/utils/balances';
import { isCreditNote } from '@/modules/commercial/shared/voucher-utils';
import { getActiveCompanyId } from '@/shared/lib/company';
import {
  groupByCostCenter,
  summarizeDrafts,
  sumGroupTotals,
  type CostCenterMovementLine,
} from '../../shared/utils/cost-center-movements';

interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  nature: AccountNature;
  debitTotal: number;
  creditTotal: number;
  balance: number;
}

interface TrialBalanceResult {
  accounts: AccountBalance[];
  totalDebit: number;
  totalCredit: number;
  equation?: {
    isBalanced: boolean;
    assets: number;
    liabilities: number;
    equity: number;
    difference: number;
  };
}

interface JournalBookEntry {
  id: string;
  number: number;
  date: Date;
  description: string;
  status: JournalEntryStatus;
  lines: {
    id: string;
    accountId: string;
    description?: string | null;
    debit: number;
    credit: number;
    account: {
      code: string;
      name: string;
    };
  }[];
}

interface GeneralLedgerAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  nature: AccountNature;
  openingBalance: number;
  entries: {
    date: Date;
    description: string | null;
    debit: number;
    credit: number;
    balance: number;
    entryNumber: number;
  }[];
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

/**
 * Ajusta la fecha de fin para incluir todo el día
 */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Ajusta la fecha de inicio al comienzo del día
 */
function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * Obtiene el balance de sumas y saldos
 */
export async function getTrialBalance(companyId: string, fromDate: Date, toDate: Date) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  try {
    logger.info('Obteniendo balance de sumas y saldos', { data: { companyId, from, to } });

    const accounts = await prisma.account.findMany({
      where: { companyId, isActive: true },
      orderBy: { code: 'asc' },
    });

    const balancesMap = await calculateAllAccountBalances(companyId, to);

    const balances: AccountBalance[] = accounts
      .map((account) => {
        const balance = balancesMap.get(account.id) || { debit: 0, credit: 0, balance: 0 };

        return {
          accountId: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          nature: account.nature,
          debitTotal: balance.debit,
          creditTotal: balance.credit,
          balance: balance.balance,
        };
      })
      .filter((account) => account.debitTotal !== 0 || account.creditTotal !== 0);

    const totalDebit = balances.reduce((sum, account) => sum + account.debitTotal, 0);
    const totalCredit = balances.reduce((sum, account) => sum + account.creditTotal, 0);

    const equation = await verifyAccountingEquation(companyId, to);

    const result = {
      accounts: balances,
      totalDebit,
      totalCredit,
      equation,
    };

    logger.info('Balance calculado', {
      data: {
        accountCount: balances.length,
        totalDebit,
        totalCredit,
        equationBalanced: equation.isBalanced,
      },
    });

    if (!equation.isBalanced) {
      logger.warn('Balance desbalanceado detectado', {
        data: {
          difference: equation.difference,
          assets: equation.assets,
          liabilities: equation.liabilities,
          equity: equation.equity,
        },
      });
    }

    return result;
  } catch (error) {
    logger.error('Error al obtener balance de sumas y saldos', {
      data: { error, companyId, userId },
    });
    throw error;
  }
}

/**
 * Obtiene el libro diario
 */
export async function getJournalBook(companyId: string, fromDate: Date, toDate: Date) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  // Ajustar fechas para incluir todo el rango
  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  try {
    const entries = await prisma.journalEntry.findMany({
      where: {
        companyId,
        status: JournalEntryStatus.POSTED,
        date: {
          gte: from,
          lte: to,
        },
      },
      orderBy: [
        { date: 'asc' },
        { number: 'asc' },
      ],
      include: {
        lines: {
          include: {
            account: {
              select: {
                code: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return entries;
  } catch (error) {
    logger.error('Error al obtener libro diario', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Obtiene el libro mayor
 */
export async function getGeneralLedger(companyId: string, fromDate: Date, toDate: Date) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  try {
    const accounts = await prisma.account.findMany({
      where: { companyId, isActive: true },
      orderBy: { code: 'asc' },
    });

    // Saldo anterior: query única para todos los saldos previos al período
    const beforePeriod = new Date(from);
    beforePeriod.setDate(beforePeriod.getDate() - 1);
    beforePeriod.setHours(23, 59, 59, 999);

    const priorBalances = await prisma.$queryRaw<
      { account_id: string; total_debit: number; total_credit: number }[]
    >`
      SELECT jel.account_id,
             COALESCE(SUM(jel.debit), 0)::float AS total_debit,
             COALESCE(SUM(jel.credit), 0)::float AS total_credit
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.company_id = ${companyId}::uuid
        AND je.status = 'POSTED'
        AND je.date <= ${beforePeriod}
      GROUP BY jel.account_id
    `;

    const priorMap = new Map<string, number>();
    for (const row of priorBalances) {
      priorMap.set(row.account_id, row.total_debit - row.total_credit);
    }

    // Movimientos del período
    const entries = await prisma.journalEntry.findMany({
      where: {
        companyId,
        status: JournalEntryStatus.POSTED,
        date: { gte: from, lte: to },
      },
      orderBy: [{ date: 'asc' }, { number: 'asc' }],
      include: { lines: true },
    });

    const ledger: GeneralLedgerAccount[] = accounts.map((account) => {
      const priorRawBalance = priorMap.get(account.id) ?? 0;
      const openingBalance =
        account.nature === AccountNature.DEBIT ? priorRawBalance : -priorRawBalance;

      const movements = entries
        .filter((entry) => entry.lines.some((line) => line.accountId === account.id))
        .flatMap((entry) =>
          entry.lines
            .filter((line) => line.accountId === account.id)
            .map((line) => ({
              date: entry.date,
              description: entry.description,
              entryNumber: entry.number,
              debit: line.debit,
              credit: line.credit,
            }))
        );

      let balance = openingBalance;
      const processedMovements = movements.map((movement) => {
        const debit = Number(movement.debit);
        const credit = Number(movement.credit);

        if (account.nature === AccountNature.DEBIT) {
          balance += debit - credit;
        } else {
          balance += credit - debit;
        }

        return {
          date: movement.date,
          description: movement.description,
          debit,
          credit,
          balance,
          entryNumber: movement.entryNumber,
        };
      });

      const totalDebit = movements.reduce((sum, m) => sum + Number(m.debit), 0);
      const totalCredit = movements.reduce((sum, m) => sum + Number(m.credit), 0);

      return {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        nature: account.nature,
        openingBalance,
        entries: processedMovements,
        totalDebit,
        totalCredit,
        balance,
      };
    });

    return ledger;
  } catch (error) {
    logger.error('Error al obtener libro mayor', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Balance General (Balance Sheet)
 */
interface BalanceSheetAccount {
  code: string;
  name: string;
  balance: number;
}

interface BalanceSheetSection {
  title: string;
  accounts: BalanceSheetAccount[];
  total: number;
}

interface BalanceSheetResult {
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  periodResult: number;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
  difference: number;
}

/**
 * Obtiene el Balance General (Balance Sheet)
 * Muestra: Activo = Pasivo + Patrimonio Neto
 */
export async function getBalanceSheet(companyId: string, asOfDate: Date) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const date = endOfDay(asOfDate);

  try {
    logger.info('Generando Balance General', { data: { companyId, date } });

    const accounts = await prisma.account.findMany({
      where: { companyId, isActive: true },
      orderBy: { code: 'asc' },
    });

    const balancesMap = await calculateAllAccountBalances(companyId, date);

    const assets: BalanceSheetAccount[] = [];
    const liabilities: BalanceSheetAccount[] = [];
    const equity: BalanceSheetAccount[] = [];
    let revenueTotal = 0;
    let expenseTotal = 0;

    for (const account of accounts) {
      const balance = balancesMap.get(account.id);
      if (!balance || balance.balance === 0) continue;

      const accountData: BalanceSheetAccount = {
        code: account.code,
        name: account.name,
        balance: balance.balance,
      };

      switch (account.type) {
        case AccountType.ASSET:
          assets.push(accountData);
          break;
        case AccountType.LIABILITY:
          liabilities.push(accountData);
          break;
        case AccountType.EQUITY:
          equity.push(accountData);
          break;
        case AccountType.REVENUE:
          // balance = debit - credit; revenue normal es negativo (más créditos)
          revenueTotal += Math.abs(balance.balance);
          break;
        case AccountType.EXPENSE:
          expenseTotal += balance.balance;
          break;
      }
    }

    // Resultado del ejercicio en curso (ingresos - gastos)
    const periodResult = revenueTotal - expenseTotal;

    const totalAssets = assets.reduce((sum, acc) => sum + acc.balance, 0);
    const totalLiabilities = liabilities.reduce((sum, acc) => sum + acc.balance, 0);
    const totalEquity = equity.reduce((sum, acc) => sum + acc.balance, 0);
    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity + periodResult;

    const result: BalanceSheetResult = {
      assets: {
        title: 'Activo',
        accounts: assets,
        total: totalAssets,
      },
      liabilities: {
        title: 'Pasivo',
        accounts: liabilities,
        total: totalLiabilities,
      },
      equity: {
        title: 'Patrimonio Neto',
        accounts: equity,
        total: totalEquity,
      },
      periodResult,
      totalAssets,
      totalLiabilitiesAndEquity,
      isBalanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01,
      difference: totalAssets - totalLiabilitiesAndEquity,
    };

    logger.info('Balance General generado', {
      data: {
        totalAssets,
        totalLiabilitiesAndEquity,
        periodResult,
        isBalanced: result.isBalanced,
      },
    });

    if (!result.isBalanced) {
      logger.warn('Balance General desbalanceado', {
        data: { difference: result.difference },
      });
    }

    return result;
  } catch (error) {
    logger.error('Error al generar Balance General', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Estado de Resultados (Income Statement)
 */
interface IncomeStatementAccount {
  code: string;
  name: string;
  amount: number;
}

interface IncomeStatementSection {
  title: string;
  accounts: IncomeStatementAccount[];
  total: number;
}

interface IncomeStatementResult {
  revenue: IncomeStatementSection;
  expenses: IncomeStatementSection;
  grossProfit: number;
  netIncome: number;
}

/**
 * Obtiene el Estado de Resultados (Income Statement)
 * Muestra: Ingresos - Gastos = Resultado del Período
 */
export async function getIncomeStatement(companyId: string, fromDate: Date, toDate: Date) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  try {
    logger.info('Generando Estado de Resultados', { data: { companyId, from, to } });

    // Obtener cuentas de ingresos y gastos
    const accounts = await prisma.account.findMany({
      where: {
        companyId,
        isActive: true,
        type: {
          in: [AccountType.REVENUE, AccountType.EXPENSE],
        },
      },
      orderBy: { code: 'asc' },
    });

    // Calcular movimientos en el período
    const entries = await prisma.journalEntry.findMany({
      where: {
        companyId,
        status: JournalEntryStatus.POSTED,
        date: {
          gte: from,
          lte: to,
        },
      },
      include: {
        lines: true,
      },
    });

    // Calcular saldos por cuenta en el período
    const revenue: IncomeStatementAccount[] = [];
    const expenses: IncomeStatementAccount[] = [];

    for (const account of accounts) {
      const movements = entries.flatMap(entry => entry.lines)
        .filter(line => line.accountId === account.id);

      if (movements.length === 0) continue;

      const debitTotal = movements.reduce((sum, line) => sum + Number(line.debit), 0);
      const creditTotal = movements.reduce((sum, line) => sum + Number(line.credit), 0);

      // Para ingresos (REVENUE): crédito aumenta, débito disminuye
      // Para gastos (EXPENSE): débito aumenta, crédito disminuye
      const amount = account.type === AccountType.REVENUE
        ? creditTotal - debitTotal
        : debitTotal - creditTotal;

      if (amount === 0) continue;

      const accountData: IncomeStatementAccount = {
        code: account.code,
        name: account.name,
        amount,
      };

      if (account.type === AccountType.REVENUE) {
        revenue.push(accountData);
      } else {
        expenses.push(accountData);
      }
    }

    // Calcular totales
    const totalRevenue = revenue.reduce((sum, acc) => sum + acc.amount, 0);
    const totalExpenses = expenses.reduce((sum, acc) => sum + acc.amount, 0);
    const netIncome = totalRevenue - totalExpenses;

    const result: IncomeStatementResult = {
      revenue: {
        title: 'Ingresos',
        accounts: revenue,
        total: totalRevenue,
      },
      expenses: {
        title: 'Gastos',
        accounts: expenses,
        total: totalExpenses,
      },
      grossProfit: totalRevenue,
      netIncome,
    };

    logger.info('Estado de Resultados generado', {
      data: {
        totalRevenue,
        totalExpenses,
        netIncome,
      }
    });

    return result;
  } catch (error) {
    logger.error('Error al generar Estado de Resultados', { data: { error, companyId, userId } });
    throw error;
  }
}

// ==========================================
// REPORTES DE AUDITORÍA
// ==========================================

/**
 * Obtiene asientos sin respaldo documental
 * (no vinculados a ningún documento comercial ni reversiones)
 */
export async function getEntriesWithoutDocuments(
  companyId: string,
  fromDate: Date,
  toDate: Date
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  try {
    logger.info('Obteniendo asientos sin respaldo', { data: { companyId, from, to } });

    const entries = await prisma.journalEntry.findMany({
      where: {
        companyId,
        date: { gte: from, lte: to },
        originalEntryId: null,
        salesInvoices: { none: {} },
        purchaseInvoices: { none: {} },
        receipts: { none: {} },
        paymentOrders: { none: {} },
      },
      orderBy: [{ date: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        date: true,
        description: true,
        status: true,
        createdBy: true,
        createdAt: true,
        lines: {
          select: {
            debit: true,
            credit: true,
          },
        },
      },
    });

    return entries.map(entry => ({
      ...entry,
      totalDebit: entry.lines.reduce((sum, l) => sum + Number(l.debit), 0),
      totalCredit: entry.lines.reduce((sum, l) => sum + Number(l.credit), 0),
    }));
  } catch (error) {
    logger.error('Error al obtener asientos sin respaldo', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Obtiene el registro de reversiones (asientos anulados)
 */
export async function getReversalLog(
  companyId: string,
  fromDate: Date,
  toDate: Date
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  try {
    logger.info('Obteniendo registro de reversiones', { data: { companyId, from, to } });

    const entries = await prisma.journalEntry.findMany({
      where: {
        companyId,
        status: JournalEntryStatus.REVERSED,
        reversedAt: { gte: from, lte: to },
      },
      orderBy: { reversedAt: 'desc' },
      select: {
        id: true,
        number: true,
        date: true,
        description: true,
        reversedBy: true,
        reversedAt: true,
        reversalEntry: {
          select: {
            id: true,
            number: true,
            date: true,
          },
        },
        lines: {
          select: {
            debit: true,
            credit: true,
          },
        },
      },
    });

    return entries.map(entry => ({
      ...entry,
      totalAmount: entry.lines.reduce((sum, l) => sum + Number(l.debit), 0),
    }));
  } catch (error) {
    logger.error('Error al obtener registro de reversiones', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Obtiene la trazabilidad documento-asiento
 * Cruza documentos comerciales con sus asientos contables
 */
export async function getDocumentEntryTraceability(
  companyId: string,
  fromDate: Date,
  toDate: Date,
  documentType?: 'sales_invoice' | 'purchase_invoice' | 'receipt' | 'payment_order'
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  try {
    logger.info('Obteniendo trazabilidad documento-asiento', { data: { companyId, from, to, documentType } });

    type TraceabilityItem = {
      documentType: string;
      documentId: string;
      fullNumber: string;
      date: Date;
      total: number;
      status: string;
      entryNumber: number | null;
      entryId: string | null;
      entryDate: Date | null;
      entryStatus: string | null;
      hasEntry: boolean;
    };

    const results: TraceabilityItem[] = [];

    if (!documentType || documentType === 'sales_invoice') {
      const invoices = await prisma.salesInvoice.findMany({
        where: {
          companyId,
          issueDate: { gte: from, lte: to },
        },
        select: {
          id: true,
          fullNumber: true,
          issueDate: true,
          total: true,
          status: true,
          journalEntry: {
            select: { id: true, number: true, date: true, status: true },
          },
        },
        orderBy: { issueDate: 'asc' },
      });

      for (const inv of invoices) {
        results.push({
          documentType: 'Factura Venta',
          documentId: inv.id,
          fullNumber: inv.fullNumber,
          date: inv.issueDate,
          total: Number(inv.total),
          status: inv.status,
          entryNumber: inv.journalEntry?.number ?? null,
          entryId: inv.journalEntry?.id ?? null,
          entryDate: inv.journalEntry?.date ?? null,
          entryStatus: inv.journalEntry?.status ?? null,
          hasEntry: !!inv.journalEntry,
        });
      }
    }

    if (!documentType || documentType === 'purchase_invoice') {
      const invoices = await prisma.purchaseInvoice.findMany({
        where: {
          companyId,
          issueDate: { gte: from, lte: to },
        },
        select: {
          id: true,
          fullNumber: true,
          issueDate: true,
          total: true,
          status: true,
          journalEntry: {
            select: { id: true, number: true, date: true, status: true },
          },
        },
        orderBy: { issueDate: 'asc' },
      });

      for (const inv of invoices) {
        results.push({
          documentType: 'Factura Compra',
          documentId: inv.id,
          fullNumber: inv.fullNumber,
          date: inv.issueDate,
          total: Number(inv.total),
          status: inv.status,
          entryNumber: inv.journalEntry?.number ?? null,
          entryId: inv.journalEntry?.id ?? null,
          entryDate: inv.journalEntry?.date ?? null,
          entryStatus: inv.journalEntry?.status ?? null,
          hasEntry: !!inv.journalEntry,
        });
      }
    }

    if (!documentType || documentType === 'receipt') {
      const recs = await prisma.receipt.findMany({
        where: {
          companyId,
          date: { gte: from, lte: to },
        },
        select: {
          id: true,
          fullNumber: true,
          date: true,
          totalAmount: true,
          status: true,
          journalEntry: {
            select: { id: true, number: true, date: true, status: true },
          },
        },
        orderBy: { date: 'asc' },
      });

      for (const rec of recs) {
        results.push({
          documentType: 'Recibo',
          documentId: rec.id,
          fullNumber: rec.fullNumber,
          date: rec.date,
          total: Number(rec.totalAmount),
          status: rec.status,
          entryNumber: rec.journalEntry?.number ?? null,
          entryId: rec.journalEntry?.id ?? null,
          entryDate: rec.journalEntry?.date ?? null,
          entryStatus: rec.journalEntry?.status ?? null,
          hasEntry: !!rec.journalEntry,
        });
      }
    }

    if (!documentType || documentType === 'payment_order') {
      const orders = await prisma.paymentOrder.findMany({
        where: {
          companyId,
          date: { gte: from, lte: to },
        },
        select: {
          id: true,
          fullNumber: true,
          date: true,
          totalAmount: true,
          status: true,
          journalEntry: {
            select: { id: true, number: true, date: true, status: true },
          },
        },
        orderBy: { date: 'asc' },
      });

      for (const order of orders) {
        results.push({
          documentType: 'Orden de Pago',
          documentId: order.id,
          fullNumber: order.fullNumber,
          date: order.date,
          total: Number(order.totalAmount),
          status: order.status,
          entryNumber: order.journalEntry?.number ?? null,
          entryId: order.journalEntry?.id ?? null,
          entryDate: order.journalEntry?.date ?? null,
          entryStatus: order.journalEntry?.status ?? null,
          hasEntry: !!order.journalEntry,
        });
      }
    }

    results.sort((a, b) => a.date.getTime() - b.date.getTime());

    return results;
  } catch (error) {
    logger.error('Error al obtener trazabilidad', { data: { error, companyId, userId } });
    throw error;
  }
}

// ============================================
// REPORTE: Registro de Bienes de Uso
// ============================================

export async function getFixedAssetsRegister(companyId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  try {
    const vehicles = await prisma.vehicle.findMany({
      where: {
        companyId,
        depreciation: { isNot: null },
      },
      select: {
        id: true,
        internNumber: true,
        domain: true,
        year: true,
        isActive: true,
        type: { select: { name: true } },
        brand: { select: { name: true } },
        model: { select: { name: true } },
        depreciation: {
          select: {
            method: true,
            status: true,
            grossValue: true,
            salvageValue: true,
            currentBookValue: true,
            totalDepreciated: true,
            usefulLifeMonths: true,
            startDate: true,
            endDate: true,
          },
        },
      },
      orderBy: { internNumber: 'asc' },
    });

    const items = vehicles.map((v) => {
      const dep = v.depreciation!;
      const grossValue = Number(dep.grossValue);
      const totalDepreciated = Number(dep.totalDepreciated);
      const currentBookValue = Number(dep.currentBookValue);
      const percentDepreciated = grossValue > 0 ? Math.round((totalDepreciated / grossValue) * 100) : 0;

      return {
        vehicleId: v.id,
        internNumber: v.internNumber,
        domain: v.domain,
        year: v.year,
        typeName: v.type?.name ?? null,
        brandName: v.brand?.name ?? null,
        modelName: v.model?.name ?? null,
        isActive: v.isActive,
        method: dep.method,
        status: dep.status,
        grossValue,
        salvageValue: Number(dep.salvageValue),
        totalDepreciated,
        currentBookValue,
        usefulLifeMonths: dep.usefulLifeMonths,
        startDate: dep.startDate,
        endDate: dep.endDate,
        percentDepreciated,
      };
    });

    const totals = {
      grossValue: items.reduce((sum, i) => sum + i.grossValue, 0),
      totalDepreciated: items.reduce((sum, i) => sum + i.totalDepreciated, 0),
      currentBookValue: items.reduce((sum, i) => sum + i.currentBookValue, 0),
    };

    return { items, totals, count: items.length };
  } catch (error) {
    logger.error('Error al obtener registro de bienes de uso', { data: { error, companyId, userId } });
    throw error;
  }
}

// ============================================
// REPORTE: Depreciaciones del Período
// ============================================

export async function getPeriodDepreciations(companyId: string, fromDate: Date, toDate: Date) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  try {
    const from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    const entries = await prisma.depreciationScheduleEntry.findMany({
      where: {
        isPosted: true,
        postedDate: { gte: from, lte: to },
        depreciation: {
          companyId,
        },
      },
      select: {
        periodNumber: true,
        scheduledDate: true,
        amount: true,
        accumulatedAmount: true,
        postedDate: true,
        journalEntry: {
          select: { id: true, number: true },
        },
        depreciation: {
          select: {
            vehicle: {
              select: {
                id: true,
                internNumber: true,
                domain: true,
                type: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: [{ postedDate: 'asc' }, { periodNumber: 'asc' }],
    });

    const items = entries.map((e) => ({
      vehicleId: e.depreciation.vehicle.id,
      vehicleLabel: e.depreciation.vehicle.internNumber || e.depreciation.vehicle.domain || '-',
      typeName: e.depreciation.vehicle.type?.name ?? null,
      periodNumber: e.periodNumber,
      scheduledDate: e.scheduledDate,
      amount: Number(e.amount),
      accumulatedAmount: Number(e.accumulatedAmount),
      postedDate: e.postedDate,
      entryNumber: e.journalEntry?.number ?? null,
      entryId: e.journalEntry?.id ?? null,
    }));

    const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);
    const vehicleCount = new Set(items.map((i) => i.vehicleId)).size;

    return { items, totalAmount: Math.round(totalAmount * 100) / 100, vehicleCount, count: items.length };
  } catch (error) {
    logger.error('Error al obtener depreciaciones del período', { data: { error, companyId, userId } });
    throw error;
  }
}

// ============================================
// REPORTE: Variación Presupuestaria
// ============================================

interface BudgetVarianceAccount {
  code: string;
  name: string;
  budgeted: number;
  executed: number;
  variance: number;
  variancePercent: number;
}

interface BudgetVarianceSection {
  accounts: BudgetVarianceAccount[];
  totalBudgeted: number;
  totalExecuted: number;
  totalVariance: number;
  totalVariancePercent: number;
}

interface BudgetVarianceResult {
  revenue: BudgetVarianceSection;
  expenses: BudgetVarianceSection;
  netBudgeted: number;
  netExecuted: number;
  netVariance: number;
  netVariancePercent: number;
  fiscalYear: number;
}

/**
 * Genera el reporte de variación presupuestaria.
 * Obtiene todos los presupuestos ACTIVE/CLOSED del año fiscal,
 * calcula el ejecutado acumulado de cada cuenta, y retorna
 * la comparación separada en REVENUE y EXPENSE.
 */
export async function getBudgetVarianceReport(
  companyId: string,
  fiscalYear: number
): Promise<BudgetVarianceResult> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  try {
    logger.info('Generando reporte de variación presupuestaria', {
      data: { companyId, fiscalYear },
    });

    // Obtener settings para calcular rango fiscal
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: { fiscalYearStart: true, fiscalYearEnd: true },
    });

    if (!settings) {
      throw new Error('La empresa no tiene configuración contable');
    }

    // Calcular las fechas de inicio y fin del año fiscal
    const fiscalStartMonth = moment(settings.fiscalYearStart).month();
    const fiscalStartDay = moment(settings.fiscalYearStart).date();
    const fiscalYearStartDate = moment()
      .year(fiscalYear)
      .month(fiscalStartMonth)
      .date(fiscalStartDay)
      .startOf('day')
      .toDate();

    const fiscalYearEndDate = moment(fiscalYearStartDate)
      .add(1, 'year')
      .subtract(1, 'day')
      .endOf('day')
      .toDate();

    // Obtener todos los presupuestos ACTIVE o CLOSED del año fiscal
    const budgets = await prisma.budget.findMany({
      where: {
        companyId,
        fiscalYear,
        status: { in: [BudgetStatus.ACTIVE, BudgetStatus.CLOSED] },
      },
      select: {
        id: true,
        accountId: true,
        totalAmount: true,
        monthlyAmounts: true,
        account: {
          select: {
            code: true,
            name: true,
            type: true,
            nature: true,
          },
        },
      },
      orderBy: { account: { code: 'asc' } },
    });

    if (budgets.length === 0) {
      return {
        revenue: buildEmptySection(),
        expenses: buildEmptySection(),
        netBudgeted: 0,
        netExecuted: 0,
        netVariance: 0,
        netVariancePercent: 0,
        fiscalYear,
      };
    }

    // Obtener el ejecutado de todas las cuentas con presupuesto en una sola query
    const accountIds = budgets.map((b) => b.accountId);

    const executionResults = await prisma.$queryRaw<
      {
        account_id: string;
        total_debit: Prisma.Decimal;
        total_credit: Prisma.Decimal;
      }[]
    >`
      SELECT
        jel.account_id,
        COALESCE(SUM(jel.debit), 0) AS total_debit,
        COALESCE(SUM(jel.credit), 0) AS total_credit
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.entry_id = je.id
      WHERE jel.account_id = ANY(${accountIds}::uuid[])
        AND je.company_id = ${companyId}::uuid
        AND je.status = 'POSTED'
        AND je.date >= ${fiscalYearStartDate}
        AND je.date <= ${fiscalYearEndDate}
      GROUP BY jel.account_id
    `;

    // Crear mapa de ejecutado por cuenta
    const executionMap = new Map<string, { debit: number; credit: number }>();
    for (const row of executionResults) {
      executionMap.set(row.account_id, {
        debit: Number(row.total_debit),
        credit: Number(row.total_credit),
      });
    }

    // Construir datos por sección
    const revenueAccounts: BudgetVarianceAccount[] = [];
    const expenseAccounts: BudgetVarianceAccount[] = [];

    for (const budget of budgets) {
      const budgeted = Number(budget.totalAmount);
      const execution = executionMap.get(budget.accountId) || {
        debit: 0,
        credit: 0,
      };

      // Calcular ejecutado según naturaleza de la cuenta
      // EXPENSE (DEBIT nature): ejecutado = debit - credit
      // REVENUE (CREDIT nature): ejecutado = credit - debit
      const executed =
        budget.account.nature === AccountNature.DEBIT
          ? execution.debit - execution.credit
          : execution.credit - execution.debit;

      const variance = budgeted - executed;
      const variancePercent =
        budgeted === 0
          ? executed === 0
            ? 0
            : -100
          : ((budgeted - executed) / budgeted) * 100;

      const accountData: BudgetVarianceAccount = {
        code: budget.account.code,
        name: budget.account.name,
        budgeted,
        executed,
        variance,
        variancePercent,
      };

      if (budget.account.type === AccountType.REVENUE) {
        revenueAccounts.push(accountData);
      } else {
        expenseAccounts.push(accountData);
      }
    }

    // Calcular totales por sección
    const revenue = buildSection(revenueAccounts);
    const expenses = buildSection(expenseAccounts);

    // Resultado neto
    const netBudgeted = revenue.totalBudgeted - expenses.totalBudgeted;
    const netExecuted = revenue.totalExecuted - expenses.totalExecuted;
    const netVariance = netBudgeted - netExecuted;
    const netVariancePercent =
      netBudgeted === 0
        ? netExecuted === 0
          ? 0
          : -100
        : ((netBudgeted - netExecuted) / Math.abs(netBudgeted)) * 100;

    logger.info('Reporte de variación presupuestaria generado', {
      data: {
        fiscalYear,
        revenueAccounts: revenueAccounts.length,
        expenseAccounts: expenseAccounts.length,
        netBudgeted,
        netExecuted,
      },
    });

    return {
      revenue,
      expenses,
      netBudgeted,
      netExecuted,
      netVariance,
      netVariancePercent,
      fiscalYear,
    };
  } catch (error) {
    logger.error('Error al generar reporte de variación presupuestaria', {
      data: { error, companyId, fiscalYear, userId },
    });
    throw error;
  }
}

function buildSection(accounts: BudgetVarianceAccount[]): BudgetVarianceSection {
  const totalBudgeted = accounts.reduce((sum, a) => sum + a.budgeted, 0);
  const totalExecuted = accounts.reduce((sum, a) => sum + a.executed, 0);
  const totalVariance = totalBudgeted - totalExecuted;
  const totalVariancePercent =
    totalBudgeted === 0
      ? totalExecuted === 0
        ? 0
        : -100
      : ((totalBudgeted - totalExecuted) / totalBudgeted) * 100;

  return {
    accounts,
    totalBudgeted,
    totalExecuted,
    totalVariance,
    totalVariancePercent,
  };
}

function buildEmptySection(): BudgetVarianceSection {
  return {
    accounts: [],
    totalBudgeted: 0,
    totalExecuted: 0,
    totalVariance: 0,
    totalVariancePercent: 0,
  };
}

// ============================================
// REPORTE: IVA Mensual (Débito Fiscal - Crédito Fiscal)
// ============================================

interface VATRateSummary {
  rate: number;
  salesBase: number;
  salesVAT: number;
  purchasesBase: number;
  purchasesVAT: number;
  balance: number;
}

interface MonthlyVATResult {
  month: number;
  year: number;
  salesSummary: {
    subtotal: number;
    vatAmount: number;
    total: number;
    invoiceCount: number;
  };
  purchasesSummary: {
    subtotal: number;
    vatAmount: number;
    total: number;
    invoiceCount: number;
  };
  vatByRate: VATRateSummary[];
  totalSalesVAT: number;
  totalPurchasesVAT: number;
  vatBalance: number;
}

/**
 * Genera el reporte de IVA mensual.
 * Calcula IVA Débito Fiscal (Ventas) - IVA Crédito Fiscal (Compras)
 * para determinar la posición de IVA del mes.
 */
export async function getMonthlyVATReport(
  companyId: string,
  year: number,
  month: number
): Promise<MonthlyVATResult> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  try {
    logger.info('Generando reporte de IVA mensual', { data: { companyId, year, month } });

    const startDate = moment({ year, month }).startOf('month').toDate();
    const endDate = moment({ year, month }).endOf('month').toDate();

    // Obtener facturas de venta confirmadas del mes
    const salesInvoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        issueDate: { gte: startDate, lte: endDate },
        status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
      },
      select: {
        voucherType: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        lines: {
          select: {
            vatRate: true,
            subtotal: true,
            vatAmount: true,
          },
        },
      },
    });

    // Obtener facturas de compra confirmadas del mes
    const purchaseInvoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        issueDate: { gte: startDate, lte: endDate },
        status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
      },
      select: {
        voucherType: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        lines: {
          select: {
            vatRate: true,
            subtotal: true,
            vatAmount: true,
          },
        },
      },
    });

    // Calcular totales de ventas (NC restan, facturas y ND suman)
    const salesSummary = {
      subtotal: salesInvoices.reduce((sum, inv) => {
        const sign = isCreditNote(inv.voucherType) ? -1 : 1;
        return sum + Number(inv.subtotal) * sign;
      }, 0),
      vatAmount: salesInvoices.reduce((sum, inv) => {
        const sign = isCreditNote(inv.voucherType) ? -1 : 1;
        return sum + Number(inv.vatAmount) * sign;
      }, 0),
      total: salesInvoices.reduce((sum, inv) => {
        const sign = isCreditNote(inv.voucherType) ? -1 : 1;
        return sum + Number(inv.total) * sign;
      }, 0),
      invoiceCount: salesInvoices.length,
    };

    // Calcular totales de compras (NC restan, facturas y ND suman)
    const purchasesSummary = {
      subtotal: purchaseInvoices.reduce((sum, inv) => {
        const sign = isCreditNote(inv.voucherType) ? -1 : 1;
        return sum + Number(inv.subtotal) * sign;
      }, 0),
      vatAmount: purchaseInvoices.reduce((sum, inv) => {
        const sign = isCreditNote(inv.voucherType) ? -1 : 1;
        return sum + Number(inv.vatAmount) * sign;
      }, 0),
      total: purchaseInvoices.reduce((sum, inv) => {
        const sign = isCreditNote(inv.voucherType) ? -1 : 1;
        return sum + Number(inv.total) * sign;
      }, 0),
      invoiceCount: purchaseInvoices.length,
    };

    // Agrupar IVA por alícuota (con signo para NC)
    const rateMap = new Map<number, { salesBase: number; salesVAT: number; purchasesBase: number; purchasesVAT: number }>();

    for (const inv of salesInvoices) {
      const sign = isCreditNote(inv.voucherType) ? -1 : 1;
      for (const line of inv.lines) {
        const rate = Number(line.vatRate);
        const existing = rateMap.get(rate) || { salesBase: 0, salesVAT: 0, purchasesBase: 0, purchasesVAT: 0 };
        existing.salesBase += Number(line.subtotal) * sign;
        existing.salesVAT += Number(line.vatAmount) * sign;
        rateMap.set(rate, existing);
      }
    }

    for (const inv of purchaseInvoices) {
      const sign = isCreditNote(inv.voucherType) ? -1 : 1;
      for (const line of inv.lines) {
        const rate = Number(line.vatRate);
        const existing = rateMap.get(rate) || { salesBase: 0, salesVAT: 0, purchasesBase: 0, purchasesVAT: 0 };
        existing.purchasesBase += Number(line.subtotal) * sign;
        existing.purchasesVAT += Number(line.vatAmount) * sign;
        rateMap.set(rate, existing);
      }
    }

    const vatByRate: VATRateSummary[] = Array.from(rateMap.entries())
      .map(([rate, data]) => ({
        rate,
        salesBase: data.salesBase,
        salesVAT: data.salesVAT,
        purchasesBase: data.purchasesBase,
        purchasesVAT: data.purchasesVAT,
        balance: data.salesVAT - data.purchasesVAT,
      }))
      .sort((a, b) => b.rate - a.rate);

    const totalSalesVAT = salesSummary.vatAmount;
    const totalPurchasesVAT = purchasesSummary.vatAmount;
    const vatBalance = totalSalesVAT - totalPurchasesVAT;

    logger.info('Reporte de IVA mensual generado', {
      data: {
        year,
        month,
        salesInvoiceCount: salesSummary.invoiceCount,
        purchaseInvoiceCount: purchasesSummary.invoiceCount,
        totalSalesVAT,
        totalPurchasesVAT,
        vatBalance,
      },
    });

    return {
      month,
      year,
      salesSummary,
      purchasesSummary,
      vatByRate,
      totalSalesVAT,
      totalPurchasesVAT,
      vatBalance,
    };
  } catch (error) {
    logger.error('Error al generar reporte de IVA mensual', { data: { error, companyId, year, month, userId } });
    throw error;
  }
}

/**
 * Movimientos por Centro de Costo (TSK-719).
 *
 * "Entradas y salidas" de cada centro: las líneas de asiento imputadas a él,
 * clasificadas por `Account.nature` y firmadas por Debe/Haber en el helper puro
 * `shared/utils/cost-center-movements.ts` (ahí vive la regla y sus tests).
 *
 * Decisiones de esta action:
 * - **Una sola query con `status IN (DRAFT, POSTED)`** y el corte por estado en
 *   memoria: las POSTED arman el reporte y las DRAFT el aviso, así los números
 *   del aviso no pueden discrepar de los de la tabla y activar "Incluir
 *   borradores" no dispara otra consulta. `REVERSED` nunca entra.
 * - El bucket "(Sin centro de costo)" se restringe a cuentas de RESULTADO: sin
 *   eso, toda línea de caja, banco, IVA y cuentas corrientes caería adentro y
 *   el informe sería ilegible. Los centros CON nombre no filtran por tipo.
 * - Se valida que el `companyId` que manda el cliente sea el de la empresa
 *   activa. Los reportes viejos no lo hacen (agujero anotado como seguimiento);
 *   el código nuevo no repite el error.
 */
export async function getCostCenterMovements(
  companyId: string,
  filters: {
    costCenterId: string | 'all' | 'none';
    fromDate: Date;
    toDate: Date;
    includeDrafts: boolean;
  }
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const activeCompanyId = await getActiveCompanyId();
  if (companyId !== activeCompanyId) throw new Error('Empresa inválida');

  const from = startOfDay(filters.fromDate);
  const to = endOfDay(filters.toDate);

  const resultAccounts = { type: { in: [AccountType.REVENUE, AccountType.EXPENSE] } };
  const costCenterWhere: Prisma.JournalEntryLineWhereInput =
    filters.costCenterId === 'all'
      ? { OR: [{ costCenterId: { not: null } }, { costCenterId: null, account: resultAccounts }] }
      : filters.costCenterId === 'none'
        ? { costCenterId: null, account: resultAccounts }
        : { costCenterId: filters.costCenterId };

  try {
    const lines = await prisma.journalEntryLine.findMany({
      where: {
        entry: {
          companyId,
          status: { in: [JournalEntryStatus.DRAFT, JournalEntryStatus.POSTED] },
          date: { gte: from, lte: to },
        },
        ...costCenterWhere,
      },
      select: {
        id: true,
        description: true,
        debit: true,
        credit: true,
        costCenterId: true,
        costCenter: { select: { name: true } },
        entry: { select: { id: true, number: true, date: true, description: true, status: true } },
        account: { select: { code: true, name: true, nature: true } },
      },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
    });

    // Decimal → Number acá (regla 9): el helper y el Client Component trabajan
    // siempre con `number`.
    const movements: CostCenterMovementLine[] = lines.map((line) => ({
      lineId: line.id,
      entryId: line.entry.id,
      entryNumber: line.entry.number,
      date: line.entry.date,
      entryDescription: line.entry.description,
      lineDescription: line.description,
      status: line.entry.status === JournalEntryStatus.DRAFT ? 'DRAFT' : 'POSTED',
      accountCode: line.account.code,
      accountName: line.account.name,
      accountNature: line.account.nature === AccountNature.DEBIT ? 'DEBIT' : 'CREDIT',
      debit: Number(line.debit),
      credit: Number(line.credit),
      costCenterId: line.costCenterId,
      costCenterName: line.costCenter?.name ?? null,
    }));

    const drafts = movements.filter((movement) => movement.status === 'DRAFT');
    const posted = movements.filter((movement) => movement.status === 'POSTED');

    const groups = groupByCostCenter(filters.includeDrafts ? movements : posted);
    const draftsExcluded = filters.includeDrafts
      ? { entryCount: 0, saldo: 0 }
      : summarizeDrafts(drafts);

    return {
      groups,
      totals: sumGroupTotals(groups),
      draftsExcluded,
      includeDrafts: filters.includeDrafts,
    };
  } catch (error) {
    logger.error('Error al obtener movimientos por centro de costo', {
      data: { error, companyId, filters, userId },
    });
    throw error;
  }
}

export type CostCenterMovementsResult = Awaited<ReturnType<typeof getCostCenterMovements>>;

/**
 * Centros de costo para el selector del informe: los activos **más** los
 * inactivos que conservan movimientos, porque el borrado es lógico y si no
 * el histórico de un centro dado de baja se vuelve inalcanzable.
 *
 * No se reusa `getCostCentersForSelect` de `company/features/cost-centers`:
 * filtra `isActive: true`, no verifica permisos y está compartido por tres
 * módulos; además accounting no puede importar de company
 * (`module-communication.md`).
 */
export async function getCostCentersForMovementsReport(companyId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const activeCompanyId = await getActiveCompanyId();
  if (companyId !== activeCompanyId) throw new Error('Empresa inválida');

  try {
    return await prisma.costCenter.findMany({
      where: { companyId, OR: [{ isActive: true }, { journalEntryLines: { some: {} } }] },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener centros de costo del informe de movimientos', {
      data: { error, companyId, userId },
    });
    throw error;
  }
}

export type CostCenterOption = Awaited<ReturnType<typeof getCostCentersForMovementsReport>>[number];
