'use client';

import * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { Search, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover';
import { Badge } from '@/shared/components/ui/badge';
import { Separator } from '@/shared/components/ui/separator';

interface DataTableTextFilterProps<TData, TValue> {
  column?: Column<TData, TValue>;
  title: string;
  placeholder?: string;
}

/**
 * Filtro de texto libre para DataTable
 *
 * El valor se almacena como array de un string: [text]
 * en el estado de filtros de la columna.
 */
export function DataTableTextFilter<TData, TValue>({
  column,
  title,
  placeholder,
}: DataTableTextFilterProps<TData, TValue>) {
  const filterValue = column?.getFilterValue() as string[] | undefined;
  const currentValue = filterValue?.[0] ?? '';

  const [inputValue, setInputValue] = React.useState(currentValue);

  // Sync input when filter is cleared externally
  React.useEffect(() => {
    setInputValue(currentValue);
  }, [currentValue]);

  const handleApply = () => {
    if (inputValue.trim()) {
      column?.setFilterValue([inputValue.trim()]);
    } else {
      column?.setFilterValue(undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleApply();
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInputValue('');
    column?.setFilterValue(undefined);
  };

  const hasValue = Boolean(currentValue);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-dashed"
          data-testid={`filter-text-${column?.id}`}
        >
          <Search className="mr-2 h-4 w-4" />
          {title}
          {hasValue && (
            <>
              <Separator orientation="vertical" className="mx-2 h-4" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                {currentValue}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-3" align="start">
        <div className="space-y-2">
          <Input
            placeholder={placeholder ?? `Filtrar por ${title.toLowerCase()}...`}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8"
            autoFocus
          />
          <div className="flex justify-between">
            {hasValue && (
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleClear}>
                <X className="mr-1 h-3 w-3" />
                Limpiar
              </Button>
            )}
            <Button size="sm" className="ml-auto h-7" onClick={handleApply}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
