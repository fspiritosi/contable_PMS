import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getWithholdingsReceivedPaginated } from './actions.server';
import { _WithholdingsTable } from './components/_WithholdingsTable';

interface Props {
  searchParams: DataTableSearchParams;
}

export async function WithholdingsReceived({ searchParams }: Props) {
  const { data, total } = await getWithholdingsReceivedPaginated(searchParams);

  return (
    <PermissionGuard module="commercial.treasury.receipts" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Retenciones Recibidas</h1>
          <p className="text-muted-foreground">
            Listado de retenciones aplicadas en recibos de cobro
          </p>
        </div>

        <_WithholdingsTable data={data} totalRows={total} searchParams={searchParams} />
      </div>
    </PermissionGuard>
  );
}
