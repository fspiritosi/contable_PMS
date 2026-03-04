'use client';

import * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { CalendarIcon, X } from 'lucide-react';
import moment from 'moment';

import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Calendar } from '@/shared/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover';

interface DataTableDateRangeFilterProps<TData, TValue> {
  column?: Column<TData, TValue>;
  title: string;
}

/**
 * Filtro de rango de fechas para DataTable
 *
 * Los valores se almacenan como array de strings ISO: [from, to]
 * en el estado de filtros de la columna.
 */
export function DataTableDateRangeFilter<TData, TValue>({
  column,
  title,
}: DataTableDateRangeFilterProps<TData, TValue>) {
  const filterValue = column?.getFilterValue() as string[] | undefined;

  const from = filterValue?.[0] ? new Date(filterValue[0]) : undefined;
  const to = filterValue?.[1] ? new Date(filterValue[1]) : undefined;

  const handleSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (!range) {
      column?.setFilterValue(undefined);
      return;
    }

    const values: string[] = [];
    values.push(range.from ? range.from.toISOString() : '');
    values.push(range.to ? range.to.toISOString() : '');

    column?.setFilterValue(values.some(Boolean) ? values : undefined);
  };

  const hasValue = from || to;

  const label = hasValue
    ? `${from ? moment(from).format('DD/MM/YY') : '...'} - ${to ? moment(to).format('DD/MM/YY') : '...'}`
    : title;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-8 border-dashed', hasValue && 'border-solid')}
          data-testid={`filter-date-${column?.id}`}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {label}
          {hasValue && (
            <span
              role="button"
              className="ml-2 rounded-full hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                column?.setFilterValue(undefined);
              }}
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={from || to ? { from, to } : undefined}
          onSelect={(range) =>
            handleSelect(
              range ? { from: range.from, to: range.to } : undefined
            )
          }
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
}
