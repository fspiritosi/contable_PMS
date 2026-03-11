'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Calendar, X } from 'lucide-react';
import moment from 'moment';
import 'moment/locale/es';

moment.locale('es');

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function _QuickMonthFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Detectar si ya hay un filtro de mes activo desde los searchParams
  const currentDateFilter = searchParams.get('date');
  const activeMonth = useMemo(() => {
    if (!currentDateFilter) return null;
    const parts = currentDateFilter.split(',');
    if (parts.length < 1 || !parts[0]) return null;
    const from = moment(parts[0]);
    if (!from.isValid()) return null;
    // Verificar que es el primer día del mes
    if (from.date() !== 1) return null;
    return from.format('YYYY-MM');
  }, [currentDateFilter]);

  const setMonthFilter = useCallback(
    (yearMonth: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      // Reset pagination when filtering
      params.delete('page');

      if (yearMonth) {
        const start = moment(yearMonth, 'YYYY-MM').startOf('month');
        const end = start.clone().endOf('month');
        params.set('date', `${start.toISOString()},${end.toISOString()}`);
      } else {
        params.delete('date');
      }

      const query = params.toString();
      router.push(`?${query}`);
    },
    [router, searchParams],
  );

  const thisYear = moment().year();
  const years = useMemo(() => {
    const result: number[] = [];
    for (let y = thisYear; y >= thisYear - 2; y--) {
      result.push(y);
    }
    return result;
  }, [thisYear]);

  const activeMonthIdx = activeMonth ? moment(activeMonth, 'YYYY-MM').month() : null;
  const activeYear = activeMonth ? moment(activeMonth, 'YYYY-MM').year() : thisYear;

  const handleMonthSelect = useCallback(
    (monthIdx: string) => {
      const year = activeYear;
      const newPeriod = moment({ year, month: parseInt(monthIdx) }).format('YYYY-MM');
      setMonthFilter(newPeriod);
    },
    [activeYear, setMonthFilter],
  );

  const handleYearSelect = useCallback(
    (year: string) => {
      const month = activeMonthIdx ?? moment().month();
      const newPeriod = moment({ year: parseInt(year), month }).format('YYYY-MM');
      setMonthFilter(newPeriod);
    },
    [activeMonthIdx, setMonthFilter],
  );

  const handleQuickMonth = useCallback(
    (offset: number) => {
      const target = moment().subtract(offset, 'months');
      setMonthFilter(target.format('YYYY-MM'));
    },
    [setMonthFilter],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Mes:</span>
      <Button
        variant={activeMonth === moment().format('YYYY-MM') ? 'default' : 'outline'}
        size="sm"
        className="h-7 text-xs"
        onClick={() => handleQuickMonth(0)}
      >
        Actual
      </Button>
      <Button
        variant={activeMonth === moment().subtract(1, 'month').format('YYYY-MM') ? 'default' : 'outline'}
        size="sm"
        className="h-7 text-xs"
        onClick={() => handleQuickMonth(1)}
      >
        Anterior
      </Button>

      <div className="flex items-center gap-1">
        <Select
          value={activeMonthIdx !== null ? String(activeMonthIdx) : ''}
          onValueChange={handleMonthSelect}
        >
          <SelectTrigger className="h-7 w-[110px] text-xs">
            <SelectValue placeholder="Mes" />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, idx) => (
              <SelectItem key={idx} value={String(idx)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={activeMonth ? String(activeYear) : ''}
          onValueChange={handleYearSelect}
        >
          <SelectTrigger className="h-7 w-[80px] text-xs">
            <SelectValue placeholder="Año" />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activeMonth && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setMonthFilter(null)}
        >
          <X className="mr-1 h-3 w-3" />
          Limpiar
        </Button>
      )}
    </div>
  );
}
