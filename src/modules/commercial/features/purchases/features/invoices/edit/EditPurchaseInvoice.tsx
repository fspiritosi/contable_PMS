import {
  getSuppliersForSelect,
  getProductsForSelect,
  getPurchaseInvoiceById,
  getCostCentersForSelect,
  getPurchasesDefaultAccount,
} from '../list/actions.server';
import { _PurchaseInvoiceForm } from '../create/components/_PurchaseInvoiceForm';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { isCorrectableStatus } from '@/modules/commercial/shared/correctable-status';
import { AlertCircle } from 'lucide-react';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

interface EditPurchaseInvoiceProps {
  invoiceId: string;
}

export async function EditPurchaseInvoice({ invoiceId }: EditPurchaseInvoiceProps) {
  // Cargar datos en paralelo
  const [suppliers, products, invoice, costCenters, defaultAccount] = await Promise.all([
    getSuppliersForSelect(),
    getProductsForSelect(),
    getPurchaseInvoiceById(invoiceId),
    getCostCentersForSelect(),
    getPurchasesDefaultAccount(),
  ]);

  // Borrador: se edita directo. Confirmada (o con pagos): con la propuesta de corrección
  // en cadena (TSK-792). Anulada: no se edita.
  const isDraft = invoice.status === 'DRAFT';
  if (!isDraft && !isCorrectableStatus(invoice.status)) {
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
              No se puede editar una factura anulada.
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
    // Conserva el vínculo con la OC: sin esto la edición lo desvincularía en silencio.
    purchaseOrderId: invoice.purchaseOrderId ?? '',
    pointOfSale: invoice.pointOfSale,
    number: invoice.number,
    issueDate: new Date(invoice.issueDate),
    dueDate: invoice.dueDate ? new Date(invoice.dueDate) : undefined,
    cae: invoice.cae || '',
    notes: invoice.notes || '',
    lines: invoice.lines.map((line) => ({
      productId: line.productId || undefined,
      purchaseOrderLineId: line.purchaseOrderLineId ?? '',
      description: line.description,
      quantity: line.quantity.toString(),
      unitCost: line.unitCost.toString(),
      vatRate: line.vatRate.toString(),
      costCenterAllocations: line.costCenterAllocations.map((a) => ({
        costCenterId: a.costCenterId,
        percentage: Number(a.percentage),
      })),
    })),
    // Percepciones e impuestos internos ya cargados (TSK-644). Los importes
    // vuelven al formulario como texto, igual que el resto de los montos.
    perceptions: invoice.perceptions.map((p) => ({
      type: p.type,
      jurisdiction: p.jurisdiction ?? '',
      baseAmount: p.baseAmount.toFixed(2),
      amount: p.amount.toFixed(2),
    })),
    internalTaxes: invoice.internalTaxes > 0 ? invoice.internalTaxes.toFixed(2) : '',
  };

  return (
    <PermissionGuard module="commercial.purchases" action="update" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Editar Factura de Compra</h1>
          <p className="text-muted-foreground">
            Modificar factura {invoice.fullNumber} - Estado: {isDraft ? 'Borrador' : 'Confirmada'}
          </p>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {isDraft
              ? 'Estás editando una factura en estado borrador.'
              : 'Al guardar vas a ver una propuesta con todo lo que cambia (asiento, pagos y saldos) antes de confirmar.'}
          </AlertDescription>
        </Alert>

        <_PurchaseInvoiceForm
          suppliers={suppliers}
          products={products}
          costCenters={costCenters}
          defaultAccountType={defaultAccount.type}
          defaultAccountIsFixedAsset={defaultAccount.isFixedAsset}
          mode="edit"
          invoiceId={invoiceId}
          isCorrection={!isDraft}
          defaultValues={defaultValues}
        />
      </div>
    </PermissionGuard>
  );
}
