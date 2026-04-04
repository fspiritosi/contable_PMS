'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  TrendingUp,
  ShoppingCart,
  Receipt,
  ArrowDownCircle,
  ArrowUpCircle,
  AlertTriangle,
  Landmark,
} from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import { useDashboardPreferences } from '../hooks/useDashboardPreferences';
import { _DashboardSettingsDialog } from './_DashboardSettingsDialog';
import { _PeriodSelector } from './_PeriodSelector';
import { _MonthsRangeSelector } from './_MonthsRangeSelector';
import { _SalesTrendChart } from './_SalesTrendChart';
import { _PurchasesTrendChart } from './_PurchasesTrendChart';
import { _ProfitabilityChart } from './_ProfitabilityChart';
import { _WeeklySalesChart } from './_WeeklySalesChart';
import { _PaymentMethodsWidget } from './_PaymentMethodsWidget';
import { _TopDebtsWidget } from './_TopDebtsWidget';
import { _TopProductsWidget } from './_TopProductsWidget';
import { _UpcomingDueDatesWidget } from './_UpcomingDueDatesWidget';
import { _CriticalStockList } from './_CriticalStockList';
import { _AlertsList } from './_AlertsList';

// --- Data types (inline, matching server action returns) ---

interface KpiData {
  salesThisMonth: { total: number; count: number };
  purchasesThisMonth: { total: number; count: number };
  expensesThisMonth: { total: number; count: number };
  pendingReceivables: { total: number; count: number };
  pendingPayables: { total: number; count: number };
  criticalStockCount: number;
  bankBalance: number;
}

interface TrendItem {
  month: string;
  total: number;
}

interface ProfitabilityItem {
  month: string;
  sales: number;
  purchases: number;
  expenses: number;
  profit: number;
}

interface ExpenseCategory {
  id: string;
  name: string;
}

interface CriticalStockProduct {
  productId: string;
  productName: string;
  productCode: string;
  totalStock: number;
  minStock: number;
  unitOfMeasure: string;
  stockPercentage: number;
}

interface AlertItem {
  type: 'overdue_receivable' | 'overdue_payable' | 'overdue_expense';
  title: string;
  description: string;
  date: Date | null;
  amount: number;
}

interface DebtItem {
  name: string;
  taxId: string | null;
  totalDebt: number;
  invoiceCount: number;
}

interface ProductItem {
  code: string;
  name: string;
  totalQty: number;
  totalAmount: number;
}

interface WeeklySalesData {
  day: string;
  currentWeek: number;
  previousWeek: number;
}

interface PaymentMethodItem {
  method: string;
  total: number;
  count: number;
}

interface DueItem {
  type: 'sale' | 'purchase';
  number: string;
  entity: string;
  dueDate: Date | null;
  total: number;
  daysUntilDue: number;
}

// --- Component props ---

interface DashboardGridProps {
  companyId: string;
  kpis: KpiData;
  salesTrend: TrendItem[];
  purchasesTrend: TrendItem[];
  profitabilityTrend: ProfitabilityItem[];
  expenseCategories: ExpenseCategory[];
  criticalStock: CriticalStockProduct[];
  alerts: AlertItem[];
  topClientDebts: DebtItem[];
  topSupplierDebts: DebtItem[];
  topProducts: ProductItem[];
  weeklySales: WeeklySalesData[];
  paymentMethods: PaymentMethodItem[];
  upcomingDueDates: DueItem[];
  displayPeriod: string;
  periodLabel: string;
  isCurrentMonth: boolean;
  validPeriod: string | undefined;
  monthsRange: number;
}

export function _DashboardGrid({
  companyId,
  kpis,
  salesTrend,
  purchasesTrend,
  profitabilityTrend,
  expenseCategories,
  criticalStock,
  alerts,
  topClientDebts,
  topSupplierDebts,
  topProducts,
  weeklySales,
  paymentMethods,
  upcomingDueDates,
  displayPeriod,
  periodLabel,
  isCurrentMonth,
  validPeriod,
  monthsRange,
}: DashboardGridProps) {
  const { isWidgetVisible, preferences } = useDashboardPreferences(companyId);
  const accordionsOpen = preferences.accordionsOpen;

  const anyKpiVisible =
    isWidgetVisible('kpi-sales') ||
    isWidgetVisible('kpi-purchases') ||
    isWidgetVisible('kpi-expenses') ||
    isWidgetVisible('kpi-receivables') ||
    isWidgetVisible('kpi-payables') ||
    isWidgetVisible('kpi-critical-stock') ||
    isWidgetVisible('kpi-bank-balance');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            {isCurrentMonth ? 'Resumen general de tu empresa' : `Datos de ${periodLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <_DashboardSettingsDialog companyId={companyId} />
          <_MonthsRangeSelector currentRange={monthsRange} />
          <_PeriodSelector currentPeriod={displayPeriod} />
        </div>
      </div>

      {/* KPI Cards */}
      {anyKpiVisible && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
          {isWidgetVisible('kpi-sales') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {isCurrentMonth ? 'Ventas del Mes' : 'Ventas'}
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(kpis.salesThisMonth.total)}</div>
                <p className="text-xs text-muted-foreground">
                  {kpis.salesThisMonth.count} factura{kpis.salesThisMonth.count !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-purchases') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {isCurrentMonth ? 'Compras del Mes' : 'Compras'}
                </CardTitle>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(kpis.purchasesThisMonth.total)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {kpis.purchasesThisMonth.count} factura
                  {kpis.purchasesThisMonth.count !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-expenses') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {isCurrentMonth ? 'Gastos del Mes' : 'Gastos'}
                </CardTitle>
                <Receipt className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(kpis.expensesThisMonth.total)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {kpis.expensesThisMonth.count} gasto
                  {kpis.expensesThisMonth.count !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-receivables') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pendiente de Cobro</CardTitle>
                <ArrowDownCircle className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">
                  {formatCurrency(kpis.pendingReceivables.total)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {kpis.pendingReceivables.count} documento
                  {kpis.pendingReceivables.count !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-payables') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pendiente de Pago</CardTitle>
                <ArrowUpCircle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {formatCurrency(kpis.pendingPayables.total)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {kpis.pendingPayables.count} documento
                  {kpis.pendingPayables.count !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-critical-stock') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Stock Crítico</CardTitle>
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${kpis.criticalStockCount > 0 ? 'text-yellow-600' : ''}`}
                >
                  {kpis.criticalStockCount}
                </div>
                <p className="text-xs text-muted-foreground">
                  producto{kpis.criticalStockCount !== 1 ? 's' : ''} bajo mínimo
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-bank-balance') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Saldo Bancario</CardTitle>
                <Landmark className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${kpis.bankBalance < 0 ? 'text-red-600' : 'text-green-600'}`}
                >
                  {formatCurrency(kpis.bankBalance)}
                </div>
                <p className="text-xs text-muted-foreground">Cuentas activas</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Profitability Chart */}
      {isWidgetVisible('chart-profitability') && (
        <_ProfitabilityChart
          data={profitabilityTrend}
          categories={expenseCategories}
          period={validPeriod}
          monthsRange={monthsRange}
          defaultOpen={accordionsOpen}
        />
      )}

      {/* Charts Row: Sales Trend + Purchases Trend */}
      {(isWidgetVisible('chart-sales-trend') || isWidgetVisible('chart-purchases-trend')) && (
        <div className="grid gap-4 md:grid-cols-2">
          {isWidgetVisible('chart-sales-trend') && (
            <_SalesTrendChart data={salesTrend} defaultOpen={accordionsOpen} />
          )}
          {isWidgetVisible('chart-purchases-trend') && (
            <_PurchasesTrendChart data={purchasesTrend} defaultOpen={accordionsOpen} />
          )}
        </div>
      )}

      {/* Weekly Sales + Payment Methods */}
      {(isWidgetVisible('chart-weekly-sales') || isWidgetVisible('widget-payment-methods')) && (
        <div className="grid gap-4 md:grid-cols-2">
          {isWidgetVisible('chart-weekly-sales') && (
            <_WeeklySalesChart data={weeklySales} defaultOpen={accordionsOpen} />
          )}
          {isWidgetVisible('widget-payment-methods') && (
            <_PaymentMethodsWidget data={paymentMethods} defaultOpen={accordionsOpen} />
          )}
        </div>
      )}

      {/* Top Debts */}
      {(isWidgetVisible('widget-client-debts') || isWidgetVisible('widget-supplier-debts')) && (
        <div className="grid gap-4 md:grid-cols-2">
          {isWidgetVisible('widget-client-debts') && (
            <_TopDebtsWidget
              title="Top 10 Deudas de Clientes"
              iconVariant="receivable"
              data={topClientDebts}
              emptyMessage="Sin deudas de clientes pendientes"
              defaultOpen={accordionsOpen}
            />
          )}
          {isWidgetVisible('widget-supplier-debts') && (
            <_TopDebtsWidget
              title="Top 10 Deudas de Proveedores"
              iconVariant="payable"
              data={topSupplierDebts}
              emptyMessage="Sin deudas a proveedores pendientes"
              defaultOpen={accordionsOpen}
            />
          )}
        </div>
      )}

      {/* Top Products + Upcoming Due Dates */}
      {(isWidgetVisible('widget-top-products') || isWidgetVisible('widget-due-dates')) && (
        <div className="grid gap-4 md:grid-cols-2">
          {isWidgetVisible('widget-top-products') && (
            <_TopProductsWidget data={topProducts} defaultOpen={accordionsOpen} />
          )}
          {isWidgetVisible('widget-due-dates') && (
            <_UpcomingDueDatesWidget data={upcomingDueDates} defaultOpen={accordionsOpen} />
          )}
        </div>
      )}

      {/* Bottom Row: Critical Stock + Alerts */}
      {(isWidgetVisible('widget-critical-stock') || isWidgetVisible('widget-alerts')) && (
        <div className="grid gap-4 md:grid-cols-2">
          {isWidgetVisible('widget-critical-stock') && (
            <_CriticalStockList products={criticalStock} defaultOpen={accordionsOpen} />
          )}
          {isWidgetVisible('widget-alerts') && (
            <_AlertsList alerts={alerts} defaultOpen={accordionsOpen} />
          )}
        </div>
      )}
    </div>
  );
}
