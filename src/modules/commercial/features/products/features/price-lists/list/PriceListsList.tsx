import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { parseSearchParams } from '@/shared/components/common/DataTable/helpers';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';
import { getPriceLists } from './actions.server';
import { _PriceListsTable } from './components/_PriceListsTable';

interface PriceListsListProps {
  searchParams?: DataTableSearchParams;
}

export async function PriceListsList({ searchParams = {} }: PriceListsListProps) {
  const state = parseSearchParams(searchParams);

  const [result, permissions] = await Promise.all([
    getPriceLists({
      page: state.page + 1,
      pageSize: state.pageSize,
      filters: state.filters,
    }),
    getModulePermissions('commercial.products'),
  ]);

  return (
    <PermissionGuard module="commercial.products" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Listas de Precios</h1>
          <p className="text-muted-foreground">
            Gestión de listas de precios y asignación de precios por artículo
          </p>
        </div>

        <_PriceListsTable
          data={result.data}
          totalRows={result.pagination.total}
          searchParams={searchParams}
          permissions={permissions}
        />
      </div>
    </PermissionGuard>
  );
}
