import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { parseSearchParams } from '@/shared/components/common/DataTable/helpers';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';
import { getLeads } from './actions.server';
import { _LeadsDataTable } from './components/_LeadsDataTable';

interface Props {
  searchParams?: DataTableSearchParams;
}

export async function LeadsList({ searchParams = {} }: Props) {
  const state = parseSearchParams(searchParams);
  const { page, pageSize, search, filters } = state;

  const [result, permissions] = await Promise.all([
    getLeads({
      page: page + 1,
      pageSize,
      search,
      filters,
    }),
    getModulePermissions('commercial.leads'),
  ]);

  return (
    <PermissionGuard module="commercial.leads" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-muted-foreground">
            Gestiona tus prospectos y conviértelos en clientes
          </p>
        </div>

        <_LeadsDataTable
          data={result.data}
          totalRows={result.pagination.total}
          searchParams={searchParams}
          permissions={permissions}
        />
      </div>
    </PermissionGuard>
  );
}
