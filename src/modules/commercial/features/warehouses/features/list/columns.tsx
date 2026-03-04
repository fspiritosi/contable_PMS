'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Warehouse, Eye, Edit, Trash2, MapPin, Package } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import type { ModulePermissions } from '@/shared/lib/permissions';
import type { WarehouseListItem } from './actions.server';
import { WAREHOUSE_TYPE_LABELS } from '../../shared/types';

interface ColumnsProps {
  onEdit: (warehouse: WarehouseListItem) => void;
  onDelete: (warehouse: WarehouseListItem) => void;
  onToggleActive: (warehouse: WarehouseListItem) => void;
  permissions: ModulePermissions;
}

export function getColumns({ onEdit, onDelete, onToggleActive, permissions }: ColumnsProps): ColumnDef<WarehouseListItem>[] {
  const { canUpdate, canDelete } = permissions;
  const hasAnyAction = canUpdate || canDelete;

  const baseColumns: ColumnDef<WarehouseListItem>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Seleccionar todos"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Seleccionar fila"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'name',
      meta: { title: 'Almacén' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Almacén" />,
      cell: ({ row }) => {
        const warehouse = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Warehouse className="h-4 w-4 text-primary" />
            </div>
            <div>
              <Link
                href={`/dashboard/commercial/warehouses/${warehouse.id}`}
                className="font-medium hover:underline"
              >
                {warehouse.name}
              </Link>
              <p className="text-xs text-muted-foreground">Código: {warehouse.code}</p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'type',
      meta: { title: 'Tipo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      cell: ({ row }) => {
        const type = row.original.type;
        return (
          <Badge variant="outline">
            {WAREHOUSE_TYPE_LABELS[type]}
          </Badge>
        );
      },
    },
    {
      id: 'location',
      meta: { title: 'Ubicación' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Ubicación" />,
      cell: ({ row }) => {
        const { city, state } = row.original;
        if (!city && !state) {
          return <span className="text-muted-foreground">-</span>;
        }
        const parts = [city, state].filter(Boolean);
        return (
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm">{parts.join(', ')}</span>
          </div>
        );
      },
    },
    {
      id: 'stockCount',
      meta: { title: 'Productos' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Productos" />,
      cell: ({ row }) => {
        const count = row.original._count?.stocks || 0;
        return (
          <div className="flex items-center gap-1">
            <Package className="h-3 w-3 text-muted-foreground" />
            <Badge variant="secondary">{count}</Badge>
          </div>
        );
      },
    },
    {
      id: 'movementsCount',
      meta: { title: 'Movimientos' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Movimientos" />,
      cell: ({ row }) => {
        const count = row.original._count?.movements || 0;
        return <Badge variant="secondary">{count}</Badge>;
      },
    },
    {
      accessorKey: 'isActive',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const isActive = row.original.isActive;
        return (
          <Badge variant={isActive ? 'default' : 'secondary'}>
            {isActive ? 'Activo' : 'Inactivo'}
          </Badge>
        );
      },
      filterFn: (row, id, value) => {
        const isActive = row.getValue(id);
        return value.includes(String(isActive));
      },
    },
  ];

  // Solo agregar columna de acciones si el usuario tiene al menos un permiso
  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const warehouse = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/commercial/warehouses/${warehouse.id}`}>
                  <Eye className="mr-2 h-4 w-4" />
                  Ver detalle
                </Link>
              </DropdownMenuItem>
              {canUpdate && (
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/commercial/warehouses/${warehouse.id}/edit`}>
                    <Edit className="mr-2 h-4 w-4" />
                    Editar
                  </Link>
                </DropdownMenuItem>
              )}
              {canUpdate && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onToggleActive(warehouse)}>
                    {warehouse.isActive ? 'Desactivar' : 'Activar'}
                  </DropdownMenuItem>
                </>
              )}
              {canUpdate && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(warehouse)}
                  className="text-destructive"
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
  }

  return baseColumns;
}
