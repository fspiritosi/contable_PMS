'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ListPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import type { ModulePermissions } from '@/shared/lib/permissions';
import type { PriceIndexListItem } from './actions.server';

interface ColumnsProps {
  onEdit: (priceIndex: PriceIndexListItem) => void;
  onDelete: (priceIndex: PriceIndexListItem) => void;
  /**
   * Abre el detalle del índice, que es donde se cargan los valores por período
   * (TSK-621: la pantalla de listado no dejaba ver que había que entrar al índice).
   */
  onViewValues: (priceIndex: PriceIndexListItem) => void;
  permissions: ModulePermissions;
}

export function getColumns({
  onEdit,
  onDelete,
  onViewValues,
  permissions,
}: ColumnsProps): ColumnDef<PriceIndexListItem>[] {
  const { canUpdate, canDelete } = permissions;

  const baseColumns: ColumnDef<PriceIndexListItem>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
      meta: { title: 'Nombre' },
      cell: ({ row }) => (
        <Link
          href={`/dashboard/company/price-indexes/${row.original.id}`}
          className="font-medium text-primary hover:underline"
          data-testid={`price-index-name-${row.original.id}`}
        >
          {row.getValue('name')}
        </Link>
      ),
    },
    {
      accessorKey: 'description',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Descripción" />,
      meta: { title: 'Descripción' },
      cell: ({ row }) => (
        <span
          className="text-muted-foreground"
          data-testid={`price-index-description-${row.original.id}`}
        >
          {row.getValue('description') || '-'}
        </span>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'isActive',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      meta: { title: 'Estado' },
      cell: ({ row }) => {
        const isActive = row.getValue<boolean>('isActive');
        return (
          <Badge variant={isActive ? 'default' : 'secondary'}>
            {isActive ? 'Activo' : 'Inactivo'}
          </Badge>
        );
      },
    },
    {
      id: 'valuesCount',
      accessorFn: (row) => row._count.values,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Valores Cargados" />,
      meta: { title: 'Valores Cargados' },
      cell: ({ row }) => {
        const count = row.original._count.values;

        // Un índice sin valores no se puede aplicar a una lista de precios:
        // se avisa en color de advertencia para que se distinga de un vistazo.
        return (
          <Badge
            variant={count === 0 ? 'warning' : 'secondary'}
            data-testid={`price-index-values-count-${row.original.id}`}
          >
            {count === 0 ? 'Sin valores' : `${count} ${count === 1 ? 'valor' : 'valores'}`}
          </Badge>
        );
      },
      enableSorting: false,
    },
  ];

  // La columna de acciones se muestra siempre: "Ver / cargar valores" solo navega
  // al detalle, así que alcanza con el permiso de ver el listado.
  baseColumns.push({
    id: 'actions',
    cell: ({ row }) => {
      const priceIndex = row.original;

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              data-testid={`price-index-actions-${priceIndex.id}`}
            >
              <span className="sr-only">Abrir menú</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => onViewValues(priceIndex)}
              data-testid={`price-index-values-${priceIndex.id}`}
            >
              <ListPlus className="mr-2 h-4 w-4" />
              Ver / cargar valores
            </DropdownMenuItem>
            {canUpdate && (
              <DropdownMenuItem
                onClick={() => onEdit(priceIndex)}
                data-testid={`price-index-edit-${priceIndex.id}`}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                onClick={() => onDelete(priceIndex)}
                className="text-destructive"
                data-testid={`price-index-delete-${priceIndex.id}`}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  });

  return baseColumns;
}
