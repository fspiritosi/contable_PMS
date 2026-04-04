import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getActiveCompanyId } from '@/shared/lib/company';
import { _DashboardSettingsInline } from './components/_DashboardSettingsInline';

export async function DashboardSettings() {
  const companyId = await getActiveCompanyId();

  return (
    <PermissionGuard module="dashboard" action="view" redirect>
      <div className="flex flex-1 flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Configuracion del Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Personaliza que widgets se muestran en tu dashboard y como se comportan los acordeones
          </p>
        </div>
        <_DashboardSettingsInline companyId={companyId ?? ''} />
      </div>
    </PermissionGuard>
  );
}
