'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Edit, MoreHorizontal, Power, Trash2 } from 'lucide-react';

import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
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
import { CONCEPT_USAGE_LABELS } from '@/shared/lib/concepts/usages';
import type { ModulePermissions } from '@/shared/lib/permissions';
import type { ConceptRow } from './actions.server';

interface ColumnsProps {
  onEdit: (concept: ConceptRow) => void;
  onToggleActive: (concept: ConceptRow) => void;
  onDelete: (concept: ConceptRow) => void;
  permissions: ModulePermissions;
}

export function getColumns({
  onEdit,
  onToggleActive,
  onDelete,
  permissions,
}: ColumnsProps): ColumnDef<ConceptRow>[] {
  const { canUpdate, canDelete } = permissions;

  const columns: ColumnDef<ConceptRow>[] = [
    {
      accessorKey: 'name',
      meta: { title: 'Nombre' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: 'usages',
      meta: { title: 'Usos' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Usos" />,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.usages.map((usage) => (
            <Badge key={usage} variant="outline">
              {CONCEPT_USAGE_LABELS[usage]}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      accessorKey: 'account',
      meta: { title: 'Cuenta' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Cuenta" />,
      // Es una relación: `stateToPrismaParams` no puede traducir el orderBy.
      enableSorting: false,
      cell: ({ row }) => {
        const { accountMode, account } = row.original;
        if (accountMode === 'PARTNER_ACCOUNT') {
          return <span className="text-muted-foreground">Cuenta del socio</span>;
        }
        if (!account) return '-';
        return (
          <span className="font-mono text-xs">
            {account.code} - {account.name}
          </span>
        );
      },
    },
    {
      accessorKey: 'isActive',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
          {row.original.isActive ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
  ];

  if (canUpdate || canDelete) {
    columns.push({
      id: 'actions',
      meta: { title: 'Acciones' },
      cell: ({ row }) => {
        const concept = row.original;
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
              {canUpdate && (
                <DropdownMenuItem onClick={() => onEdit(concept)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {canUpdate && (
                <DropdownMenuItem onClick={() => onToggleActive(concept)}>
                  <Power className="mr-2 h-4 w-4" />
                  {concept.isActive ? 'Desactivar' : 'Activar'}
                </DropdownMenuItem>
              )}
              {canUpdate && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem onClick={() => onDelete(concept)} className="text-destructive">
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

  return columns;
}
