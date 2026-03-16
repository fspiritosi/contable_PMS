'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/shared/components/ui/button';
import { CheckCircle, Ban, Trash2, Loader2 } from 'lucide-react';
import { usePermissions } from '@/shared/hooks/usePermissions';
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
import type { DeliveryNoteStatus } from '@/generated/prisma/enums';
import {
  acceptDeliveryNote,
  cancelDeliveryNote,
  deleteDeliveryNote,
} from '../../list/actions.server';

interface DeliveryNoteActionsProps {
  noteId: string;
  status: DeliveryNoteStatus;
  fullNumber: string;
}

interface PendingAction {
  title: string;
  description: string;
  action: () => Promise<unknown>;
  successMessage: string;
  redirectToList?: boolean;
  destructive?: boolean;
}

export function _DeliveryNoteActions({ noteId, status, fullNumber }: DeliveryNoteActionsProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const executeAction = async () => {
    if (!pendingAction) return;

    try {
      setLoading(true);
      await pendingAction.action();
      toast.success(pendingAction.successMessage);
      if (pendingAction.redirectToList) {
        router.push('/dashboard/commercial/delivery-notes');
      } else {
        router.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al procesar la acción');
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {status === 'PENDING_DELIVERY' && (
          <>
            {hasPermission('commercial.delivery-notes', 'approve') && (
              <Button
                variant="default"
                size="sm"
                disabled={loading}
                onClick={() =>
                  setPendingAction({
                    title: '¿Aceptar remito?',
                    description: `El remito ${fullNumber} será marcado como aceptado por el cliente.`,
                    action: () => acceptDeliveryNote(noteId),
                    successMessage: 'Remito aceptado correctamente',
                  })
                }
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Aceptar
              </Button>
            )}
            {hasPermission('commercial.delivery-notes', 'delete') && (
              <Button
                variant="destructive"
                size="sm"
                disabled={loading}
                onClick={() =>
                  setPendingAction({
                    title: '¿Eliminar remito?',
                    description: `El remito ${fullNumber} será eliminado permanentemente. Se revertirá el stock descontado. Esta acción no se puede deshacer.`,
                    action: () => deleteDeliveryNote(noteId),
                    successMessage: 'Remito eliminado correctamente',
                    redirectToList: true,
                    destructive: true,
                  })
                }
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </Button>
            )}
          </>
        )}

        {status === 'ACCEPTED' && hasPermission('commercial.delivery-notes', 'delete') && (
          <Button
            variant="destructive"
            size="sm"
            disabled={loading}
            onClick={() =>
              setPendingAction({
                title: '¿Anular remito?',
                description: `El remito ${fullNumber} será anulado. Se revertirá el stock del almacén.`,
                action: () => cancelDeliveryNote(noteId),
                successMessage: 'Remito anulado correctamente',
                destructive: true,
              })
            }
          >
            <Ban className="mr-2 h-4 w-4" />
            Anular
          </Button>
        )}
      </div>

      <AlertDialog
        open={!!pendingAction}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendingAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeAction}
              disabled={loading}
              className={
                pendingAction?.destructive
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : ''
              }
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
