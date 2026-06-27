import { getActiveCompanyId } from '@/shared/lib/company';
import { getBudgetsPageData } from './actions.server';
import { _BudgetsContent } from './components/_BudgetsContent';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { ConfigRequired } from '../../shared/components/ConfigRequired';

async function BudgetsPageContent() {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const data = await getBudgetsPageData();

  if (!data.hasSettings) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Presupuestos</h1>
          <p className="text-sm text-muted-foreground">
            Control presupuestario por cuenta contable y periodo fiscal
          </p>
        </div>
        <ConfigRequired description="Configurá el ejercicio fiscal antes de gestionar presupuestos." />
      </div>
    );
  }

  if (!data.hasResultAccounts) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Presupuestos</h1>
          <p className="text-sm text-muted-foreground">
            Control presupuestario por cuenta contable y periodo fiscal
          </p>
        </div>
        <ConfigRequired
          title="Cuentas de resultado requeridas"
          description="Creá cuentas de resultado (Ingresos o Gastos) en el Plan de Cuentas antes de crear presupuestos."
          ctaHref="/dashboard/company/accounting/accounts"
          ctaLabel="Ir a Plan de Cuentas"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Presupuestos</h1>
        <p className="text-sm text-muted-foreground">
          Control presupuestario por cuenta contable y periodo fiscal
        </p>
      </div>

      <_BudgetsContent
        currentFiscalYear={data.currentFiscalYear}
        fiscalYearStart={
          data.settings!.fiscalYearStart
        }
      />
    </div>
  );
}

export async function BudgetsPage() {
  return (
    <PermissionGuard module="accounting.budgets" action="view" redirect>
      <BudgetsPageContent />
    </PermissionGuard>
  );
}
