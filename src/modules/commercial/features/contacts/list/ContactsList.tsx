import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { parseSearchParams } from '@/shared/components/common/DataTable/helpers';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';
import { getContacts, getContactFormOptions } from './actions.server';
import { _ContactsDataTable } from './components/_ContactsDataTable';

interface Props {
  searchParams?: DataTableSearchParams;
}

export async function ContactsList({ searchParams = {} }: Props) {
  const { page, pageSize, search, filters } = parseSearchParams(searchParams);

  const [result, options, permissions] = await Promise.all([
    getContacts({
      page: page + 1,
      pageSize,
      search,
      filters,
    }),
    getContactFormOptions(),
    getModulePermissions('commercial.contacts'),
  ]);

  return (
    <PermissionGuard module="commercial.contacts" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contactos</h1>
          <p className="text-muted-foreground">
            Gestiona los contactos de tus clientes y leads
          </p>
        </div>

        <_ContactsDataTable
          data={result.data}
          totalRows={result.pagination.total}
          searchParams={searchParams}
          options={options}
          permissions={permissions}
        />
      </div>
    </PermissionGuard>
  );
}
