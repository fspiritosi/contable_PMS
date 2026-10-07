'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';

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

import { usePeriodLockMutations } from '../hooks/usePeriodLockMutations';
import { formatMonthLong, postDraftsLabel, type PeriodMonthStatus } from '../period-lock-common';

interface ClosePeriodDialogProps {
  month: PeriodMonthStatus | null;
  canPostDrafts: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Confirmación del cierre de un mes (D2). Con borradores en el mes, el único camino es
 * registrarlos todos y cerrar en la misma operación (o reabrir/editar después).
 */
export function _ClosePeriodDialog({ month, canPostDrafts, onOpenChange }: ClosePeriodDialogProps) {
  const { close } = usePeriodLockMutations();
  const drafts = month?.draftCount ?? 0;
  const name = month ? formatMonthLong(month) : '';

  const confirm = () => {
    if (!month) return;
    close.mutate(
      { year: month.year, month: month.month, postDrafts: drafts > 0 },
      { onSettled: () => onOpenChange(false) }
    );
  };

  return (
    <AlertDialog
      open={month !== null}
      onOpenChange={(open) => !close.isPending && onOpenChange(open)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="first-letter:uppercase">
            {drafts > 0
              ? `${name} tiene ${drafts} ${drafts === 1 ? 'borrador' : 'borradores'} sin registrar`
              : `¿Cerrar ${name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Con el mes cerrado no se pueden crear, registrar ni anular asientos con fecha de{' '}
                {name}, ni confirmar comprobantes de ese mes. Se puede reabrir mientras sea el
                último mes cerrado.
              </p>
              {drafts > 0 && (
                <p>
                  Para cerrar, los borradores tienen que quedar registrados. Se registran todos
                  juntos y se cierra el mes; si alguno no se puede registrar, no se registra ninguno
                  y el mes sigue abierto.{' '}
                  <Link href="/dashboard/company/accounting/entries" className="underline">
                    Ver asientos
                  </Link>
                </p>
              )}
              {drafts > 0 && !canPostDrafts && (
                <p className="text-amber-700 dark:text-amber-300">
                  No tenés permiso para registrar asientos: pedile a alguien con ese permiso que los
                  registre o que cierre el mes.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={close.isPending}>Cancelar</AlertDialogCancel>
          <Button onClick={confirm} disabled={close.isPending || (drafts > 0 && !canPostDrafts)}>
            {close.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {drafts > 0 ? postDraftsLabel(drafts) : 'Cerrar mes'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
