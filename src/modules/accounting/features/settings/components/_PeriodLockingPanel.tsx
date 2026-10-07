'use client';

import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';

import { usePermissions } from '@/shared/hooks/usePermissions';

import { formatDayUtc } from '../../../shared/utils/utc-month';
import { getPeriodLockStatus } from '../actions.server';
import {
  PERIOD_LOCK_STATUS_QUERY_KEY,
  type PeriodLockStatus,
  type PeriodMonthStatus,
} from '../period-lock-common';
import { _ClosePeriodDialog } from './_ClosePeriodDialog';
import { _PeriodMonthCell } from './_PeriodMonthCell';
import { _ReopenPeriodDialog } from './_ReopenPeriodDialog';

interface PeriodLockingPanelProps {
  initialStatus: PeriodLockStatus | null;
}

/**
 * Bloqueo de Períodos (TSK-760, Fase 8): los meses salen de los `AccountingPeriod` del
 * ejercicio (no de fechas armadas en el navegador, B22). Se cierra solo el primer mes
 * abierto y se reabre solo el último cerrado; el servidor vuelve a validar todo.
 */
export function _PeriodLockingPanel({ initialStatus }: PeriodLockingPanelProps) {
  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission('accounting.settings', 'update');
  const canPostDrafts = hasPermission('accounting.entries', 'approve');
  const [selected, setSelected] = useState<PeriodMonthStatus | null>(null);

  const { data: status } = useQuery({
    queryKey: PERIOD_LOCK_STATUS_QUERY_KEY,
    queryFn: () => getPeriodLockStatus(),
    initialData: initialStatus,
  });

  if (!status) {
    return (
      <p className="text-sm text-muted-foreground">
        Configurá primero el ejercicio fiscal para poder cerrar meses.
      </p>
    );
  }

  const closeOpen = (open: boolean) => !open && setSelected(null);

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {status.lockedUntil ? (
          <>
            Cerrado hasta el <strong>{formatDayUtc(status.lockedUntil)}</strong>.
          </>
        ) : (
          'No hay meses cerrados.'
        )}
      </p>

      {status.lastClosedFiscalYear && (
        <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          El ejercicio N° {status.lastClosedFiscalYear.number} está cerrado (hasta el{' '}
          {formatDayUtc(status.lastClosedFiscalYear.endDay)}): sus meses no se pueden reabrir.
        </p>
      )}

      {status.fiscalYears.map((fiscalYear) => (
        <section key={fiscalYear.number} className="space-y-2">
          <h3 className="text-sm font-medium">
            Ejercicio N° {fiscalYear.number}{' '}
            <span className="font-normal text-muted-foreground">
              ({formatDayUtc(fiscalYear.startDay)} al {formatDayUtc(fiscalYear.endDay)})
            </span>
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {fiscalYear.months.map((month) => (
              <_PeriodMonthCell
                key={`${month.year}-${month.month}`}
                month={month}
                disabled={!canUpdate || selected !== null}
                onSelect={setSelected}
              />
            ))}
          </div>
        </section>
      ))}

      <p className="text-xs text-muted-foreground">
        Los meses se cierran en orden: hacé clic en el primer mes abierto para cerrarlo, o en el
        último cerrado para reabrirlo. Un mes cerrado no admite asientos nuevos ni registrar o
        anular asientos con fecha de ese mes.
      </p>

      <_ClosePeriodDialog
        month={selected?.action === 'close' ? selected : null}
        canPostDrafts={canPostDrafts}
        onOpenChange={closeOpen}
      />
      <_ReopenPeriodDialog
        month={selected?.action === 'reopen' ? selected : null}
        onOpenChange={closeOpen}
      />
    </div>
  );
}
