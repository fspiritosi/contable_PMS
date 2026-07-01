import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getAccounts } from './actions.server';
import { buildAccountTree } from '../../shared/utils';
import { getAccountRollupBalances } from '../../shared/utils/balances';
import { getCurrentFiscalYear } from '../../shared/utils/fiscal-year';
import { _AccountsTable } from './components/_AccountsTable';
import { _CreateAccountButton } from './components/_CreateAccountButton';
import { _ImportExportButtons } from './components/_ImportExportButtons';

import { getActiveCompanyId } from '@/shared/lib/company';

export async function AccountsList() {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return (
    <PermissionGuard module="accounting.accounts" action="view" redirect>
      <AccountsListContent companyId={companyId} />
    </PermissionGuard>
  );
}

async function AccountsListContent({ companyId }: { companyId: string }) {
  const accounts = await getAccounts(companyId);
  const accountTree = buildAccountTree(accounts);

  // Ejercicio en curso: define la fecha de corte de saldos y el estado vigente.
  const currentFiscalYear = await getCurrentFiscalYear(companyId);

  // Saldos con roll-up: imputables muestran su saldo; sumatoria, la suma de hijas.
  const rollup = await getAccountRollupBalances(companyId, currentFiscalYear?.endDate);
  const balances: Record<string, number> = {};
  rollup.forEach((value, accountId) => {
    balances[accountId] = value.balance;
  });

  const fiscalYearStart = currentFiscalYear?.startDate ?? null;
  const fiscalYearNumber = currentFiscalYear?.number ?? null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Plan de Cuentas</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona las cuentas contables de tu empresa
          </p>
        </div>
        <div className="flex gap-2">
          <_ImportExportButtons companyId={companyId} />
          <PermissionGuard module="accounting.accounts" action="create">
            <_CreateAccountButton companyId={companyId} />
          </PermissionGuard>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cuentas Contables</CardTitle>
          <CardDescription>
            Lista de cuentas contables organizadas jerárquicamente
          </CardDescription>
        </CardHeader>
        <CardContent>
          <_AccountsTable
            accounts={accountTree}
            companyId={companyId}
            balances={balances}
            fiscalYearStart={fiscalYearStart}
            fiscalYearNumber={fiscalYearNumber}
          />
        </CardContent>
      </Card>
    </div>
  );
}
