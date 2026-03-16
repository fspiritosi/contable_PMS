import { getCustomersForSelect, getWarehousesForDelivery } from '../list/actions.server';
import { _DeliveryNoteForm } from './components/_DeliveryNoteForm';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

export async function CreateDeliveryNote() {
  const [customers, warehouses] = await Promise.all([
    getCustomersForSelect(),
    getWarehousesForDelivery(),
  ]);

  const defaultWarehouse = warehouses.find((w) => w.type === 'MAIN') ?? warehouses[0];

  return (
    <PermissionGuard module="commercial.delivery-notes" action="create" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nuevo Remito de Entrega</h1>
          <p className="text-muted-foreground">Registra la entrega de materiales a un cliente</p>
        </div>
        <_DeliveryNoteForm
          customers={customers}
          warehouses={warehouses}
          defaultWarehouseId={defaultWarehouse?.id}
        />
      </div>
    </PermissionGuard>
  );
}
