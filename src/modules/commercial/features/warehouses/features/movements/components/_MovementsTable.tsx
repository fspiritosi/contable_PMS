'use client';

import { useMemo } from 'react';
import { TrendingDown } from 'lucide-react';

import { DataTable, type DataTableSearchParams, type DataTableFacetedFilterConfig } from '@/shared/components/common/DataTable';
import type { StockMovement } from '../../../shared/types';
import { STOCK_MOVEMENT_TYPE_LABELS } from '../../../shared/types';
import { getColumns } from '../columns';

interface FacetCounts {
  type: Record<string, number>;
}

interface Props {
  data: StockMovement[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  facetCounts?: FacetCounts;
}

export function _MovementsTable({ data, totalRows, searchParams, facetCounts }: Props) {
  const columns = useMemo(() => getColumns(), []);

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'product_name',
        title: 'Ítem',
        type: 'text' as const,
        placeholder: 'Buscar por ítem...',
      },
      {
        columnId: 'warehouse_name',
        title: 'Almacén',
        type: 'text' as const,
        placeholder: 'Buscar por almacén...',
      },
      {
        columnId: 'type',
        title: 'Tipo',
        options: Object.entries(STOCK_MOVEMENT_TYPE_LABELS).map(([value, label]) => ({
          value,
          label,
        })),
        externalCounts: facetCounts?.type ? new Map(Object.entries(facetCounts.type)) : undefined,
      },
      {
        columnId: 'date',
        title: 'Fecha',
        type: 'dateRange' as const,
      },
    ],
    [facetCounts]
  );

  if (totalRows === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center border rounded-md">
        <TrendingDown className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-lg font-medium">No hay movimientos</p>
        <p className="text-sm text-muted-foreground">
          No se encontraron movimientos con los filtros aplicados
        </p>
      </div>
    );
  }

  return (
    <DataTable<StockMovement>
      columns={columns}
      data={data}
      totalRows={totalRows}
      searchParams={searchParams}
      showSearch={false}
      facetedFilters={facetedFilters}
      tableId="commercial-stock-movements"
      showFilterToggle
    />
  );
}
