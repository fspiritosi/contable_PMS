'use server';

import { auth } from '@clerk/nextjs/server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import moment from 'moment';
import { checkPermission } from '@/shared/lib/permissions';

// ============================================
// TIPOS
// ============================================

export type Granularity = 'daily' | 'weekly' | 'monthly';

export interface CashflowDetailItem {
  label: string;
  amount: number;
}

export interface CashflowRow {
  period: string;
  periodLabel: string;
  inflows: number;
  outflows: number;
  net: number;
  projectedBalance: number;
  details: {
    receipts: number;
    receiptsItems: CashflowDetailItem[];
    paymentOrders: number;
    paymentOrdersItems: CashflowDetailItem[];
    purchaseOrders: number;
    purchaseOrdersItems: CashflowDetailItem[];
    expenses: number;
    expensesItems: CashflowDetailItem[];
    checksIn: number;
    checksInItems: CashflowDetailItem[];
    checksOut: number;
    checksOutItems: CashflowDetailItem[];
    projectionsIn: number;
    projectionsInItems: CashflowDetailItem[];
    projectionsOut: number;
    projectionsOutItems: CashflowDetailItem[];
  };
}

export interface CashflowSummary {
  currentBalance: number;
  totalProjectedInflows: number;
  totalProjectedOutflows: number;
  endingProjectedBalance: number;
  checksInPortfolio: { count: number; total: number };
  overdueReceivables: { count: number; total: number };
  overduePayables: { count: number; total: number };
}

export interface CashflowData {
  rows: CashflowRow[];
  summary: CashflowSummary;
  granularity: Granularity;
}

// ============================================
// ACCIÓN PRINCIPAL
// ============================================

export async function getCashflowData(
  granularity: Granularity = 'weekly',
  startMonth?: string,
): Promise<CashflowData> {
  await checkPermission('commercial.treasury.cashflow', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // startDate SIEMPRE es hoy para que el saldo proyectado sea acumulativo desde hoy
    const today = moment();
    const startDate = today.clone().startOf('day').toDate();

    // El anchor controla desde dónde se generan los buckets visuales
    const anchor = startMonth
      ? moment.utc(startMonth, 'YYYY-MM').startOf('month')
      : moment();
    const now = anchor;

    // endDate se calcula desde el anchor (mes que está mirando el usuario)
    let endDate: Date;
    switch (granularity) {
      case 'daily':
        endDate = now.clone().add(30, 'days').endOf('day').toDate();
        break;
      case 'weekly':
        endDate = now.clone().add(13, 'weeks').endOf('day').toDate();
        break;
      case 'monthly':
        endDate = now.clone().add(12, 'months').endOf('day').toDate();
        break;
    }

    // 1. Consultar todas las fuentes en paralelo
    const [
      draftReceipts,
      draftPaymentOrders,
      approvedPurchaseOrders,
      approvedPOInstallments,
      pendingExpenses,
      checksThirdParty,
      checksOwn,
      projections,
      bankAccounts,
      openSessions,
    ] = await Promise.all([
      // Recibos de cobro en borrador (ingresos proyectados)
      prisma.receipt.findMany({
        where: {
          companyId,
          status: 'DRAFT',
          date: { gte: startDate, lte: endDate },
        },
        select: {
          id: true,
          date: true,
          totalAmount: true,
          fullNumber: true,
          customer: { select: { name: true } },
        },
      }),
      // Órdenes de pago en borrador (egresos proyectados)
      prisma.paymentOrder.findMany({
        where: {
          companyId,
          status: 'DRAFT',
          date: { gte: startDate, lte: endDate },
        },
        select: {
          id: true,
          date: true,
          totalAmount: true,
          fullNumber: true,
          supplier: { select: { tradeName: true, businessName: true } },
        },
      }),
      // Órdenes de compra aprobadas SIN cuotas - saldo no facturado
      prisma.purchaseOrder.findMany({
        where: {
          companyId,
          status: { in: ['APPROVED', 'PARTIALLY_RECEIVED', 'COMPLETED'] },
          invoicingStatus: { not: 'FULLY_INVOICED' },
          expectedDeliveryDate: { gte: startDate, lte: endDate },
          installments: { none: {} },
        },
        select: {
          id: true,
          expectedDeliveryDate: true,
          total: true,
          fullNumber: true,
          supplier: { select: { tradeName: true, businessName: true } },
          purchaseInvoices: {
            where: { status: { not: 'CANCELLED' } },
            select: { total: true },
          },
        },
      }),
      // Cuotas de OC aprobadas PENDING (egresos distribuidos)
      prisma.purchaseOrderInstallment.findMany({
        where: {
          companyId,
          status: 'PENDING',
          dueDate: { gte: startDate, lte: endDate },
          order: { status: { in: ['APPROVED', 'PARTIALLY_RECEIVED', 'COMPLETED'] } },
        },
        select: {
          id: true,
          dueDate: true,
          amount: true,
          number: true,
          order: {
            select: {
              fullNumber: true,
              supplier: { select: { tradeName: true, businessName: true } },
            },
          },
        },
      }),
      // Gastos pendientes (excluir los que tienen OP en borrador para evitar doble conteo)
      prisma.expense.findMany({
        where: {
          companyId,
          status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
          dueDate: { gte: startDate, lte: endDate },
          paymentOrderItems: {
            none: {
              paymentOrder: { status: 'DRAFT' },
            },
          },
        },
        select: {
          id: true,
          dueDate: true,
          amount: true,
          fullNumber: true,
          description: true,
        },
      }),
      // Cheques de terceros en cartera (ingresos)
      prisma.check.findMany({
        where: {
          companyId,
          type: 'THIRD_PARTY',
          status: { in: ['PORTFOLIO', 'DEPOSITED'] },
          dueDate: { gte: startDate, lte: endDate },
        },
        select: {
          id: true,
          dueDate: true,
          amount: true,
          checkNumber: true,
          drawerName: true,
          bankName: true,
        },
      }),
      // Cheques propios entregados (egresos)
      prisma.check.findMany({
        where: {
          companyId,
          type: 'OWN',
          status: 'DELIVERED',
          dueDate: { gte: startDate, lte: endDate },
        },
        select: {
          id: true,
          dueDate: true,
          amount: true,
          checkNumber: true,
          payeeName: true,
          bankName: true,
        },
      }),
      // Proyecciones manuales (excluir CONFIRMED, usar monto efectivo para PARTIAL)
      prisma.cashflowProjection.findMany({
        where: {
          companyId,
          date: { gte: startDate, lte: endDate },
          status: { in: ['PENDING', 'PARTIAL'] },
        },
        select: {
          id: true,
          type: true,
          amount: true,
          confirmedAmount: true,
          date: true,
          status: true,
          description: true,
          category: true,
        },
      }),
      // Saldos de cuentas bancarias activas
      prisma.bankAccount.findMany({
        where: { companyId, status: 'ACTIVE' },
        select: { balance: true },
      }),
      // Saldos de cajas con sesión abierta
      prisma.cashRegisterSession.findMany({
        where: {
          cashRegister: { companyId },
          status: 'OPEN',
        },
        select: { expectedBalance: true },
      }),
    ]);

    // 2. Calcular saldo actual
    const bankBalance = bankAccounts.reduce((acc, a) => acc + Number(a.balance), 0);
    const cashBalance = openSessions.reduce((acc, s) => acc + Number(s.expectedBalance), 0);
    const currentBalance = bankBalance + cashBalance;

    // 3. Generar buckets temporales
    const buckets = generateBuckets(granularity, now);

    // 4. Asignar cada item a su bucket o al acumulado pre-período
    // Items entre hoy y el primer bucket visible se acumulan aparte
    // para mantener el saldo proyectado acumulativo desde hoy
    let prePeriodInflows = 0;
    let prePeriodOutflows = 0;

    // Recibos DRAFT → ingresos
    for (const receipt of draftReceipts) {
      const bucket = findBucket(buckets, moment(receipt.date), granularity);
      const amount = Number(receipt.totalAmount);
      if (bucket) {
        bucket.details.receipts += amount;
        bucket.details.receiptsItems.push({
          label: `${receipt.fullNumber} — ${receipt.customer.name}`,
          amount,
        });
      } else {
        prePeriodInflows += amount;
      }
    }

    // Órdenes de pago DRAFT → egresos
    for (const op of draftPaymentOrders) {
      const bucket = findBucket(buckets, moment(op.date), granularity);
      const amount = Number(op.totalAmount);
      if (bucket) {
        bucket.details.paymentOrders += amount;
        bucket.details.paymentOrdersItems.push({
          label: `${op.fullNumber}${op.supplier ? ` — ${op.supplier.tradeName || op.supplier.businessName}` : ''}`,
          amount,
        });
      } else {
        prePeriodOutflows += amount;
      }
    }

    // OCs sin cuotas - saldo no facturado
    for (const oc of approvedPurchaseOrders) {
      if (oc.expectedDeliveryDate) {
        const invoicedTotal = oc.purchaseInvoices.reduce((s, i) => s + Number(i.total), 0);
        const uninvoicedBalance = Math.max(0, Number(oc.total) - invoicedTotal);
        if (uninvoicedBalance > 0) {
          const bucket = findBucket(buckets, moment.utc(oc.expectedDeliveryDate), granularity);
          if (bucket) {
            bucket.details.purchaseOrders += uninvoicedBalance;
            bucket.details.purchaseOrdersItems.push({
              label: `${oc.fullNumber} — ${oc.supplier.tradeName || oc.supplier.businessName}`,
              amount: uninvoicedBalance,
            });
          } else {
            prePeriodOutflows += uninvoicedBalance;
          }
        }
      }
    }

    // Cuotas de OC (distribuidas por fecha de vencimiento)
    for (const inst of approvedPOInstallments) {
      const bucket = findBucket(buckets, moment.utc(inst.dueDate), granularity);
      const amount = Number(inst.amount);
      if (bucket) {
        bucket.details.purchaseOrders += amount;
        bucket.details.purchaseOrdersItems.push({
          label: `${inst.order.fullNumber} cuota ${inst.number} — ${inst.order.supplier.tradeName || inst.order.supplier.businessName}`,
          amount,
        });
      } else {
        prePeriodOutflows += amount;
      }
    }

    // Gastos (sin OP draft vinculada)
    for (const exp of pendingExpenses) {
      const date = exp.dueDate ? moment.utc(exp.dueDate) : moment();
      const bucket = findBucket(buckets, date, granularity);
      const amount = Number(exp.amount);
      if (bucket) {
        bucket.details.expenses += amount;
        bucket.details.expensesItems.push({
          label: `${exp.fullNumber} — ${exp.description}`,
          amount,
        });
      } else {
        prePeriodOutflows += amount;
      }
    }

    for (const check of checksThirdParty) {
      const bucket = findBucket(buckets, moment(check.dueDate), granularity);
      const amount = Number(check.amount);
      if (bucket) {
        bucket.details.checksIn += amount;
        bucket.details.checksInItems.push({
          label: `Nº ${check.checkNumber}${check.drawerName ? ` — ${check.drawerName}` : ''}${check.bankName ? ` (${check.bankName})` : ''}`,
          amount,
        });
      } else {
        prePeriodInflows += amount;
      }
    }

    for (const check of checksOwn) {
      const bucket = findBucket(buckets, moment(check.dueDate), granularity);
      const amount = Number(check.amount);
      if (bucket) {
        bucket.details.checksOut += amount;
        bucket.details.checksOutItems.push({
          label: `Nº ${check.checkNumber}${check.payeeName ? ` — ${check.payeeName}` : ''}${check.bankName ? ` (${check.bankName})` : ''}`,
          amount,
        });
      } else {
        prePeriodOutflows += amount;
      }
    }

    for (const proj of projections) {
      // CashflowProjection.date es @db.Date → usar moment.utc para evitar off-by-one
      const bucket = findBucket(buckets, moment.utc(proj.date), granularity);
      // Para PARTIAL, solo incluir el monto no confirmado
      const effectiveAmount = Number(proj.amount) - Number(proj.confirmedAmount);
      if (effectiveAmount > 0) {
        if (bucket) {
          const item: CashflowDetailItem = {
            label: proj.description,
            amount: effectiveAmount,
          };
          if (proj.type === 'INCOME') {
            bucket.details.projectionsIn += effectiveAmount;
            bucket.details.projectionsInItems.push(item);
          } else {
            bucket.details.projectionsOut += effectiveAmount;
            bucket.details.projectionsOutItems.push(item);
          }
        } else {
          if (proj.type === 'INCOME') {
            prePeriodInflows += effectiveAmount;
          } else {
            prePeriodOutflows += effectiveAmount;
          }
        }
      }
    }

    // 5. Calcular totales y saldo proyectado acumulativo
    // El running balance parte del saldo actual + lo acumulado entre hoy y el primer bucket
    let runningBalance = currentBalance + prePeriodInflows - prePeriodOutflows;
    const rows: CashflowRow[] = buckets.map((bucket) => {
      const inflows =
        bucket.details.receipts +
        bucket.details.checksIn +
        bucket.details.projectionsIn;
      const outflows =
        bucket.details.paymentOrders +
        bucket.details.purchaseOrders +
        bucket.details.expenses +
        bucket.details.checksOut +
        bucket.details.projectionsOut;
      const net = inflows - outflows;
      runningBalance += net;

      return {
        ...bucket,
        inflows,
        outflows,
        net,
        projectedBalance: runningBalance,
      };
    });

    // 6. Calcular resumen
    // Incluir tanto los items del pre-período como los de los buckets visibles
    const totalProjectedInflows = prePeriodInflows + rows.reduce((acc, r) => acc + r.inflows, 0);
    const totalProjectedOutflows = prePeriodOutflows + rows.reduce((acc, r) => acc + r.outflows, 0);

    // Cheques en cartera (todos, no solo rango)
    const allChecksInPortfolio = await prisma.check.findMany({
      where: {
        companyId,
        type: 'THIRD_PARTY',
        status: 'PORTFOLIO',
      },
      select: { amount: true },
    });

    // Cuentas por cobrar vencidas (FV como indicador de alerta)
    const overdueReceivables = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
        dueDate: { lt: startDate },
      },
      select: { total: true },
    });

    // Cuentas por pagar vencidas (FC como indicador de alerta)
    const overduePayables = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
        dueDate: { lt: startDate },
      },
      select: { total: true },
    });

    const summary: CashflowSummary = {
      currentBalance,
      totalProjectedInflows,
      totalProjectedOutflows,
      endingProjectedBalance: currentBalance + totalProjectedInflows - totalProjectedOutflows,
      checksInPortfolio: {
        count: allChecksInPortfolio.length,
        total: allChecksInPortfolio.reduce((acc, c) => acc + Number(c.amount), 0),
      },
      overdueReceivables: {
        count: overdueReceivables.length,
        total: overdueReceivables.reduce((acc, i) => acc + Number(i.total), 0),
      },
      overduePayables: {
        count: overduePayables.length,
        total: overduePayables.reduce((acc, i) => acc + Number(i.total), 0),
      },
    };

    return { rows, summary, granularity };
  } catch (error) {
    logger.error('Error al generar cashflow', { data: { error, companyId } });
    throw new Error('Error al generar proyección de flujo de caja');
  }
}

// ============================================
// HELPERS
// ============================================

interface BucketTemplate {
  period: string;
  periodLabel: string;
  inflows: number;
  outflows: number;
  net: number;
  projectedBalance: number;
  details: {
    receipts: number;
    receiptsItems: CashflowDetailItem[];
    paymentOrders: number;
    paymentOrdersItems: CashflowDetailItem[];
    purchaseOrders: number;
    purchaseOrdersItems: CashflowDetailItem[];
    expenses: number;
    expensesItems: CashflowDetailItem[];
    checksIn: number;
    checksInItems: CashflowDetailItem[];
    checksOut: number;
    checksOutItems: CashflowDetailItem[];
    projectionsIn: number;
    projectionsInItems: CashflowDetailItem[];
    projectionsOut: number;
    projectionsOutItems: CashflowDetailItem[];
  };
}

function emptyDetails() {
  return {
    receipts: 0,
    receiptsItems: [] as CashflowDetailItem[],
    paymentOrders: 0,
    paymentOrdersItems: [] as CashflowDetailItem[],
    purchaseOrders: 0,
    purchaseOrdersItems: [] as CashflowDetailItem[],
    expenses: 0,
    expensesItems: [] as CashflowDetailItem[],
    checksIn: 0,
    checksInItems: [] as CashflowDetailItem[],
    checksOut: 0,
    checksOutItems: [] as CashflowDetailItem[],
    projectionsIn: 0,
    projectionsInItems: [] as CashflowDetailItem[],
    projectionsOut: 0,
    projectionsOutItems: [] as CashflowDetailItem[],
  };
}

function generateBuckets(granularity: Granularity, now: moment.Moment): BucketTemplate[] {
  const buckets: BucketTemplate[] = [];

  switch (granularity) {
    case 'daily': {
      for (let i = 0; i < 30; i++) {
        const day = now.clone().add(i, 'days');
        buckets.push({
          period: day.format('YYYY-MM-DD'),
          periodLabel: day.format('DD/MM'),
          inflows: 0,
          outflows: 0,
          net: 0,
          projectedBalance: 0,
          details: emptyDetails(),
        });
      }
      break;
    }
    case 'weekly': {
      for (let i = 0; i < 13; i++) {
        const weekStart = now.clone().add(i, 'weeks').startOf('isoWeek');
        const weekEnd = weekStart.clone().endOf('isoWeek');
        buckets.push({
          period: `${weekStart.format('YYYY')}-W${weekStart.format('WW')}`,
          periodLabel: `${weekStart.format('DD/MM')} - ${weekEnd.format('DD/MM')}`,
          inflows: 0,
          outflows: 0,
          net: 0,
          projectedBalance: 0,
          details: emptyDetails(),
        });
      }
      break;
    }
    case 'monthly': {
      for (let i = 0; i < 12; i++) {
        const month = now.clone().add(i, 'months');
        buckets.push({
          period: month.format('YYYY-MM'),
          periodLabel: month.format('MMM YY'),
          inflows: 0,
          outflows: 0,
          net: 0,
          projectedBalance: 0,
          details: emptyDetails(),
        });
      }
      break;
    }
  }

  return buckets;
}

function findBucket(
  buckets: BucketTemplate[],
  date: moment.Moment,
  granularity: Granularity,
): BucketTemplate | undefined {
  switch (granularity) {
    case 'daily': {
      const key = date.format('YYYY-MM-DD');
      return buckets.find((b) => b.period === key);
    }
    case 'weekly': {
      const key = `${date.format('YYYY')}-W${date.format('WW')}`;
      return buckets.find((b) => b.period === key);
    }
    case 'monthly': {
      const key = date.format('YYYY-MM');
      return buckets.find((b) => b.period === key);
    }
  }
}
