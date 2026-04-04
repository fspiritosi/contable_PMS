import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getActiveCompanyId } from '@/shared/lib/company';
import {
  getDashboardKPIs,
  getSalesTrend,
  getPurchasesTrend,
  getProfitabilityTrend,
  getExpenseCategories,
  getCriticalStockProducts,
  getRecentAlerts,
  getTopClientDebts,
  getTopSupplierDebts,
  getTopSellingProducts,
  getWeeklySalesComparison,
  getPaymentMethodBreakdown,
  getUpcomingDueDates,
} from './actions.server';
import { _DashboardGrid } from './components/_DashboardGrid';
import moment from 'moment';

interface DashboardContentProps {
  period?: string;
  monthsRange?: number;
}

export async function DashboardContent({ period, monthsRange = 6 }: DashboardContentProps) {
  async function Content() {
    const validPeriod = period && moment(period, 'YYYY-MM', true).isValid() ? period : undefined;
    const displayPeriod = validPeriod || moment().format('YYYY-MM');
    const isCurrentMonth = !validPeriod || moment(validPeriod, 'YYYY-MM').isSame(moment(), 'month');
    const periodLabel = moment(displayPeriod, 'YYYY-MM').format('MMMM YYYY');

    const companyId = (await getActiveCompanyId()) ?? '';

    const [
      kpis, salesTrend, purchasesTrend, profitabilityTrend, expenseCategories, criticalStock, alerts,
      topClientDebts, topSupplierDebts, topProducts, weeklySales, paymentMethods, upcomingDueDates,
    ] = await Promise.all([
      getDashboardKPIs(validPeriod),
      getSalesTrend(validPeriod, monthsRange),
      getPurchasesTrend(validPeriod, monthsRange),
      getProfitabilityTrend(validPeriod, undefined, monthsRange),
      getExpenseCategories(),
      getCriticalStockProducts(),
      getRecentAlerts(validPeriod),
      getTopClientDebts(),
      getTopSupplierDebts(),
      getTopSellingProducts(),
      getWeeklySalesComparison(),
      getPaymentMethodBreakdown(),
      getUpcomingDueDates(),
    ]);

    return (
      <_DashboardGrid
        companyId={companyId}
        isCurrentMonth={isCurrentMonth}
        periodLabel={periodLabel}
        displayPeriod={displayPeriod}
        monthsRange={monthsRange}
        validPeriod={validPeriod}
        kpis={kpis}
        salesTrend={salesTrend}
        purchasesTrend={purchasesTrend}
        profitabilityTrend={profitabilityTrend}
        expenseCategories={expenseCategories}
        criticalStock={criticalStock}
        alerts={alerts}
        topClientDebts={topClientDebts}
        topSupplierDebts={topSupplierDebts}
        topProducts={topProducts}
        weeklySales={weeklySales}
        paymentMethods={paymentMethods}
        upcomingDueDates={upcomingDueDates}
      />
    );
  }

  return (
    <PermissionGuard module="dashboard" action="view" redirect>
      <Content />
    </PermissionGuard>
  );
}
