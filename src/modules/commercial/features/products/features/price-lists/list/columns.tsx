'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, ListTodo, Eye, Edit, Trash2, Star } from 'lucide-react';
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
import type { PriceList } from '../../../shared/types';

interface ColumnsProps {
  onEdit: (priceList: PriceList) => void;
  onDelete: (priceList: PriceList) => void;
  onSetDefault: (priceList: PriceList) => void;
  permissions: ModulePermissions;
}

export function getColumns({ onEdit, onDelete, onSetDefault, permissions }: ColumnsProps): ColumnDef<PriceList>[] {
  const { canUpdate, canDelete } = permissions;
  const hasAnyAction = canUpdate || canDelete;

  const baseColumns: ColumnDef<PriceList>[] = [
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
      meta: { title: 'Nombre' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
      cell: ({ row }) => {
        const priceList = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <ListTodo className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                {priceList.isDefault && (
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                )}
                <Link
                  href={`/dashboard/commercial/price-lists/${priceList.id}`}
                  className="font-medium hover:underline"
                >
                  {priceList.name}
                </Link>
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'description',
      meta: { title: 'Descripción' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Descripción" />,
      cell: ({ row }) => {
        const description = row.original.description;
        return (
          <span className="text-sm text-muted-foreground">
            {description || 'Sin descripción'}
          </span>
        );
      },
    },
    {
      accessorKey: '_count.items',
      meta: { title: 'Artículos' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Artículos" />,
      cell: ({ row }) => {
        const count = row.original._count?.items || 0;
        return (
          <Badge variant="outline">
            {count} {count === 1 ? 'artículo' : 'artículos'}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'isDefault',
      meta: { title: 'Predeterminada' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Predeterminada" />,
      cell: ({ row }) => {
        const isDefault = row.original.isDefault;
        return (
          <Badge variant={isDefault ? 'default' : 'outline'}>
            {isDefault ? 'Sí' : 'No'}
          </Badge>
        );
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
            {isActive ? 'Activa' : 'Inactiva'}
          </Badge>
        );
      },
    },
  ];

  // Solo agregar columna de acciones si el usuario tiene al menos un permiso
  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const priceList = row.original;
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
                <Link href={`/dashboard/commercial/price-lists/${priceList.id}`}>
                  <Eye className="mr-2 h-4 w-4" />
                  Ver precios
                </Link>
              </DropdownMenuItem>
              {canUpdate && (
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/commercial/price-lists/${priceList.id}/edit`}>
                    <Edit className="mr-2 h-4 w-4" />
                    Editar
                  </Link>
                </DropdownMenuItem>
              )}
              {canUpdate && !priceList.isDefault && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onSetDefault(priceList)}>
                    <Star className="mr-2 h-4 w-4" />
                    Marcar como predeterminada
                  </DropdownMenuItem>
                </>
              )}
              {canUpdate && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(priceList)}
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
