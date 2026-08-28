import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import {
  getInvoiceById,
  getSalesCostCentersForSelect,
  getSalesDefaultAccountType,
} from '../list/actions.server';
import {
  getActiveCustomers,
  getActivePointsOfSale,
  getActiveProducts,
} from '../create/helpers.server';
import { InvoiceForm } from '../create/components/_InvoiceForm';
import { redirect } from 'next/navigation';

interface EditInvoiceProps {
  id: string;
}

export async function EditInvoice({ id }: EditInvoiceProps) {
  const [invoice, customers, pointsOfSale, products, costCenters, defaultAccountType] =
    await Promise.all([
      getInvoiceById(id),
      getActiveCustomers(),
      getActivePointsOfSale(),
      getActiveProducts(),
      getSalesCostCentersForSelect(),
      getSalesDefaultAccountType(),
    ]);

  // Solo se pueden editar facturas en borrador
  if (invoice.status !== 'DRAFT') {
    redirect(`/dashboard/commercial/invoices/${id}`);
  }

  // Preparar datos iniciales para el formulario
  const initialData = {
    customerId: invoice.customer.id,
    pointOfSaleId: invoice.pointOfSale.id,
    voucherType: invoice.voucherType as any,
    issueDate: new Date(invoice.issueDate),
    dueDate: invoice.dueDate ? new Date(invoice.dueDate) : undefined,
    notes: invoice.notes || '',
    internalNotes: invoice.internalNotes || '',
    lines: invoice.lines.map((line) => ({
      productId: line.product.id,
      description: line.description,
      quantity: Number(line.quantity).toString(),
      unitPrice: Number(line.unitPrice).toString(),
      vatRate: Number(line.vatRate).toString(),
      discountPercent: line.discountPercent?.toString() ?? '',
      discountAmount: line.discountAmount?.toString() ?? '',
      costCenterAllocations: line.costCenterAllocations.map((a) => ({
        costCenterId: a.costCenterId,
        percentage: Number(a.percentage),
      })),
    })),
    globalDiscountPercent: invoice.globalDiscountPercent?.toString() ?? '',
    globalDiscountAmount: invoice.globalDiscountAmount?.toString() ?? '',
  };

  return (
    <PermissionGuard module="commercial.invoices" action="update" redirect>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Editar Factura {invoice.fullNumber}
          </h2>
          <p className="text-muted-foreground">
            Modifica los datos de la factura en borrador
          </p>
        </div>

        <InvoiceForm
          customers={customers}
          pointsOfSale={pointsOfSale}
          products={products}
          costCenters={costCenters}
          defaultAccountType={defaultAccountType}
          mode="edit"
          invoiceId={id}
          initialData={initialData}
        />
      </div>
    </PermissionGuard>
  );
}
