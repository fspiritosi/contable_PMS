import { BackButton } from '@/shared/components/common/BackButton';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  UrlTabs,
  UrlTabsList,
  UrlTabsTrigger,
  UrlTabsContent,
} from '@/shared/components/ui/url-tabs';
import { getBankAccountById } from '../actions.server';
import { getBankMovementsPaginated, getReconciliationStats, getBankMovementsTotals } from '../../bank-movements/actions.server';
import { _BankMovementsTable } from './components/_BankMovementsTable';
import { _BankAccountSummary } from './components/_BankAccountSummary';
import { _BankAccountDetailActions } from './components/_BankAccountDetailActions';
import { _ReconciliationView } from './components/_ReconciliationView';
import { _QuickMonthFilter } from './components/_QuickMonthFilter';

interface Props {
  bankAccountId: string;
  searchParams: DataTableSearchParams;
}

export async function BankAccountDetail({ bankAccountId, searchParams }: Props) {
  const params = searchParams as Record<string, string>;
  const tab = (params.tab as 'movements' | 'reconciliation') || 'movements';

  const [bankAccount, movementsResult, pendingResult, reconciliationStats, movementsTotals] = await Promise.all([
    getBankAccountById(bankAccountId),
    getBankMovementsPaginated(bankAccountId, searchParams),
    getBankMovementsPaginated(bankAccountId, searchParams, { reconciled: false }),
    getReconciliationStats(bankAccountId),
    getBankMovementsTotals(bankAccountId, searchParams),
  ]);

  if (!bankAccount) {
    notFound();
  }

  return (
    <PermissionGuard module="commercial.treasury.bank-accounts" action="view" redirect>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BackButton label="Volver" size="sm" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            {bankAccount.bankName} - {bankAccount.accountNumber}
          </h1>
          <p className="text-muted-foreground">
            Historial de movimientos bancarios
          </p>
        </div>
        <_BankAccountDetailActions bankAccountId={bankAccountId} />
      </div>

      {/* Summary Card */}
      <_BankAccountSummary bankAccount={bankAccount} />

      {/* Tabs */}
      <UrlTabs value={tab} paramName="tab" replace>
        <UrlTabsList>
          <UrlTabsTrigger value="movements">Movimientos</UrlTabsTrigger>
          <UrlTabsTrigger value="reconciliation">
            Conciliación
            {reconciliationStats.pending > 0 && (
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                {reconciliationStats.pending}
              </span>
            )}
          </UrlTabsTrigger>
        </UrlTabsList>

        <UrlTabsContent value="movements">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Movimientos</CardTitle>
                  <CardDescription>
                    Historial completo de movimientos de la cuenta
                  </CardDescription>
                </div>
              </div>
              <_QuickMonthFilter />
            </CardHeader>
            <CardContent className="space-y-4">
              <_BankMovementsTable
                data={movementsResult.data}
                totalRows={movementsResult.total}
                searchParams={searchParams}
                bankAccountId={bankAccountId}
                bankAccountName={`${bankAccount.bankName} ${bankAccount.accountNumber}`}
                totals={movementsTotals}
              />
            </CardContent>
          </Card>
        </UrlTabsContent>

        <UrlTabsContent value="reconciliation">
          <_ReconciliationView
            data={pendingResult.data}
            totalRows={pendingResult.total}
            searchParams={searchParams}
            stats={reconciliationStats}
            bankAccountId={bankAccountId}
          />
        </UrlTabsContent>
      </UrlTabs>
    </div>
    </PermissionGuard>
  );
}
