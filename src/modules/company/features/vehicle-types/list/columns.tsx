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
import type { VehicleTypeListItem } from './actions.server';

interface ColumnsProps {
  onEdit: (vehicleType: VehicleTypeListItem) => void;
  onDelete: (vehicleType: VehicleTypeListItem) => void;
  permissions: ModulePermissions;
}

export function getColumns({
  onEdit,
  onDelete,
  permissions,
}: ColumnsProps): ColumnDef<VehicleTypeListItem>[] {
  const { canUpdate, canDelete } = permissions;
  const hasAnyAction = canUpdate || canDelete;

  const baseColumns: ColumnDef<VehicleTypeListItem>[] = [
    // Nombre
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
      cell: ({ row }) => (
        <span className="font-medium" data-testid={`vehicle-type-name-${row.original.id}`}>
          {row.getValue('name')}
        </span>
      ),
    },

    // Tiene enganche
    {
      accessorKey: 'hasHitch',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Enganche" />,
      cell: ({ row }) => (
        <Badge
          variant={row.original.hasHitch ? 'default' : 'secondary'}
          data-testid={`vehicle-type-has-hitch-${row.original.id}`}
        >
          {row.original.hasHitch ? 'Si' : 'No'}
        </Badge>
      ),
      enableSorting: false,
    },

    // Es unidad tractora
    {
      accessorKey: 'isTractorUnit',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Unidad Tractora" />,
      cell: ({ row }) => (
        <Badge
          variant={row.original.isTractorUnit ? 'default' : 'secondary'}
          data-testid={`vehicle-type-is-tractor-${row.original.id}`}
        >
          {row.original.isTractorUnit ? 'Si' : 'No'}
        </Badge>
      ),
      enableSorting: false,
    },

    // Cantidad de equipos
    {
      id: 'vehicles',
      accessorFn: (row) => row._count.vehicles,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Equipos" />,
      cell: ({ row }) => (
        <Badge variant="secondary" data-testid={`vehicle-type-vehicles-${row.original.id}`}>
          {row.original._count.vehicles} equipo
          {row.original._count.vehicles !== 1 ? 's' : ''}
        </Badge>
      ),
      enableSorting: false,
    },

    // Cuentas contables de Bienes de Uso propias del tipo (TSK-724c)
    {
      id: 'accounts',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Cuentas contables" />,
      meta: { title: 'Cuentas contables' },
      cell: ({ row }) => {
        const {
          id,
          fixedAssetAccountId,
          accumulatedDepreciationAccountId,
          depreciationExpenseAccountId,
        } = row.original;
        const own = [
          fixedAssetAccountId,
          accumulatedDepreciationAccountId,
          depreciationExpenseAccountId,
        ].filter(Boolean).length;
        return (
          <Badge
            variant={own === 3 ? 'default' : 'secondary'}
            data-testid={`vehicle-type-accounts-${id}`}
          >
            {own === 0 ? 'Por defecto' : own === 3 ? 'Propias' : `${own}/3 propias`}
          </Badge>
        );
      },
      enableSorting: false,
    },
  ];

  // Solo agregar columna de acciones si el usuario tiene al menos un permiso
  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const vehicleType = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0"
                data-testid={`vehicle-type-actions-${vehicleType.id}`}
              >
                <span className="sr-only">Abrir menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canUpdate && (
                <DropdownMenuItem
                  onClick={() => onEdit(vehicleType)}
                  data-testid={`vehicle-type-edit-${vehicleType.id}`}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(vehicleType)}
                  className="text-destructive"
                  data-testid={`vehicle-type-delete-${vehicleType.id}`}
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
