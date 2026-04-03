'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

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
import type { DiscountPresetListItem } from './actions.server';

interface ColumnsProps {
  onEdit: (preset: DiscountPresetListItem) => void;
  onDelete: (preset: DiscountPresetListItem) => void;
  permissions: ModulePermissions;
}

export function getColumns({
  onEdit,
  onDelete,
  permissions,
}: ColumnsProps): ColumnDef<DiscountPresetListItem>[] {
  const { canUpdate, canDelete } = permissions;
  const hasAnyAction = canUpdate || canDelete;

  const baseColumns: ColumnDef<DiscountPresetListItem>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
      meta: { title: 'Nombre' },
      cell: ({ row }) => (
        <span className="font-medium" data-testid={`discount-preset-name-${row.original.id}`}>
          {row.getValue('name')}
        </span>
      ),
    },
    {
      accessorKey: 'percentage',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Porcentaje" />,
      meta: { title: 'Porcentaje' },
      cell: ({ row }) => (
        <span className="font-mono" data-testid={`discount-preset-percentage-${row.original.id}`}>
          {row.getValue<number>('percentage')}%
        </span>
      ),
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
  ];

  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const preset = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0"
                data-testid={`discount-preset-actions-${preset.id}`}
              >
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canUpdate && (
                <DropdownMenuItem
                  onClick={() => onEdit(preset)}
                  data-testid={`discount-preset-edit-${preset.id}`}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(preset)}
                  className="text-destructive"
                  data-testid={`discount-preset-delete-${preset.id}`}
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
