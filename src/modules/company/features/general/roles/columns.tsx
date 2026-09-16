'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Shield, Edit, Trash2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Badge } from '@/shared/components/ui/badge';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import type { ModulePermissions } from '@/shared/lib/permissions';

import type { RoleListItem } from './actions.server';
import { _RoleMembersPopover } from './components/_RoleMembersPopover';

interface GetColumnsProps {
  onEdit: (roleId: string) => void;
  onDelete: (role: RoleListItem) => void;
  permissions: ModulePermissions;
  /** Permiso `company.general.users:view`: muestra el link "Gestionar en Usuarios" en el Popover. */
  canViewUsers: boolean;
}

export function getColumns({
  onEdit,
  onDelete,
  permissions,
  canViewUsers,
}: GetColumnsProps): ColumnDef<RoleListItem>[] {
  const { canUpdate, canDelete } = permissions;
  const hasAnyAction = canUpdate || canDelete;

  const baseColumns: ColumnDef<RoleListItem>[] = [
    {
      accessorKey: 'name',
      meta: { title: 'Nombre' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
      cell: ({ row }) => {
        const role = row.original;

        return (
          <div className="flex items-center gap-2">
            {role.color && (
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: role.color }}
              />
            )}
            <span className="font-medium">{role.name}</span>
            {role.isSystem && (
              <Badge variant="secondary" className="text-xs">
                <Shield className="mr-1 h-3 w-3" />
                Sistema
              </Badge>
            )}
            {role.isDefault && (
              <Badge variant="outline" className="text-xs">
                Por defecto
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'description',
      meta: { title: 'Descripción' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Descripción" />,
      cell: ({ row }) => {
        return (
          <span className="text-muted-foreground">
            {row.original.description || 'Sin descripción'}
          </span>
        );
      },
    },
    {
      accessorKey: 'permissions',
      meta: { title: 'Permisos' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Permisos" />,
      cell: ({ row }) => {
        const count = row.original.permissions.length;
        return (
          <Badge variant="outline">
            {count} {count === 1 ? 'permiso' : 'permisos'}
          </Badge>
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: 'members',
      meta: { title: 'Usuarios' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Usuarios" />,
      cell: ({ row }) => (
        <_RoleMembersPopover role={row.original} canViewUsers={canViewUsers} />
      ),
      enableSorting: false,
    },
  ];

  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const role = row.original;
        const canDeleteRole = canDelete && !role.isSystem && role._count.members === 0;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0"
                data-testid={`role-actions-${role.id}`}
              >
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canUpdate && (
                <DropdownMenuItem
                  onClick={() => onEdit(role.id)}
                  data-testid={`role-edit-${role.id}`}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  {role.isSystem ? 'Ver permisos' : 'Editar'}
                </DropdownMenuItem>
              )}
              {canDelete && !role.isSystem && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete(role)}
                    disabled={!canDeleteRole}
                    className={canDeleteRole ? 'text-destructive focus:text-destructive' : ''}
                    data-testid={`role-delete-${role.id}`}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {canDeleteRole ? 'Eliminar' : 'No eliminable'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
  }

  return baseColumns;
}
