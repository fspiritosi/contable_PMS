import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { DollarSign, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { getExpensesPaginated, getExpenseFacetCounts, getExpenseCategories } from '../actions.server';
import { _ExpensesTable } from './components/_ExpensesTable';

interface Props {
  searchParams?: DataTableSearchParams;
}

export async function ExpensesList({ searchParams = {} }: Props) {
  const [{ data, total }, facetCounts, categories] = await Promise.all([
    getExpensesPaginated(searchParams),
    getExpenseFacetCounts(),
    getExpenseCategories(),
  ]);

  const totalAmount = data.reduce((acc, e) => acc + e.amount, 0);
  const confirmedCount = data.filter((e) => e.status === 'CONFIRMED').length;
  const draftCount = data.filter((e) => e.status === 'DRAFT').length;
  const overdueCount = data.filter(
    (e) =>
      e.dueDate &&
      e.status !== 'PAID' &&
      e.status !== 'CANCELLED' &&
      new Date(e.dueDate) < new Date()
  ).length;

  return (
    <PermissionGuard module="commercial.expenses" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Egresos</h1>
          <p className="text-muted-foreground">Gestión de egresos operativos de la empresa</p>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total (página)</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground">Suma de egresos en la vista actual</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Confirmados</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{confirmedCount}</div>
              <p className="text-xs text-muted-foreground">Egresos pendientes de pago</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Borradores</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{draftCount}</div>
              <p className="text-xs text-muted-foreground">Pendientes de confirmar</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Vencidos</CardTitle>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{overdueCount}</div>
              <p className="text-xs text-muted-foreground">Con fecha de vencimiento superada</p>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <_ExpensesTable
          data={data}
          totalRows={total}
          searchParams={searchParams}
          facetCounts={facetCounts}
          categories={categories}
        />
      </div>
    </PermissionGuard>
  );
}
