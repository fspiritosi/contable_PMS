import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';

import { getDiscountPresetsPaginated } from './actions.server';
import { _DiscountPresetsDataTable } from './components/_DiscountPresetsDataTable';

interface Props {
  searchParams: DataTableSearchParams;
}

export async function DiscountPresetsList({ searchParams }: Props) {
  const [{ data, total }, permissions] = await Promise.all([
    getDiscountPresetsPaginated(searchParams),
    getModulePermissions('company.discount-presets'),
  ]);

  return (
    <PermissionGuard module="company.discount-presets" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="discount-presets-page-title">
            Descuentos Predefinidos
          </h1>
          <p className="text-muted-foreground">
            Administra los descuentos predefinidos que se pueden aplicar en facturas y presupuestos
          </p>
        </div>

        <_DiscountPresetsDataTable
          data={data}
          totalRows={total}
          searchParams={searchParams}
          permissions={permissions}
        />
      </div>
    </PermissionGuard>
  );
}
