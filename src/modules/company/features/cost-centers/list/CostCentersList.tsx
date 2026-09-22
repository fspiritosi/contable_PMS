import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getActiveCompany } from '@/shared/lib/company';
import { isModuleActiveForCompany } from '@/shared/lib/modules';
import { getModulePermissions } from '@/shared/lib/permissions';

import { getCostCentersPaginated } from './actions.server';
import { _CostCentersDataTable } from './components/_CostCentersDataTable';

interface Props {
  searchParams: DataTableSearchParams;
}

export async function CostCentersList({ searchParams }: Props) {
  const [{ data, total }, permissions, reportPermissions, activeCompany] = await Promise.all([
    getCostCentersPaginated(searchParams),
    getModulePermissions('company.cost-centers'),
    getModulePermissions('accounting.reports'),
    getActiveCompany(),
  ]);

  // "Ver movimientos" lleva a Contabilidad → Informes, que es otro permiso
  // (TSK-719). `getModulePermissions` solo resuelve RBAC y no mira los módulos
  // activos de la empresa —eso lo hace el sidebar—, así que acá se exigen las
  // dos condiciones: si Contabilidad está desactivada, el enlace no se muestra.
  const canViewAccountingReports =
    reportPermissions.canView &&
    isModuleActiveForCompany('accounting.reports', activeCompany?.activeModules ?? []);

  return (
    <PermissionGuard module="company.cost-centers" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="cost-centers-page-title">
            Centros de Costo
          </h1>
          <p className="text-muted-foreground">Administra los centros de costo de tu empresa</p>
        </div>

        <_CostCentersDataTable
          data={data}
          totalRows={total}
          searchParams={searchParams}
          permissions={permissions}
          canViewAccountingReports={canViewAccountingReports}
        />
      </div>
    </PermissionGuard>
  );
}
