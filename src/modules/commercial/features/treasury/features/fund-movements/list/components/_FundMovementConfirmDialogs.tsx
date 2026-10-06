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

import {
  confirmFundMovement,
  deleteFundMovement,
  type FundMovementListItem,
} from '../actions.server';

interface FundMovementConfirmDialogsProps {
  confirming: FundMovementListItem | null;
  deleting: FundMovementListItem | null;
  onCloseConfirm: () => void;
  onCloseDelete: () => void;
  /** Tras confirmar o eliminar con éxito (refresca el listado). */
  onSuccess: () => void;
}

/**
 * Confirmar y eliminar un borrador desde el listado: `AlertDialog` (nunca
 * `confirm()`), resultado de la action como dato (`success`/`error` → toast).
 * Movido sin cambios desde `_FundMovementsTable` (TSK-720a, fase 5).
 */
export function _FundMovementConfirmDialogs({
  confirming,
  deleting,
  onCloseConfirm,
  onCloseDelete,
  onSuccess,
}: FundMovementConfirmDialogsProps) {
  const [isBusy, setIsBusy] = useState(false);

  const handleConfirm = async () => {
    if (!confirming) return;
    setIsBusy(true);
    try {
      const result = await confirmFundMovement(confirming.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Movimiento confirmado');
      onSuccess();
    } finally {
      setIsBusy(false);
      onCloseConfirm();
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setIsBusy(true);
    try {
      const result = await deleteFundMovement(deleting.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Borrador eliminado');
      onSuccess();
    } finally {
      setIsBusy(false);
      onCloseDelete();
    }
  };

  return (
    <>
      {/* Confirmar */}
      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && onCloseConfirm()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar este movimiento?</AlertDialogTitle>
            <AlertDialogDescription>
              Al confirmarlo se actualizará el saldo del banco/caja y se generará el asiento
              contable. Esta acción no se puede deshacer desde acá.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isBusy}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Eliminar */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && onCloseDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este borrador?</AlertDialogTitle>
            <AlertDialogDescription>
              El movimiento en borrador &quot;{deleting?.description}&quot; se eliminará
              permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
