import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';

import { getRolesPaginated } from './actions.server';
import { _RolesDataTable } from './components/_RolesDataTable';

interface Props {
  searchParams: DataTableSearchParams;
}

export async function RolesList({ searchParams }: Props) {
  const [rolesResult, permissions, usersPermissions] = await Promise.all([
    getRolesPaginated(searchParams),
    getModulePermissions('company.general.roles'),
    getModulePermissions('company.general.users'),
  ]);

  return (
    <PermissionGuard module="company.general.roles" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 data-testid="roles-page-title" className="text-3xl font-bold tracking-tight">
            Roles
          </h1>
          <p className="text-muted-foreground">
            Configura los roles y permisos de tu empresa
          </p>
        </div>

        <_RolesDataTable
          data={rolesResult.data}
          totalRows={rolesResult.total}
          searchParams={searchParams}
          permissions={permissions}
          canViewUsers={usersPermissions.canView}
        />
      </div>
    </PermissionGuard>
  );
}
