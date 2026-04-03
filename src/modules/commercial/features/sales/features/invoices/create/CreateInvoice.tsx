import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { InvoiceForm } from './components/_InvoiceForm';
import {
  getActiveCustomers,
  getActivePointsOfSale,
  getActiveProducts,
} from './helpers.server';

interface CreateInvoiceProps {
  fromQuoteId?: string;
}

export async function CreateInvoice({ fromQuoteId }: CreateInvoiceProps) {
  const [customers, pointsOfSale, products] = await Promise.all([
    getActiveCustomers(),
    getActivePointsOfSale(),
    getActiveProducts(),
  ]);

  return (
    <PermissionGuard module="commercial.invoices" action="create" redirect>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Nueva Factura de Venta</h2>
          <p className="text-muted-foreground">
            {fromQuoteId
              ? 'Factura generada desde presupuesto. Verificá los datos y completá los campos faltantes.'
              : 'Completa los datos para emitir una nueva factura'}
          </p>
        </div>

        <InvoiceForm
          customers={customers}
          pointsOfSale={pointsOfSale}
          products={products}
          fromQuoteId={fromQuoteId}
        />
      </div>
    </PermissionGuard>
  );
}
