import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { parseSearchParams } from '@/shared/components/common/DataTable/helpers';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';
import { getEquivalencesPaginated } from './actions.server';
import { _EquivalencesTable } from './components/_EquivalencesTable';

interface Props {
  searchParams?: DataTableSearchParams;
}

export async function EquivalencesList({ searchParams = {} }: Props) {
  const state = parseSearchParams(searchParams);
  const page = state.page + 1;
  const { pageSize, filters } = state;

  const [result, permissions] = await Promise.all([
    getEquivalencesPaginated({ page, pageSize, filters }),
    getModulePermissions('commercial.equivalences'),
  ]);

  return (
    <PermissionGuard module="commercial.equivalences" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Equivalencias</h1>
          <p className="text-muted-foreground">
            Grupos de artículos equivalentes de diferentes marcas
          </p>
        </div>

        <_EquivalencesTable
          data={result.data}
          totalRows={result.pagination.total}
          searchParams={searchParams}
          permissions={permissions}
        />
      </div>
    </PermissionGuard>
  );
}
