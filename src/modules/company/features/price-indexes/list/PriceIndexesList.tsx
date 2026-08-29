import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';

import { getPriceIndexesPaginated } from './actions.server';
import { _PriceIndexesDataTable } from './components/_PriceIndexesDataTable';

interface Props {
  searchParams: DataTableSearchParams;
}

export async function PriceIndexesList({ searchParams }: Props) {
  const [{ data, total }, permissions] = await Promise.all([
    getPriceIndexesPaginated(searchParams),
    getModulePermissions('company.price-indexes'),
  ]);

  return (
    <PermissionGuard module="company.price-indexes" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="price-indexes-page-title">
            Índices de Precios
          </h1>
          <p className="text-muted-foreground">
            Administra los índices (IPC, Costo de Vida, etc.) que se pueden aplicar para
            actualizar los precios de las listas
          </p>
        </div>

        <_PriceIndexesDataTable
          data={data}
          totalRows={total}
          searchParams={searchParams}
          permissions={permissions}
        />
      </div>
    </PermissionGuard>
  );
}
