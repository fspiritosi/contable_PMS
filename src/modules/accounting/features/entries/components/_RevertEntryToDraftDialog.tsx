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
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Ban, Loader2 } from 'lucide-react';
import { type JournalEntryWithLines } from '../../../shared/types';
import { getRevertToDraftCheck, revertJournalEntryToDraft } from '../actions.server';

interface RevertEntryToDraftDialogProps {
  entry: JournalEntryWithLines;
  onClose: () => void;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Volver a borrador un asiento registrado (TSK-792). Consulta `getRevertToDraftCheck`:
 * si no se puede (cierre de ejercicio, anulación) lo explica y deshabilita el botón;
 * si pertenece a un comprobante, avisa que queda editable desde su pantalla.
 */
export function _RevertEntryToDraftDialog({ entry, onClose }: RevertEntryToDraftDialogProps) {
  const router = useRouter();

  const check = useQuery({
    queryKey: ['accounting', 'revertToDraftCheck', entry.id],
    queryFn: async () => {
      const result = await getRevertToDraftCheck(entry.id);
      if (!result.success) throw new Error(result.error);
      return result;
    },
  });

  const revert = useMutation({
    mutationFn: () => revertJournalEntryToDraft(entry.id),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Asiento N° ${result.number} vuelto a borrador`);
      router.refresh();
      onClose();
    },
    onError: () => toast.error('Error al volver el asiento a borrador'),
  });

  const blocked = check.data?.blockedMessage ?? null;
  const link = check.data?.link ?? null;
  const canRevert = check.isSuccess && !blocked && !revert.isPending;

  return (
    <AlertDialog open onOpenChange={(open) => !open && !revert.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Volver el asiento a borrador?</AlertDialogTitle>
          <AlertDialogDescription>
            Al volver a borrador, el asiento deja de contar en el mayor y los balances hasta que lo
            registres de nuevo.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {check.isLoading && (
          <p className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando el asiento…
          </p>
        )}
        {check.isError && <p className="text-sm text-destructive">{check.error.message}</p>}
        {blocked && (
          <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p>{blocked}</p>
          </div>
        )}
        {link && !blocked && (
          <p className="text-sm text-muted-foreground">{capitalize(link.label)} queda editable desde su pantalla.</p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={revert.isPending}>{blocked ? 'Cerrar' : 'Cancelar'}</AlertDialogCancel>
          <Button onClick={() => revert.mutate()} disabled={!canRevert}>
            {revert.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Volver a borrador
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
