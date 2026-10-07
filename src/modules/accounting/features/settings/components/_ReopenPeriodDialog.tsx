'use client';

import { Loader2 } from 'lucide-react';

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
import { formatMonthLong, type PeriodMonthStatus } from '../period-lock-common';

interface ReopenPeriodDialogProps {
  month: PeriodMonthStatus | null;
  onOpenChange: (open: boolean) => void;
}

/** Confirmación de la reapertura del último mes cerrado. */
export function _ReopenPeriodDialog({ month, onOpenChange }: ReopenPeriodDialogProps) {
  const { reopen } = usePeriodLockMutations();
  const name = month ? formatMonthLong(month) : '';

  const confirm = () => {
    if (!month) return;
    reopen.mutate(
      { year: month.year, month: month.month },
      { onSettled: () => onOpenChange(false) }
    );
  };

  return (
    <AlertDialog
      open={month !== null}
      onOpenChange={(open) => !reopen.isPending && onOpenChange(open)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Reabrir {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Se van a poder volver a crear, registrar y anular asientos con fecha de {name}. Los
            meses se reabren de a uno, empezando por el último cerrado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={reopen.isPending}>Cancelar</AlertDialogCancel>
          <Button onClick={confirm} disabled={reopen.isPending}>
            {reopen.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reabrir mes
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
