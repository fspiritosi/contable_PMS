import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getModulePermissions } from '@/shared/lib/permissions';
import { getFundMovements, getFundMovementCatalogs } from './actions.server';
import { _FundMovementsTable } from './components/_FundMovementsTable';

interface Props {
  searchParams?: DataTableSearchParams;
}

export async function FundMovementsList({ searchParams = {} }: Props) {
  const [result, permissions, catalogs] = await Promise.all([
    getFundMovements(searchParams),
    getModulePermissions('commercial.treasury.fund-movements'),
    getFundMovementCatalogs(),
  ]);

  return (
    <PermissionGuard module="commercial.treasury.fund-movements" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Movimientos de Fondos</h1>
          <p className="text-muted-foreground">
            Aportes de socios, retiros y transferencias entre cuentas. Cada movimiento genera su
            asiento contable automáticamente.
          </p>
        </div>

        <_FundMovementsTable
          data={result.data}
          totalRows={result.total}
          searchParams={searchParams}
          permissions={permissions}
          banks={catalogs.banks}
          cashRegisters={catalogs.cashRegisters}
          partners={catalogs.partners}
          hasContributionsAccount={catalogs.hasContributionsAccount}
        />
      </div>
    </PermissionGuard>
  );
}
