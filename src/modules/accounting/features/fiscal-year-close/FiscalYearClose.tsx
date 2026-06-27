import { getActiveCompanyId } from '@/shared/lib/company';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getFiscalYearStatus } from './actions.server';
import { _FiscalYearStatus } from './components/_FiscalYearStatus';
import { ConfigRequired } from '../../shared/components/ConfigRequired';

async function FiscalYearCloseContent({ companyId }: { companyId: string }) {
  const status = await getFiscalYearStatus(companyId);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Cierre de Ejercicio Fiscal</h1>
        <p className="text-sm text-muted-foreground">
          Genera el asiento de cierre que cancela las cuentas de resultado del período
        </p>
      </div>

      {status === null ? (
        <ConfigRequired description="Para generar cierres de ejercicio, configurá primero el ejercicio fiscal y las cuentas contables." />
      ) : (
        <_FiscalYearStatus companyId={companyId} status={status} />
      )}
    </div>
  );
}

export async function FiscalYearClose() {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return (
    <PermissionGuard module="accounting.fiscal-year-close" action="view" redirect>
      <FiscalYearCloseContent companyId={companyId} />
    </PermissionGuard>
  );
}
