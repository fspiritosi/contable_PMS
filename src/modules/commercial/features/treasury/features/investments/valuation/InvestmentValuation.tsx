import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

import { getValuationFiscalYears } from './actions.server';
import { _ValuationForm } from './components/_ValuationForm';

export async function InvestmentValuation() {
  const fiscalYears = await getValuationFiscalYears();

  return (
    <PermissionGuard module="commercial.treasury.investments" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Valuación al cierre</h1>
          <p className="text-muted-foreground">
            Llevá cada tenencia a su valor al cierre del ejercicio. Se genera un asiento en borrador
            con el resultado por tenencia.
          </p>
        </div>

        <_ValuationForm fiscalYears={fiscalYears} />
      </div>
    </PermissionGuard>
  );
}
