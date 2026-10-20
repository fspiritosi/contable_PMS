import { getSuppliersForSelect, getWarehousesForSelect } from '../list/actions.server';
import { _ReceivingNoteForm } from './components/_ReceivingNoteForm';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { businessToday } from '@/shared/utils/date-input';

interface Props {
  purchaseInvoiceId?: string;
  supplierId?: string;
}

export async function CreateReceivingNote({ purchaseInvoiceId, supplierId }: Props) {
  const [suppliers, warehouses] = await Promise.all([
    getSuppliersForSelect(),
    getWarehousesForSelect(),
  ]);

  // Pre-populate initial values if coming from a purchase invoice
  const defaultWarehouse = warehouses.find((w) => w.type === 'MAIN') ?? warehouses[0];
  const defaultValues = purchaseInvoiceId
    ? {
        purchaseInvoiceId,
        supplierId: supplierId || '',
        warehouseId: defaultWarehouse?.id ?? '',
        purchaseOrderId: '',
        receptionDate: businessToday(),
        notes: '' as string | null,
        lines: [] as { productId: string; description: string; quantity: string; purchaseOrderLineId?: string; notes?: string | null }[],
      }
    : undefined;

  return (
    <PermissionGuard module="commercial.receiving-notes" action="create" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nuevo Remito de Recepción</h1>
          <p className="text-muted-foreground">
            Registra la recepción de materiales de un proveedor
          </p>
        </div>

        <_ReceivingNoteForm
          suppliers={suppliers}
          warehouses={warehouses}
          defaultValues={defaultValues}
        />
      </div>
    </PermissionGuard>
  );
}
