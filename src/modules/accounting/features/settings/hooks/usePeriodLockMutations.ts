'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import type { YearMonth } from '../../../shared/utils/journal-entry-types';
import { closeAccountingPeriod, reopenAccountingPeriod } from '../actions.server';
import { formatMonthLong, PERIOD_LOCK_STATUS_QUERY_KEY } from '../period-lock-common';

/**
 * Cierre y reapertura de meses (TSK-760, Fase 8). Los errores de negocio llegan como
 * `{ success: false, error }` (en producción Next redacta los `throw`). Siempre se
 * refresca el estado: si la pantalla estaba desactualizada, el rechazo la corrige.
 */
export function usePeriodLockMutations() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: PERIOD_LOCK_STATUS_QUERY_KEY });
    router.refresh();
  };

  const close = useMutation({
    mutationFn: (input: YearMonth & { postDrafts: boolean }) => closeAccountingPeriod(input),
    onSuccess: (result, input) => {
      refresh();
      if (!result.success) return void toast.error(result.error);
      const month = formatMonthLong(input);
      const posted = result.postedDrafts;
      toast.success(
        posted === 0
          ? `Se cerró ${month}`
          : posted === 1
            ? `Se registró el borrador y se cerró ${month}`
            : `Se registraron ${posted} borradores y se cerró ${month}`
      );
    },
    onError: () => toast.error('Error al cerrar el mes'),
  });

  const reopen = useMutation({
    mutationFn: (input: YearMonth) => reopenAccountingPeriod(input),
    onSuccess: (result, input) => {
      refresh();
      if (!result.success) return void toast.error(result.error);
      toast.success(`Se reabrió ${formatMonthLong(input)}`);
    },
    onError: () => toast.error('Error al reabrir el mes'),
  });

  return { close, reopen };
}
