'use client';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Button } from '@/shared/components/ui/button';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { type JournalEntryWithLines } from '../../../shared/types';
import { deleteDraftJournalEntry } from '../actions.server';

interface DeleteDraftEntryDialogProps {
  entry: JournalEntryWithLines;
  onClose: () => void;
}

/**
 * "Eliminar borrador" (TSK-760, C6): borra un asiento manual en borrador, por ejemplo
 * uno que ya no se puede registrar y traba el cierre de su mes. El servidor rechaza los
 * borradores de comprobantes o generados por el sistema con un mensaje que lo explica.
 */
export function _DeleteDraftEntryDialog({ entry, onClose }: DeleteDraftEntryDialogProps) {
  const router = useRouter();

  const remove = useMutation({
    mutationFn: () => deleteDraftJournalEntry(entry.id),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Borrador N° ${result.number} eliminado`);
      router.refresh();
      onClose();
    },
    onError: () => toast.error('Error al eliminar el borrador'),
  });

  return (
    <AlertDialog open onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar el borrador N° {entry.number}?</AlertDialogTitle>
          <AlertDialogDescription>
            El asiento &quot;{entry.description}&quot; se borra junto con sus líneas y no se puede
            recuperar. Su número queda sin usar. Solo se eliminan borradores manuales: los de
            comprobantes se corrigen desde el comprobante.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
          <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Eliminar borrador
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
