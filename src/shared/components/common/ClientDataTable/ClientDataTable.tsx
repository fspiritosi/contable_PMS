import * as React from 'react';
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';

/**
 * DataTable para datos pre-cargados (sin paginación/sort/filter server-side).
 *
 * Casos de uso:
 * - Tabs de detalle (cuenta corriente, etc.) donde los datos ya están en memoria.
 * - Listas pequeñas/medianas que no justifican server-side.
 *
 * Features:
 * - Búsqueda global client-side sobre todos los accessorKey.
 * - Sort client-side por columna (click en header).
 * - Paginación client-side opcional (default: sin paginación).
 * - Visibilidad de columnas persistente en localStorage si se pasa `tableId`.
 * - Selección de filas opcional (con callback para que el padre reaccione).
 */
export interface ClientDataTableProps<TData extends Record<string, unknown>> {
  columns: ColumnDef<TData>[];
  data: TData[];
  searchPlaceholder?: string;
  /** ID para persistir visibilidad de columnas en localStorage */
  tableId?: string;
  /** Tamaño de página para paginación client-side (default: sin paginación) */
  pageSize?: number;
  /** Mensaje cuando no hay resultados */
  emptyMessage?: string;
  /** Mostrar input de búsqueda (default: true) */
  showSearch?: boolean;
  /** Visibilidad inicial de columnas */
  initialColumnVisibility?: VisibilityState;
  /**
   * Habilitar selección de filas. Default: false.
   * Si se pasa una función, se evalúa por fila para permitir deshabilitar selección selectiva.
   */
  enableRowSelection?: boolean | ((row: TData) => boolean);
  /** Callback cuando cambia la selección (recibe las filas seleccionadas) */
  onSelectionChange?: (selectedRows: TData[]) => void;
}

function getColumnTitle<TData extends Record<string, unknown>>(
  column: ColumnDef<TData>
): string {
  if (typeof column.header === 'string') return column.header;
  const metaTitle = (column.meta as { title?: string } | undefined)?.title;
  return metaTitle ?? '';
}

interface SortableHeaderProps {
  columnKey: string;
  title: string;
  sortDirection: false | 'asc' | 'desc';
  onSort: () => void;
}

function SortableHeader({
  title,
  sortDirection,
  onSort,
}: SortableHeaderProps) {
  const Icon = sortDirection === 'asc' ? ArrowUp : sortDirection === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onSort}
      className="-ml-3 h-8 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-transparent"
    >
      {title}
      <Icon className="ml-2 h-3.5 w-3.5" />
    </Button>
  );
}

export function ClientDataTable<TData extends Record<string, unknown>>({
  columns,
  data,
  searchPlaceholder = 'Buscar...',
  tableId,
  pageSize,
  emptyMessage = 'No se encontraron resultados.',
  showSearch = true,
  initialColumnVisibility,
  enableRowSelection = false,
  onSelectionChange,
}: ClientDataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    () => initialColumnVisibility ?? {}
  );

  // Persistencia de visibilidad de columnas
  React.useEffect(() => {
    if (!tableId) return;
    try {
      const stored = window.localStorage.getItem(`client-table-vis:${tableId}`);
      if (stored) setColumnVisibility(JSON.parse(stored));
    } catch {
      // localStorage no disponible, ignorar
    }
  }, [tableId]);

  const handleColumnVisibilityChange = React.useCallback(
    (updater: React.SetStateAction<VisibilityState>) => {
      setColumnVisibility((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (tableId) {
          try {
            window.localStorage.setItem(`client-table-vis:${tableId}`, JSON.stringify(next));
          } catch {
            // ignore
          }
        }
        return next;
      });
    },
    [tableId]
  );

  // Notificar al padre cuando cambia la selección
  React.useEffect(() => {
    if (!onSelectionChange) return;
    const selectedIndices = Object.keys(rowSelection).filter(
      (k) => (rowSelection as Record<string, boolean>)[k]
    );
    const selectedRows = selectedIndices.map((idx) => data[Number(idx)]);
    onSelectionChange(selectedRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      rowSelection,
      columnVisibility,
    },
    initialState: pageSize ? { pagination: { pageSize } } : undefined,
    enableRowSelection: enableRowSelection === true ? true : enableRowSelection
      ? (row: { original: TData }) => (enableRowSelection as (row: TData) => boolean)(row.original)
      : false,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: pageSize ? getPaginationRowModel() : undefined,
    globalFilterFn: (row, _columnId, filterValue: string) => {
      const search = String(filterValue).toLowerCase().trim();
      if (!search) return true;
      const original = row.original as Record<string, unknown>;
      // Busca en todos los campos string + number (formateados) del row
      return Object.values(original).some((value) => {
        if (value == null) return false;
        const str = String(value).toLowerCase();
        return str.includes(search);
      });
    },
  });

  const visibleColumns = table.getVisibleLeafColumns();
  const rows = table.getRowModel().rows;
  const totalRows = data.length;

  return (
    <div className="space-y-4" data-testid="client-data-table">
      {showSearch && (
        <div className="flex items-center justify-between gap-2">
          <Input
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="h-8 w-full max-w-sm"
            data-testid="client-search-input"
          />
          {totalRows > 0 && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {rows.length} de {totalRows}
            </span>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isSelectColumn = header.column.id === 'select';
                  const canSort = header.column.getCanSort();
                  const sortDirection = header.column.getIsSorted();
                  const columnDef = header.column.columnDef;
                  const title = getColumnTitle(columnDef);

                  return (
                    <TableHead key={header.id}>
                      {isSelectColumn || !canSort ? (
                        flexRender(columnDef.header, header.getContext())
                      ) : (
                        <SortableHeader
                          columnKey={header.column.id}
                          title={title}
                          sortDirection={sortDirection}
                          onSort={() => header.column.toggleSorting()}
                        />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows?.length ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  data-testid={`table-row-${row.id}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cn(cell.column.id === 'select' && 'w-10')}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className="h-40">
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

      {pageSize && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span>
            Página {table.getState().pagination.pageIndex + 1} de {Math.max(1, table.getPageCount())}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}