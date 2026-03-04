import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { parseSearchParams } from '@/shared/components/common/DataTable/helpers';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';
import { getProducts } from './actions.server';
import { _ProductsTable } from './components/_ProductsTable';

interface Props {
  searchParams?: DataTableSearchParams;
}

export async function ProductsList({ searchParams = {} }: Props) {
  const state = parseSearchParams(searchParams);
  const page = state.page + 1;
  const { search, pageSize, filters } = state;

  const [result, permissions] = await Promise.all([
    getProducts({
      page,
      pageSize,
      search,
      filters,
    }),
    getModulePermissions('commercial.products'),
  ]);

  return (
    <PermissionGuard module="commercial.products" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Productos</h1>
          <p className="text-muted-foreground">
            Gestión de productos y servicios
          </p>
        </div>

        <_ProductsTable
          data={result.data}
          totalRows={result.pagination.total}
          searchParams={searchParams}
          permissions={permissions}
        />
      </div>
    </PermissionGuard>
  );
}
