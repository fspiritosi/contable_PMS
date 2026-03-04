'use client';

import { X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import { DataTableDateRangeFilter } from './DataTableDateRangeFilter';
import { DataTableFacetedFilter } from './DataTableFacetedFilter';
import { DataTableFilterOptions } from './DataTableFilterOptions';
import { DataTableTextFilter } from './DataTableTextFilter';
import { DataTableViewOptions } from './DataTableViewOptions';
import type { DataTableToolbarProps } from './types';

/**
 * Barra de herramientas con búsqueda, filtros y acciones
 */
export function DataTableToolbar<TData>({
  table,
  searchPlaceholder = 'Buscar...',
  searchColumn,
  facetedFilters = [],
  showColumnToggle = true,
  showSearch = true,
  toolbarActions,
  showFilterToggle = false,
  filterVisibility,
  onFilterVisibilityChange,
  exportActions,
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0;

  // Si hay searchColumn específico, usar ese; si no, usar filtro global
  const searchValue = searchColumn
    ? (table.getColumn(searchColumn)?.getFilterValue() as string) ?? ''
    : (table.getState().globalFilter as string) ?? '';

  const handleSearchChange = (value: string) => {
    if (searchColumn) {
      table.getColumn(searchColumn)?.setFilterValue(value);
    } else {
      table.setGlobalFilter(value);
    }
  };

  // Filtrar filtros según visibilidad
  const visibleFilters = filterVisibility
    ? facetedFilters.filter((f) => filterVisibility[f.columnId] !== false)
    : facetedFilters;

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {/* Input de búsqueda */}
        {showSearch && (
          <Input
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => handleSearchChange(event.target.value)}
            className="h-8 w-[150px] lg:w-[250px]"
            data-testid="search-input"
          />
        )}

        {/* Filtros según tipo */}
        {visibleFilters.map((filter) => {
          const column = table.getColumn(filter.columnId);
          if (!column) return null;

          const filterType = filter.type ?? 'faceted';

          switch (filterType) {
            case 'dateRange':
              return (
                <DataTableDateRangeFilter
                  key={filter.columnId}
                  column={column}
                  title={filter.title}
                />
              );
            case 'text':
              return (
                <DataTableTextFilter
                  key={filter.columnId}
                  column={column}
                  title={filter.title}
                  placeholder={filter.placeholder}
                />
              );
            case 'faceted':
            default:
              return (
                <DataTableFacetedFilter
                  key={filter.columnId}
                  column={column}
                  title={filter.title}
                  options={filter.options ?? []}
                  externalCounts={filter.externalCounts}
                />
              );
          }
        })}

        {/* Botón para limpiar filtros */}
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => table.resetColumnFilters()}
            className="h-8 px-2 lg:px-3"
            data-testid="clear-filters"
          >
            Limpiar
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex items-center space-x-2">
        {/* Toggle de filtros */}
        {showFilterToggle && filterVisibility && onFilterVisibilityChange && (
          <DataTableFilterOptions
            filters={facetedFilters}
            visibility={filterVisibility}
            onVisibilityChange={onFilterVisibilityChange}
          />
        )}

        {/* Acciones de exportación */}
        {exportActions}

        {/* Acciones personalizadas */}
        {toolbarActions}

        {/* Toggle de columnas */}
        {showColumnToggle && <DataTableViewOptions table={table} />}
      </div>
    </div>
  );
}
