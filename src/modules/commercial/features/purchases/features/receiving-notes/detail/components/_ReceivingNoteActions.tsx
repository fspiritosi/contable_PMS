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
import type { ReceivingNoteStatus } from '@/generated/prisma/enums';
import {
  confirmReceivingNote,
  cancelReceivingNote,
  deleteReceivingNote,
} from '../../list/actions.server';

interface ReceivingNoteActionsProps {
  noteId: string;
  status: ReceivingNoteStatus;
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

export function _ReceivingNoteActions({ noteId, status, fullNumber }: ReceivingNoteActionsProps) {
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
        router.push('/dashboard/commercial/receiving-notes');
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
        {status === 'DRAFT' && (
          <>
            {hasPermission('commercial.receiving-notes', 'approve') && (
              <Button
                variant="default"
                size="sm"
                disabled={loading}
                onClick={() =>
                  setPendingAction({
                    title: '¿Confirmar remito?',
                    description: `El remito ${fullNumber} será confirmado. Se actualizará el stock del almacén.`,
                    action: () => confirmReceivingNote(noteId),
                    successMessage: 'Remito confirmado correctamente',
                  })
                }
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Confirmar
              </Button>
            )}
            {hasPermission('commercial.receiving-notes', 'delete') && (
              <Button
                variant="destructive"
                size="sm"
                disabled={loading}
                onClick={() =>
                  setPendingAction({
                    title: '¿Eliminar remito?',
                    description: `El remito ${fullNumber} será eliminado permanentemente. Esta acción no se puede deshacer.`,
                    action: () => deleteReceivingNote(noteId),
                    successMessage: 'Remito eliminado',
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

        {status === 'CONFIRMED' && hasPermission('commercial.receiving-notes', 'delete') && (
          <Button
            variant="destructive"
            size="sm"
            disabled={loading}
            onClick={() =>
              setPendingAction({
                title: '¿Anular remito?',
                description: `El remito ${fullNumber} será anulado. Se revertirá el stock del almacén.`,
                action: () => cancelReceivingNote(noteId),
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
              className={pendingAction?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
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
