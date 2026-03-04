'use client';

import * as React from 'react';
import { Filter } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import type { DataTableFacetedFilterConfig } from './types';

interface DataTableFilterOptionsProps {
  /** Configuración de filtros disponibles */
  filters: DataTableFacetedFilterConfig[];
  /** Estado actual de visibilidad */
  visibility: Record<string, boolean>;
  /** Callback cuando cambia la visibilidad */
  onVisibilityChange: (visibility: Record<string, boolean>) => void;
}

/**
 * Toggle de visibilidad de filtros del DataTable.
 * Permite al usuario elegir qué filtros mostrar/ocultar en la barra de herramientas.
 */
export function DataTableFilterOptions({
  filters,
  visibility,
  onVisibilityChange,
}: DataTableFilterOptionsProps) {
  if (filters.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Filter className="mr-2 h-4 w-4" />
          Filtros
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <DropdownMenuLabel>Filtros visibles</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {filters.map((filter) => {
          const isVisible = visibility[filter.columnId] !== false;
          return (
            <DropdownMenuCheckboxItem
              key={filter.columnId}
              checked={isVisible}
              onCheckedChange={(checked) => {
                onVisibilityChange({
                  ...visibility,
                  [filter.columnId]: checked,
                });
              }}
            >
              {filter.title}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
