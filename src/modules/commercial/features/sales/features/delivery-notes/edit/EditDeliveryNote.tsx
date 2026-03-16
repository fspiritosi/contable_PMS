import {
  getCustomersForSelect,
  getWarehousesForDelivery,
  getDeliveryNoteById,
} from '../list/actions.server';
import { _DeliveryNoteForm } from '../create/components/_DeliveryNoteForm';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

interface EditDeliveryNoteProps {
  id: string;
}

export async function EditDeliveryNote({ id }: EditDeliveryNoteProps) {
  const [note, customers, warehouses] = await Promise.all([
    getDeliveryNoteById(id),
    getCustomersForSelect(),
    getWarehousesForDelivery(),
  ]);

  if (note.status !== 'PENDING_DELIVERY') {
    return (
      <PermissionGuard module="commercial.delivery-notes" action="update" redirect>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Editar Remito de Entrega</h1>
            <p className="text-muted-foreground">Remito {note.fullNumber}</p>
          </div>

          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No se puede editar este remito. Solo los remitos en estado &quot;Pendiente de
              Entrega&quot; pueden ser modificados.
            </AlertDescription>
          </Alert>
        </div>
      </PermissionGuard>
    );
  }

  const defaultValues = {
    customerId: note.customerId,
    warehouseId: note.warehouseId,
    deliveryDate: new Date(note.deliveryDate),
    notes: note.notes ?? '',
    lines: note.lines.map((line) => ({
      productId: line.productId,
      description: line.description,
      quantity: String(line.quantity),
      notes: line.notes ?? '',
    })),
  };

  return (
    <PermissionGuard module="commercial.delivery-notes" action="update" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Editar Remito de Entrega</h1>
          <p className="text-muted-foreground">
            Modificar remito {note.fullNumber} — Pendiente de Entrega
          </p>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Estás editando un remito pendiente de entrega. Al guardar, se recalculará el stock del
            almacén.
          </AlertDescription>
        </Alert>

        <_DeliveryNoteForm
          customers={customers}
          warehouses={warehouses}
          editMode
          noteId={id}
          defaultValues={defaultValues}
        />
      </div>
    </PermissionGuard>
  );
}
