'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Building2, Edit, Filter, MoreHorizontal, Trash2, Truck, User } from 'lucide-react';

import type { DocumentAppliesTo } from '@/generated/prisma/enums';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import { documentAppliesToLabels } from '@/shared/utils/mappers';
import type { DocumentTypeListItem } from './actions.server';

const appliesToIcons: Record<DocumentAppliesTo, typeof User> = {
  EMPLOYEE: User,
  EQUIPMENT: Truck,
  COMPANY: Building2,
};

interface ColumnsOptions {
  onDelete: (docType: DocumentTypeListItem) => void;
  onEdit: (docType: DocumentTypeListItem) => void;
  canUpdate: boolean;
  canDelete: boolean;
}

export function getColumns({
  onDelete,
  onEdit,
  canUpdate,
  canDelete,
}: ColumnsOptions): ColumnDef<DocumentTypeListItem>[] {
  return [
    // Columna de selección
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
          data-testid="select-all-checkbox"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Seleccionar fila"
          data-testid={`select-row-${row.original.id}`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },

    // Nombre
    {
      accessorKey: 'name',
      meta: { title: 'Nombre' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
      cell: ({ row }) => (
        <div
          className="flex items-center gap-2"
          data-testid={`doctype-name-${row.original.id}`}
        >
          <span className="font-medium">{row.original.name}</span>
          {row.original.isConditional && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Filter className="h-3 w-3" />
              Condicional
            </Badge>
          )}
        </div>
      ),
    },

    // Aplica a
    {
      accessorKey: 'appliesTo',
      meta: { title: 'Aplica a' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Aplica a" />,
      cell: ({ row }) => {
        const appliesTo = row.original.appliesTo;
        const Icon = appliesToIcons[appliesTo];
        return (
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span>{documentAppliesToLabels[appliesTo]}</span>
          </div>
        );
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id));
      },
    },

    // Obligatorio
    {
      accessorKey: 'isMandatory',
      meta: { title: 'Obligatorio' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Obligatorio" />,
      cell: ({ row }) =>
        row.original.isMandatory ? (
          <Badge variant="default">Sí</Badge>
        ) : (
          <Badge variant="secondary">No</Badge>
        ),
      filterFn: (row, id, value) => {
        const isMandatory = row.original.isMandatory ? 'true' : 'false';
        return value.includes(isMandatory);
      },
    },

    // Vence
    {
      accessorKey: 'hasExpiration',
      meta: { title: 'Vence' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Vence" />,
      cell: ({ row }) =>
        row.original.hasExpiration ? (
          <Badge variant="outline">Sí</Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
      filterFn: (row, id, value) => {
        const hasExpiration = row.original.hasExpiration ? 'true' : 'false';
        return value.includes(hasExpiration);
      },
    },

    // Mensual
    {
      accessorKey: 'isMonthly',
      meta: { title: 'Mensual' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Mensual" />,
      cell: ({ row }) =>
        row.original.isMonthly ? (
          <Badge variant="outline">Sí</Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
      filterFn: (row, id, value) => {
        const isMonthly = row.original.isMonthly ? 'true' : 'false';
        return value.includes(isMonthly);
      },
    },

    // Multirrecurso
    {
      accessorKey: 'isMultiResource',
      meta: { title: 'Multirrecurso' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Multirrecurso" />,
      cell: ({ row }) => {
        // Solo mostrar para EMPLOYEE o EQUIPMENT
        if (row.original.appliesTo === 'COMPANY') {
          return <span className="text-muted-foreground">-</span>;
        }
        return row.original.isMultiResource ? (
          <Badge variant="default">Sí</Badge>
        ) : (
          <Badge variant="secondary">No</Badge>
        );
      },
      filterFn: (row, id, value) => {
        const isMultiResource = row.original.isMultiResource ? 'true' : 'false';
        return value.includes(isMultiResource);
      },
    },

    // Acciones
    {
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => {
        const docType = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0"
                data-testid={`doctype-actions-${docType.id}`}
              >
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canUpdate && (
                <DropdownMenuItem
                  onClick={() => onEdit(docType)}
                  data-testid={`doctype-edit-${docType.id}`}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {canUpdate && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(docType)}
                  className="text-destructive"
                  data-testid={`doctype-delete-${docType.id}`}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
