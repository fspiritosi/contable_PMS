'use client';

import * as React from 'react';
import { Inbox } from 'lucide-react';
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  useReactTable,
} from '@tanstack/react-table';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import { _DataTableExportButton } from './_DataTableExportButton';
import { DataTablePagination } from './DataTablePagination';
import { DataTableToolbar } from './DataTableToolbar';
import { useDataTable } from './useDataTable';
import type { DataTableProps } from './types';

/**
 * DataTable Server-Side con soporte para paginación, sorting y filtros
 *
 * Este componente está diseñado para trabajar con datos paginados desde el servidor.
 * El estado se sincroniza automáticamente con la URL para permitir compartir links
 * y navegación con el botón atrás/adelante del navegador.
 */
export function DataTable<TData extends Record<string, unknown>, TValue = unknown>({
  columns,
  data,
  totalRows,
  searchParams = {},
  facetedFilters = [],
  searchPlaceholder = 'Buscar...',
  showSearch = true,
  searchColumn,
  showColumnToggle = true,
  showRowSelection = false,
  enableRowSelection = false,
  onRowSelectionChange,
  emptyMessage = 'No se encontraron resultados.',
  pageSizeOptions,
  toolbarActions,
  exportConfig,
  showExportButton = true,
  initialColumnVisibility,
  tableId,
  showFilterToggle = false,
  initialFilterVisibility,
  exportActions,
  'data-testid': dataTestId = 'data-table',
}: DataTableProps<TData, TValue>) {
  // Estado de selección de filas (local)
  const [rowSelection, setRowSelection] = React.useState({});

  // Estado de visibilidad de columnas (inicializado desde props o vacío)
  const [columnVisibility, setColumnVisibility] = React.useState<Record<string, boolean>>(
    () => initialColumnVisibility ?? {}
  );

  // Estado de visibilidad de filtros
  const [filterVisibility, setFilterVisibility] = React.useState<Record<string, boolean>>(
    () => {
      if (initialFilterVisibility) return initialFilterVisibility;
      // Por defecto, todos los filtros visibles
      const defaults: Record<string, boolean> = {};
      facetedFilters.forEach((f) => {
        defaults[f.columnId] = true;
      });
      return defaults;
    }
  );

  // Persistencia de preferencias con debounce
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleColumnVisibilityChange = React.useCallback(
    (updater: React.SetStateAction<Record<string, boolean>>) => {
      setColumnVisibility((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;

        if (tableId) {
          // Debounce save
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = setTimeout(() => {
            import('@/shared/actions/table-preferences').then(({ saveTableColumnVisibility }) => {
              saveTableColumnVisibility(tableId, next);
            });
          }, 1000);
        }

        return next;
      });
    },
    [tableId]
  );

  const handleFilterVisibilityChange = React.useCallback(
    (newVisibility: Record<string, boolean>) => {
      setFilterVisibility(newVisibility);

      if (tableId) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          import('@/shared/actions/table-preferences').then(({ saveTableFilterVisibility }) => {
            saveTableFilterVisibility(tableId, newVisibility);
          });
        }, 1000);
      }
    },
    [tableId]
  );

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Hook para manejar estado sincronizado con URL (y persistencia si tableId)
  const filterableColumns = facetedFilters.map((f) => f.columnId);
  const {
    pagination,
    sorting,
    columnFilters,
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
  } = useDataTable({
    filterableColumns,
    tableId,
  });

  // Calcular pageCount basado en totalRows
  const pageCount = Math.ceil(totalRows / pagination.pageSize);

  // Configurar tabla con TanStack Table
  const table = useReactTable({
    data,
    columns,
    pageCount,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    // Row selection
    enableRowSelection,
    onRowSelectionChange: (updater) => {
      const newSelection =
        typeof updater === 'function' ? updater(rowSelection) : updater;
      setRowSelection(newSelection);

      // Callback externo con las filas seleccionadas
      if (onRowSelectionChange) {
        const selectedRows = Object.keys(newSelection)
          .filter((key) => newSelection[key as keyof typeof newSelection])
          .map((index) => data[Number(index)]);
        onRowSelectionChange(selectedRows);
      }
    },
    // Column visibility (local with persistence)
    onColumnVisibilityChange: handleColumnVisibilityChange,
    // Server-side pagination
    manualPagination: true,
    onPaginationChange,
    // Server-side sorting
    manualSorting: true,
    onSortingChange,
    // Server-side filtering
    manualFiltering: true,
    onColumnFiltersChange,
    // Row models
    getCoreRowModel: getCoreRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  return (
    <div className="space-y-4" data-testid={dataTestId}>
      {/* Toolbar */}
      <DataTableToolbar
        table={table}
        searchPlaceholder={searchPlaceholder}
        showSearch={showSearch}
        searchColumn={searchColumn}
        facetedFilters={facetedFilters}
        showColumnToggle={showColumnToggle}
        toolbarActions={
          <>
            {/* Botón de exportar a Excel */}
            {exportConfig && showExportButton && (
              <_DataTableExportButton columns={columns} exportConfig={exportConfig} />
            )}
            {/* Acciones personalizadas */}
            {toolbarActions}
          </>
        }
        showFilterToggle={showFilterToggle}
        filterVisibility={filterVisibility}
        onFilterVisibilityChange={handleFilterVisibilityChange}
        exportActions={exportActions}
        tableId={tableId}
      />

      {/* Table */}
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  data-testid={`table-row-${row.id}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-40">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <Inbox className="h-6 w-6 opacity-60" />
                    </div>
                    <p className="text-sm font-medium">{emptyMessage}</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <DataTablePagination
        table={table}
        totalRows={totalRows}
        pageSizeOptions={pageSizeOptions}
        showRowSelection={showRowSelection && enableRowSelection}
      />
    </div>
  );
}
