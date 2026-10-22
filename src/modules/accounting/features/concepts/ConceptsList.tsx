import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';
import { getConcepts } from './actions.server';
import { _ConceptsTable } from './components/_ConceptsTable';

interface Props {
  searchParams?: DataTableSearchParams;
}

export async function ConceptsList({ searchParams = {} }: Props) {
  const [result, permissions] = await Promise.all([
    getConcepts(searchParams),
    getModulePermissions('accounting.concepts'),
  ]);

  return (
    <PermissionGuard module="accounting.concepts" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Conceptos</h1>
          <p className="text-muted-foreground">
            Definí los conceptos que Gestión elige en sus movimientos y la cuenta contable a la que
            se imputa cada uno
          </p>
        </div>

        <_ConceptsTable
          data={result.data}
          totalRows={result.pagination.total}
          searchParams={searchParams}
          permissions={permissions}
        />
      </div>
    </PermissionGuard>
  );
}
