import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';
import { getSuppliers } from './actions.server';
import { _SuppliersTable } from './components/_SuppliersTable';

interface Props {
  searchParams?: DataTableSearchParams;
}

export async function SuppliersList({ searchParams = {} }: Props) {
  const [result, permissions] = await Promise.all([
    getSuppliers(searchParams),
    getModulePermissions('commercial.suppliers'),
  ]);

  return (
    <PermissionGuard module="commercial.suppliers" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Proveedores</h1>
          <p className="text-muted-foreground">
            Gestiona los proveedores de tu empresa
          </p>
        </div>

        <_SuppliersTable
          data={result.data}
          totalRows={result.pagination.total}
          searchParams={searchParams}
          permissions={permissions}
        />
      </div>
    </PermissionGuard>
  );
}
