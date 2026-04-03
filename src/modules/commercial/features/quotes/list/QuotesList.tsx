import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getQuotesPaginated } from './actions.server';
import { _QuotesTable } from './components/_QuotesTable';

interface Props {
  searchParams: DataTableSearchParams;
}

export async function QuotesList({ searchParams }: Props) {
  const { data, total } = await getQuotesPaginated(searchParams);

  return (
    <PermissionGuard module="commercial.quotes" action="view" redirect>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Presupuestos</h1>
          <p className="text-muted-foreground">
            Creá y gestioná presupuestos para tus clientes y leads.
          </p>
        </div>
        <_QuotesTable data={data} totalRows={total} searchParams={searchParams} />
      </div>
    </PermissionGuard>
  );
}
