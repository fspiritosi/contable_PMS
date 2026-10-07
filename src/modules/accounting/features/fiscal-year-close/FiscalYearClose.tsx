import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

import { ConfigRequired } from '../../shared/components/ConfigRequired';

import { getFiscalYearStatus } from './actions.server';
import { _FiscalYearStatus } from './components/_FiscalYearStatus';

async function FiscalYearCloseContent() {
  const status = await getFiscalYearStatus();

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Cierre de Ejercicio Fiscal</h1>
        <p className="text-sm text-muted-foreground">
          Refunde las cuentas de resultado en Resultado del Ejercicio y abre el ejercicio siguiente
          con los saldos patrimoniales.
        </p>
      </div>

      {status === null ? (
        <ConfigRequired description="Para generar cierres de ejercicio, configurá primero el ejercicio fiscal y las cuentas contables." />
      ) : (
        <_FiscalYearStatus status={status} />
      )}
    </div>
  );
}

export async function FiscalYearClose() {
  return (
    <PermissionGuard module="accounting.fiscal-year-close" action="view" redirect>
      <FiscalYearCloseContent />
    </PermissionGuard>
  );
}
