import { AlertTriangle } from 'lucide-react';

/** Aviso cuando no hay bancos, brokers ni cajas con sesión abierta. */
export function _NoFundAccountsNotice() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        No hay cuentas bancarias ni cajas con sesión abierta disponibles. Creá una cuenta
        bancaria o abrí una caja antes de registrar movimientos de fondos.
      </span>
    </div>
  );
}
