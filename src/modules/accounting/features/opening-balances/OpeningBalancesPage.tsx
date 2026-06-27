import { getActiveCompanyId } from '@/shared/lib/company';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getOpeningBalancesPageData } from './actions.server';
import { _OpeningBalancesTabs } from './components/_OpeningBalancesTabs';
import { ConfigRequired } from '../../shared/components/ConfigRequired';

async function OpeningBalancesContent() {
  const data = await getOpeningBalancesPageData();

  if (!data.hasFiscalYear) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Saldos de Apertura</h1>
        </div>
        <ConfigRequired description="Configurá el ejercicio fiscal antes de cargar saldos de apertura." />
      </div>
    );
  }

  if (!data.hasChartOfAccounts) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Saldos de Apertura</h1>
        </div>
        <ConfigRequired
          title="Plan de cuentas requerido"
          description="Creá o importá el plan de cuentas antes de cargar saldos de apertura."
          ctaHref="/dashboard/company/accounting/accounts"
          ctaLabel="Ir a Plan de Cuentas"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Saldos de Apertura</h1>
        <p className="text-sm text-muted-foreground">
          Migrá los saldos iniciales y comprobantes pendientes de tu sistema
          anterior
        </p>
      </div>

      <_OpeningBalancesTabs data={data} />
    </div>
  );
}

export async function OpeningBalancesPage() {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return (
    <PermissionGuard module="accounting.opening-balances" action="view" redirect>
      <OpeningBalancesContent />
    </PermissionGuard>
  );
}
