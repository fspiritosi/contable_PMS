'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { BarChart3, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import type { ModulePermissions } from '@/shared/lib/permissions';
import type { CostCenterListItem } from './actions.server';

interface ColumnsProps {
  onEdit: (costCenter: CostCenterListItem) => void;
  onDelete: (costCenter: CostCenterListItem) => void;
  /** Abre el informe de movimientos del centro (TSK-719). */
  onViewMovements: (costCenter: CostCenterListItem) => void;
  permissions: ModulePermissions;
  /** Permiso de Informes contables: sin él no se ofrece "Ver movimientos". */
  canViewReports: boolean;
}

export function getColumns({
  onEdit,
  onDelete,
  onViewMovements,
  permissions,
  canViewReports,
}: ColumnsProps): ColumnDef<CostCenterListItem>[] {
  const { canUpdate, canDelete } = permissions;
  // Un usuario que solo tiene Informes contables igual necesita la columna.
  const hasAnyAction = canUpdate || canDelete || canViewReports;

  const baseColumns: ColumnDef<CostCenterListItem>[] = [
    // Nombre
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
      cell: ({ row }) => (
        <span className="font-medium" data-testid={`cost-center-name-${row.original.id}`}>
          {row.getValue('name')}
        </span>
      ),
    },
  ];

  // Solo agregar columna de acciones si el usuario tiene al menos un permiso
  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const costCenter = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0"
                data-testid={`cost-center-actions-${costCenter.id}`}
              >
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canViewReports && (
                <DropdownMenuItem
                  onClick={() => onViewMovements(costCenter)}
                  data-testid={`cost-center-movements-${costCenter.id}`}
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Ver movimientos
                </DropdownMenuItem>
              )}
              {canUpdate && (
                <DropdownMenuItem
                  onClick={() => onEdit(costCenter)}
                  data-testid={`cost-center-edit-${costCenter.id}`}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(costCenter)}
                  className="text-destructive"
                  data-testid={`cost-center-delete-${costCenter.id}`}
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
