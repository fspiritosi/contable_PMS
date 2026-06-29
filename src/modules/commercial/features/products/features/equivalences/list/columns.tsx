'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Eye, Edit, Trash2, Layers } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
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

export interface EquivalenceRow extends Record<string, unknown> {
  id: string;
  name: string;
  oemCode: string | null;
  notes: string | null;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface ColumnsProps {
  onEdit: (group: EquivalenceRow) => void;
  onDelete: (group: EquivalenceRow) => void;
  onViewDetail: (group: EquivalenceRow) => void;
  permissions: ModulePermissions;
}

export function getEquivalenceColumns({
  onEdit,
  onDelete,
  onViewDetail,
  permissions,
}: ColumnsProps): ColumnDef<EquivalenceRow>[] {
  const { canUpdate, canDelete } = permissions;
  const hasAnyAction = canUpdate || canDelete;

  const baseColumns: ColumnDef<EquivalenceRow>[] = [
    {
      accessorKey: 'name',
      meta: { title: 'Grupo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Grupo" />,
      cell: ({ row }) => {
        const group = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Layers className="h-4 w-4 text-primary" />
            </div>
            <div>
              <button
                onClick={() => onViewDetail(group)}
                className="font-medium hover:underline text-left"
              >
                {group.name}
              </button>
              {group.notes && (
                <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                  {group.notes}
                </p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'oemCode',
      meta: { title: 'Código OEM' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Código OEM" />,
      cell: ({ row }) => {
        const oemCode = row.original.oemCode;
        return oemCode ? (
          <span className="font-mono text-sm">{oemCode}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      accessorKey: 'productCount',
      meta: { title: 'Artículos' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Artículos" />,
      cell: ({ row }) => {
        const count = row.original.productCount;
        return (
          <Badge variant={count > 0 ? 'default' : 'secondary'}>
            {count} {count === 1 ? 'artículo' : 'artículos'}
          </Badge>
        );
      },
    },
  ];

  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const group = row.original;
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
              <DropdownMenuItem onClick={() => onViewDetail(group)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver detalle
              </DropdownMenuItem>
              {canUpdate && (
                <DropdownMenuItem onClick={() => onEdit(group)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {canUpdate && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(group)}
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
