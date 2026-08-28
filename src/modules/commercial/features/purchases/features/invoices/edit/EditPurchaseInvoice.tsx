import {
  getSuppliersForSelect,
  getProductsForSelect,
  getPurchaseInvoiceById,
  getCostCentersForSelect,
  getPurchasesDefaultAccountType,
} from '../list/actions.server';
import { _PurchaseInvoiceForm } from '../create/components/_PurchaseInvoiceForm';
import { redirect } from 'next/navigation';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

interface EditPurchaseInvoiceProps {
  invoiceId: string;
}

export async function EditPurchaseInvoice({ invoiceId }: EditPurchaseInvoiceProps) {
  // Cargar datos en paralelo
  const [suppliers, products, invoice, costCenters, defaultAccountType] = await Promise.all([
    getSuppliersForSelect(),
    getProductsForSelect(),
    getPurchaseInvoiceById(invoiceId),
    getCostCentersForSelect(),
    getPurchasesDefaultAccountType(),
  ]);

  // Validar que la factura esté en estado DRAFT
  if (invoice.status !== 'DRAFT') {
    return (
      <PermissionGuard module="commercial.purchases" action="update" redirect>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Editar Factura de Compra</h1>
            <p className="text-muted-foreground">Factura {invoice.fullNumber}</p>
          </div>

          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No se puede editar una factura confirmada. Solo las facturas en estado borrador
              pueden ser modificadas. Si necesitas realizar cambios, cancela esta factura y crea
              una nueva.
            </AlertDescription>
          </Alert>
        </div>
      </PermissionGuard>
    );
  }

  // Preparar valores por defecto del formulario
  const defaultValues = {
    supplierId: invoice.supplierId,
    voucherType: invoice.voucherType,
    pointOfSale: invoice.pointOfSale,
    number: invoice.number,
    issueDate: new Date(invoice.issueDate),
    dueDate: invoice.dueDate ? new Date(invoice.dueDate) : undefined,
    cae: invoice.cae || '',
    notes: invoice.notes || '',
    lines: invoice.lines.map((line) => ({
      productId: line.productId || undefined,
      description: line.description,
      quantity: line.quantity.toString(),
      unitCost: line.unitCost.toString(),
      vatRate: line.vatRate.toString(),
      costCenterAllocations: line.costCenterAllocations.map((a) => ({
        costCenterId: a.costCenterId,
        percentage: Number(a.percentage),
      })),
    })),
  };

  return (
    <PermissionGuard module="commercial.purchases" action="update" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Editar Factura de Compra</h1>
          <p className="text-muted-foreground">
            Modificar factura {invoice.fullNumber} - Estado: Borrador
          </p>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Estás editando una factura en estado borrador. Una vez confirmada, no podrá ser
            modificada.
          </AlertDescription>
        </Alert>

        <_PurchaseInvoiceForm
          suppliers={suppliers}
          products={products}
          costCenters={costCenters}
          defaultAccountType={defaultAccountType}
          mode="edit"
          invoiceId={invoiceId}
          defaultValues={defaultValues}
        />
      </div>
    </PermissionGuard>
  );
}
