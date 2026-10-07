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
import { AlertTriangle, Ban, Loader2 } from 'lucide-react';
import { type JournalEntryWithLines } from '../../../shared/types';
import { formatDayUtc } from '../../../shared/utils';
import { getReversalCheck, reverseJournalEntry } from '../actions.server';

interface ReverseEntryDialogProps {
  entry: JournalEntryWithLines;
  onClose: () => void;
}

/**
 * Anulación desde Asientos (TSK-760, Fase 10). Antes de confirmar consulta
 * `getReversalCheck`: si el asiento pertenece a un documento, explica por qué no se
 * puede anular y deshabilita el botón; si es de sistema sin vínculo, avisa (D6).
 */
export function _ReverseEntryDialog({ entry, onClose }: ReverseEntryDialogProps) {
  const router = useRouter();

  const check = useQuery({
    queryKey: ['accounting', 'reversalCheck', entry.id],
    queryFn: async () => {
      const result = await getReversalCheck(entry.id);
      if (!result.success) throw new Error(result.error);
      return result;
    },
  });

  const reverse = useMutation({
    mutationFn: () => reverseJournalEntry({ entryId: entry.id }),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Asiento N° ${entry.number} anulado con el asiento N° ${result.reversalNumber}`);
      router.refresh();
      onClose();
    },
    onError: () => toast.error('Error al anular el asiento'),
  });

  const blocked = check.data?.blockedMessage ?? null;
  const canReverse = check.isSuccess && !blocked && !reverse.isPending;

  return (
    <AlertDialog open onOpenChange={(open) => !open && !reverse.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Anular asiento contable?</AlertDialogTitle>
          <AlertDialogDescription>
            Estás por anular el asiento N° {entry.number}. Se creará un asiento de reversión con los
            importes invertidos para anular el efecto del asiento original.
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
        {check.data?.warning && (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{check.data.warning}</p>
          </div>
        )}
        {check.data && !blocked && (
          <p className="text-sm text-muted-foreground">
            La anulación se registra con fecha de hoy ({formatDayUtc(check.data.date)}).
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={reverse.isPending}>{blocked ? 'Cerrar' : 'Cancelar'}</AlertDialogCancel>
          <Button variant="destructive" onClick={() => reverse.mutate()} disabled={!canReverse}>
            {reverse.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Anular
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
