import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { _TaxReportsTabs } from './components/_TaxReportsTabs';

export function TaxReportsPage() {
  return (
    <PermissionGuard module="commercial.invoices" action="view" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Informes Impositivos</h1>
          <p className="text-muted-foreground">
            Libro IVA Ventas, Libro IVA Compras y Posición Fiscal del período
          </p>
        </div>
        <_TaxReportsTabs />
      </div>
    </PermissionGuard>
  );
}
