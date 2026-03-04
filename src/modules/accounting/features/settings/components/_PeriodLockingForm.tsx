'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import moment from 'moment';
import { Lock, LockOpen, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
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

import { setLockedPeriod } from '../actions.server';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface PeriodLockingFormProps {
  companyId: string;
  fiscalYearStart: Date;
  fiscalYearEnd: Date;
  lockedUntilDate: Date | null;
}

interface PendingAction {
  type: 'lock' | 'unlock';
  monthLabel: string;
  targetDate: Date | null;
}

interface MonthCell {
  label: string;
  endOfMonth: moment.Moment;
  isLocked: boolean;
  isLastLocked: boolean;
  isClickable: boolean;
}

export function _PeriodLockingForm({
  companyId,
  fiscalYearStart,
  fiscalYearEnd,
  lockedUntilDate,
}: PeriodLockingFormProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission('accounting.settings', 'update');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const lockedUntil = lockedUntilDate ? moment(lockedUntilDate) : null;

  const months: MonthCell[] = [];
  const cursor = moment(fiscalYearStart).startOf('month');
  const fiscalEnd = moment(fiscalYearEnd).endOf('month');

  while (cursor.isSameOrBefore(fiscalEnd, 'month')) {
    const endOfMonth = cursor.clone().endOf('month');
    const isLocked = lockedUntil !== null && endOfMonth.isSameOrBefore(lockedUntil, 'day');
    const isLastLocked =
      lockedUntil !== null && endOfMonth.isSame(lockedUntil, 'month') && isLocked;

    months.push({
      label: cursor.locale('es').format('MMM YYYY'),
      endOfMonth,
      isLocked,
      isLastLocked,
      isClickable: false,
    });

    cursor.add(1, 'month');
  }

  // Mark clickable months: first unlocked month (to lock) and last locked month (to unlock)
  const firstUnlockedIndex = months.findIndex((m) => !m.isLocked);
  const lastLockedIndex = months.findLastIndex((m) => m.isLastLocked);

  months.forEach((m, i) => {
    m.isClickable = i === firstUnlockedIndex || i === lastLockedIndex;
  });

  function handleMonthClick(month: MonthCell) {
    if (!month.isClickable || isLoading || !canUpdate) return;

    if (month.isLastLocked) {
      // Unlock: set lockedUntilDate to previous month's end, or null if first
      const prevIndex = months.indexOf(month) - 1;
      const targetDate =
        prevIndex >= 0 ? months[prevIndex].endOfMonth.toDate() : null;

      setPendingAction({
        type: 'unlock',
        monthLabel: month.label,
        targetDate,
      });
    } else {
      // Lock up to and including this month
      setPendingAction({
        type: 'lock',
        monthLabel: month.label,
        targetDate: month.endOfMonth.toDate(),
      });
    }
  }

  async function handleConfirm() {
    if (!pendingAction) return;

    setIsLoading(true);
    setPendingAction(null);

    try {
      await setLockedPeriod(companyId, pendingAction.targetDate);

      if (pendingAction.type === 'lock') {
        toast.success(`Período bloqueado hasta ${pendingAction.monthLabel}`);
      } else {
        toast.success('Período desbloqueado correctamente');
      }

      router.refresh();
    } catch {
      toast.error('Error al actualizar el período de bloqueo');
    } finally {
      setIsLoading(false);
    }
  }

  const confirmTitle =
    pendingAction?.type === 'lock'
      ? `¿Bloquear hasta ${pendingAction.monthLabel}?`
      : `¿Desbloquear ${pendingAction?.monthLabel}?`;

  const confirmDescription =
    pendingAction?.type === 'lock'
      ? `Se bloquearán todos los períodos hasta el final de ${pendingAction?.monthLabel}. No se podrán registrar ni modificar asientos en estos períodos.`
      : `Se desbloqueará el período de ${pendingAction?.monthLabel}, permitiendo nuevamente registrar asientos en ese mes.`;

  return (
    <div className="space-y-4">
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Actualizando período...</span>
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {months.map((month, index) => {
          const isNonClickableLocked = month.isLocked && !month.isLastLocked;

          if (isNonClickableLocked) {
            return (
              <div
                key={index}
                className="rounded-lg border p-3 text-center bg-muted opacity-50"
              >
                <div className="flex flex-col items-center gap-1">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium capitalize">{month.label}</span>
                </div>
              </div>
            );
          }

          if (month.isClickable) {
            return (
              <button
                key={index}
                onClick={() => handleMonthClick(month)}
                disabled={isLoading || !canUpdate}
                className={`rounded-lg border p-3 text-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  canUpdate ? 'cursor-pointer hover:border-primary' : 'cursor-default'
                } ${month.isLocked ? 'bg-muted' : ''}`}
              >
                <div className="flex flex-col items-center gap-1">
                  {month.isLocked ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <LockOpen className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-xs font-medium capitalize">{month.label}</span>
                </div>
              </button>
            );
          }

          // Open, non-clickable month
          return (
            <div
              key={index}
              className="rounded-lg border p-3 text-center"
            >
              <div className="flex flex-col items-center gap-1">
                <LockOpen className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium capitalize">{month.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Haz clic en el primer mes desbloqueado para bloquearlo, o en el último mes bloqueado para desbloquearlo.
      </p>

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button onClick={handleConfirm} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Procesando...
                  </>
                ) : (
                  'Confirmar'
                )}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
