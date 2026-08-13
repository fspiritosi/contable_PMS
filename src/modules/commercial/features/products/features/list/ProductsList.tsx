import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { parseSearchParams } from '@/shared/components/common/DataTable/helpers';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';
import { getProducts, getProductFacetCounts } from './actions.server';
import {
  getAccountsForProductSelect,
  getCostCentersForProductSelect,
} from '../../shared/catalog-actions.server';
import { _ProductsTable } from './components/_ProductsTable';

interface Props {
  searchParams?: DataTableSearchParams;
}

export async function ProductsList({ searchParams = {} }: Props) {
  const state = parseSearchParams(searchParams);
  const page = state.page + 1;
  const { pageSize, filters } = state;

  const [result, permissions, facetCounts, accounts, costCenters] = await Promise.all([
    getProducts({
      page,
      pageSize,
      filters,
    }),
    getModulePermissions('commercial.products'),
    getProductFacetCounts(),
    getAccountsForProductSelect(),
    getCostCentersForProductSelect(),
  ]);

  return (
    <PermissionGuard module="commercial.products" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ítems</h1>
          <p className="text-muted-foreground">
            Gestión de ítems y servicios
          </p>
        </div>

        <_ProductsTable
          data={result.data}
          totalRows={result.pagination.total}
          searchParams={searchParams}
          permissions={permissions}
          facetCounts={facetCounts}
          accounts={accounts}
          costCenters={costCenters}
        />
      </div>
    </PermissionGuard>
  );
}
