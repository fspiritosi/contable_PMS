'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { _ReportsSelector, type ReportType } from './_ReportsSelector';
import { _TrialBalanceReport } from './_TrialBalanceReport';
import { _BalanceSheetReport } from './_BalanceSheetReport';
import { _IncomeStatementReport } from './_IncomeStatementReport';
import { _JournalBookReport } from './_JournalBookReport';
import { _GeneralLedgerReport } from './_GeneralLedgerReport';
import { _EntriesWithoutDocumentsReport } from './_EntriesWithoutDocumentsReport';
import { _ReversalLogReport } from './_ReversalLogReport';
import { _DocumentTraceabilityReport } from './_DocumentTraceabilityReport';
import { _FixedAssetsReport } from './_FixedAssetsReport';
import { _PeriodDepreciationsReport } from './_PeriodDepreciationsReport';
import { _BudgetVarianceReport } from './_BudgetVarianceReport';
import { _MonthlyVATReport } from './_MonthlyVATReport';
import { useState } from 'react';

interface ReportsContentProps {
  companyId: string;
}

export function _ReportsContent({ companyId }: ReportsContentProps) {
  const [selectedReport, setSelectedReport] = useState<ReportType>('trial-balance');

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Informes Contables</h1>
        <p className="text-sm text-muted-foreground">
          Genera informes contables para tu empresa
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="h-fit lg:col-span-1 lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle>Informes Disponibles</CardTitle>
            <CardDescription>
              Selecciona el tipo de informe que deseas generar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <_ReportsSelector
              selectedReport={selectedReport}
              onSelect={setSelectedReport}
            />
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          {selectedReport === 'trial-balance' && (
            <_TrialBalanceReport companyId={companyId} />
          )}

          {selectedReport === 'balance-sheet' && (
            <_BalanceSheetReport companyId={companyId} />
          )}

          {selectedReport === 'income-statement' && (
            <_IncomeStatementReport companyId={companyId} />
          )}

          {selectedReport === 'journal-book' && (
            <_JournalBookReport companyId={companyId} />
          )}

          {selectedReport === 'general-ledger' && (
            <_GeneralLedgerReport companyId={companyId} />
          )}

          {selectedReport === 'monthly-vat' && (
            <_MonthlyVATReport companyId={companyId} />
          )}

          {selectedReport === 'entries-without-documents' && (
            <_EntriesWithoutDocumentsReport companyId={companyId} />
          )}

          {selectedReport === 'reversal-log' && (
            <_ReversalLogReport companyId={companyId} />
          )}

          {selectedReport === 'document-traceability' && (
            <_DocumentTraceabilityReport companyId={companyId} />
          )}

          {selectedReport === 'fixed-assets' && (
            <_FixedAssetsReport companyId={companyId} />
          )}

          {selectedReport === 'period-depreciations' && (
            <_PeriodDepreciationsReport companyId={companyId} />
          )}

          {selectedReport === 'budget-variance' && (
            <_BudgetVarianceReport companyId={companyId} />
          )}
        </div>
      </div>
    </div>
  );
}
