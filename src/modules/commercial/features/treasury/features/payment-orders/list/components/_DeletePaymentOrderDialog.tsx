'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';

import { deletePaymentOrder } from '../../actions.server';

interface Props {
  paymentOrderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

/** Diálogo de eliminar una OP; extraído de `_PaymentOrdersTable` (TSK-728) para mantenerla < 200 líneas. */
export function _DeletePaymentOrderDialog({
  paymentOrderId,
  open,
  onOpenChange,
  onDeleted,
}: Props) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!paymentOrderId) return;

    setIsDeleting(true);
    try {
      await deletePaymentOrder(paymentOrderId);
      toast.success('Orden de pago eliminada correctamente');
      onDeleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar orden de pago');
    } finally {
      setIsDeleting(false);
      onOpenChange(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar orden de pago?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción eliminará permanentemente la orden de pago y todos sus registros asociados.
            Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Eliminando...' : 'Eliminar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
