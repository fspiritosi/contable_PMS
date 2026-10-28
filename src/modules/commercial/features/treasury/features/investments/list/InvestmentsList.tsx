import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

import { getInvestmentHoldings } from './actions.server';
import { _InvestmentsTable } from './components/_InvestmentsTable';

export async function InvestmentsList() {
  const holdings = await getInvestmentHoldings();

  return (
    <PermissionGuard module="commercial.treasury.investments" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inversiones</h1>
          <p className="text-muted-foreground">
            Tenencias de acciones, bonos, fondos y otros instrumentos que custodian tus bancos y
            brokers. Las compras y ventas se cargan como Movimientos de Fondos.
          </p>
        </div>

        <_InvestmentsTable data={holdings} />
      </div>
    </PermissionGuard>
  );
}
