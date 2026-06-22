import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { Card, CardContent } from '@/shared/components/ui/card';
import { formatCurrency } from '@/shared/utils/formatters';
import { getCardInstallments, getCardInstallmentsPendingTotal } from './actions.server';
import { _CardInstallmentsTable } from './components/_CardInstallmentsTable';

interface Props {
  searchParams?: DataTableSearchParams;
}

export async function CardInstallmentsList({ searchParams = {} }: Props) {
  const [result, pendingTotal] = await Promise.all([
    getCardInstallments(searchParams),
    getCardInstallmentsPendingTotal(),
  ]);

  return (
    <PermissionGuard module="commercial.treasury.cards" action="view" redirect>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Cuotas de Tarjeta</h1>
            <p className="text-muted-foreground">
              Cuotas pendientes y pagadas generadas por pagos con tarjeta
            </p>
          </div>

          <Card className="w-full sm:w-auto">
            <CardContent className="px-6 py-4">
              <p className="text-sm text-muted-foreground">Total pendiente</p>
              <p className="text-2xl font-bold tabular-nums">{formatCurrency(pendingTotal)}</p>
            </CardContent>
          </Card>
        </div>

        <_CardInstallmentsTable
          data={result.data}
          totalRows={result.pagination.total}
          searchParams={searchParams}
        />
      </div>
    </PermissionGuard>
  );
}
