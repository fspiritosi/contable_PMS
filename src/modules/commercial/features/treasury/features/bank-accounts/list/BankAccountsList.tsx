import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { getBankAccounts, getBankAccountsPaginated, getBankAccountFacetCounts } from './actions.server';
import { _BankAccountsTable } from './components/_BankAccountsTable';

interface Props {
  searchParams?: DataTableSearchParams;
}

export async function BankAccountsList({ searchParams = {} }: Props) {
  const [allAccounts, paginatedResult, facetCounts] = await Promise.all([
    getBankAccounts({ includeInactive: true }),
    getBankAccountsPaginated(searchParams),
    getBankAccountFacetCounts(),
  ]);

  // Calcular KPIs desde todas las cuentas
  const totalBalance = allAccounts.reduce((acc, account) => {
    if (account.status === 'ACTIVE') {
      return acc + account.balance;
    }
    return acc;
  }, 0);

  const activeCount = allAccounts.filter((a) => a.status === 'ACTIVE').length;
  const totalMovements = allAccounts.reduce((acc, account) => acc + (account._count?.movements || 0), 0);

  return (
    <PermissionGuard module="commercial.treasury.bank-accounts" action="view" redirect>
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cuentas Bancarias y Brokers</h1>
        <p className="text-muted-foreground">
          Gestión de cuentas bancarias y movimientos
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total en Bancos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${totalBalance.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground">
              Cuentas activas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cuentas Activas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount}</div>
            <p className="text-xs text-muted-foreground">
              De {allAccounts.length} totales
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Movimientos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMovements}</div>
            <p className="text-xs text-muted-foreground">
              Total registrados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <_BankAccountsTable
        data={paginatedResult.data}
        totalRows={paginatedResult.total}
        searchParams={searchParams}
        facetCounts={facetCounts}
      />
    </div>
    </PermissionGuard>
  );
}
