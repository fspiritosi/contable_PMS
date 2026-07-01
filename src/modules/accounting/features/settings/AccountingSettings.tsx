import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { getAccountingSettings, getActiveAccounts } from './actions.server';
import { _AccountingSettingsForm } from './components/_AccountingSettingsForm';
import { _CommercialIntegrationForm } from './components/_CommercialIntegrationForm';
import { _PeriodLockingForm } from './components/_PeriodLockingForm';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

import { getActiveCompanyId } from '@/shared/lib/company';

async function AccountingSettingsContent({ companyId }: { companyId: string }) {
  const settings = await getAccountingSettings(companyId);
  // Preservar las cuentas ya configuradas (campos *AccountId) aunque hoy no
  // sean imputables, para que sigan mostrándose en los selectores.
  const configuredAccountIds = settings
    ? Object.entries(settings)
        .filter(([key, value]) => key.endsWith('AccountId') && typeof value === 'string')
        .map(([, value]) => value as string)
    : [];
  const accounts = await getActiveAccounts(companyId, configuredAccountIds);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Configuración Contable</h1>
        <p className="text-sm text-muted-foreground">
          Configura los parámetros contables de tu empresa
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ejercicio Fiscal</CardTitle>
          <CardDescription>
            Define el período del ejercicio fiscal
          </CardDescription>
        </CardHeader>
        <CardContent>
          <_AccountingSettingsForm
            companyId={companyId}
            defaultValues={{
              fiscalYearStart: settings?.fiscalYearStart ?? new Date(),
              fiscalYearEnd: settings?.fiscalYearEnd ?? new Date(),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bloqueo de Períodos</CardTitle>
          <CardDescription>
            Bloquea períodos mensuales para evitar modificaciones en asientos contables
          </CardDescription>
        </CardHeader>
        <CardContent>
          <_PeriodLockingForm
            companyId={companyId}
            fiscalYearStart={settings?.fiscalYearStart ?? new Date()}
            fiscalYearEnd={settings?.fiscalYearEnd ?? new Date()}
            lockedUntilDate={settings?.lockedUntilDate ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integración Comercial</CardTitle>
          <CardDescription>
            Configura las cuentas contables por defecto para la generación automática de asientos desde el módulo comercial
          </CardDescription>
        </CardHeader>
        <CardContent>
          <_CommercialIntegrationForm
            companyId={companyId}
            accounts={accounts}
            defaultValues={{
              salesAccountId: settings?.salesAccountId ?? null,
              purchasesAccountId: settings?.purchasesAccountId ?? null,
              receivablesAccountId: settings?.receivablesAccountId ?? null,
              payablesAccountId: settings?.payablesAccountId ?? null,
              vatDebitAccountId: settings?.vatDebitAccountId ?? null,
              vatCreditAccountId: settings?.vatCreditAccountId ?? null,
              defaultCashAccountId: settings?.defaultCashAccountId ?? null,
              defaultBankAccountId: settings?.defaultBankAccountId ?? null,
              expensesAccountId: settings?.expensesAccountId ?? null,
              resultAccountId: settings?.resultAccountId ?? null,
              withholdingIvaEmittedAccountId: settings?.withholdingIvaEmittedAccountId ?? null,
              withholdingGananciasEmittedAccountId: settings?.withholdingGananciasEmittedAccountId ?? null,
              withholdingIibbEmittedAccountId: settings?.withholdingIibbEmittedAccountId ?? null,
              withholdingSussEmittedAccountId: settings?.withholdingSussEmittedAccountId ?? null,
              withholdingIvaSufferedAccountId: settings?.withholdingIvaSufferedAccountId ?? null,
              withholdingGananciasSufferedAccountId: settings?.withholdingGananciasSufferedAccountId ?? null,
              withholdingIibbSufferedAccountId: settings?.withholdingIibbSufferedAccountId ?? null,
              withholdingSussSufferedAccountId: settings?.withholdingSussSufferedAccountId ?? null,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export async function AccountingSettings() {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return (
    <PermissionGuard module="accounting.settings" action="view" redirect>
      <AccountingSettingsContent companyId={companyId} />
    </PermissionGuard>
  );
}
