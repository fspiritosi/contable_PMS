'use client';

import { Lock, LockOpen } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import type { PeriodMonthStatus } from '../period-lock-common';

interface PeriodMonthCellProps {
  month: PeriodMonthStatus;
  disabled: boolean;
  onSelect: (month: PeriodMonthStatus) => void;
}

const ACTION_LABELS = { close: 'Cerrar', reopen: 'Reabrir' } as const;

/** Un mes de la grilla: candado, borradores pendientes y, si corresponde, la acción. */
export function _PeriodMonthCell({ month, disabled, onSelect }: PeriodMonthCellProps) {
  const Icon = month.isClosed ? Lock : LockOpen;
  const content = (
    <div className="flex flex-col items-center gap-1">
      <Icon className={cn('h-4 w-4', !month.isClosed && 'text-muted-foreground')} />
      <span className="text-xs font-medium capitalize">{month.label}</span>
      {month.draftCount > 0 && (
        <span
          className="rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
          title={`${month.draftCount} asientos en borrador con fecha de este mes`}
        >
          {month.draftCount} {month.draftCount === 1 ? 'borrador' : 'borradores'}
        </span>
      )}
      {month.action && (
        <span className="text-[10px] text-primary">{ACTION_LABELS[month.action]}</span>
      )}
    </div>
  );

  if (!month.action) {
    return (
      <div
        className={cn('rounded-lg border p-3 text-center', month.isClosed && 'bg-muted opacity-60')}
        data-testid={`period-month-${month.year}-${month.month}`}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(month)}
      disabled={disabled}
      aria-label={`${ACTION_LABELS[month.action]} ${month.label}`}
      data-testid={`period-month-${month.year}-${month.month}`}
      className={cn(
        'rounded-lg border border-primary/40 p-3 text-center transition-colors hover:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-primary/40',
        month.isClosed && 'bg-muted'
      )}
    >
      {content}
    </button>
  );
}
