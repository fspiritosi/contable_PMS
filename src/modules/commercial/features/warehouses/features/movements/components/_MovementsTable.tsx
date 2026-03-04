'use client';

import { useMemo } from 'react';
import { TrendingDown } from 'lucide-react';

import { DataTable, type DataTableSearchParams } from '@/shared/components/common/DataTable';
import type { StockMovement } from '../../../shared/types';
import { getColumns } from '../columns';

interface Props {
  data: StockMovement[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

export function _MovementsTable({ data, totalRows, searchParams }: Props) {
  const columns = useMemo(() => getColumns(), []);

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
      searchPlaceholder="Buscar movimientos..."
      tableId="commercial-stock-movements"
    />
  );
}
