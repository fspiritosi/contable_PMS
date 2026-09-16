'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Shield, UserMinus, Edit } from 'lucide-react';
import moment from 'moment';

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

import { _MemberIdentity } from '../shared/_MemberIdentity';
import type { CompanyMemberListItem } from './actions.server';

interface GetColumnsProps {
  onEditRole: (member: CompanyMemberListItem) => void;
  onDeactivate: (member: CompanyMemberListItem) => void;
  currentUserId: string;
  permissions: ModulePermissions;
}

export function getColumns({
  onEditRole,
  onDeactivate,
  currentUserId,
  permissions,
}: GetColumnsProps): ColumnDef<CompanyMemberListItem>[] {
  const { canUpdate, canDelete } = permissions;
  const hasAnyAction = canUpdate || canDelete;

  const baseColumns: ColumnDef<CompanyMemberListItem>[] = [
    {
      accessorKey: 'user',
      meta: { title: 'Usuario' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Usuario" />,
      cell: ({ row }) => {
        const member = row.original;

        return (
          <_MemberIdentity
            size="sm"
            firstName={member.firstName}
            lastName={member.lastName}
            email={member.email}
            imageUrl={member.imageUrl}
          />
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: 'role',
      meta: { title: 'Rol' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Rol" />,
      cell: ({ row }) => {
        const member = row.original;

        if (member.isOwner) {
          return (
            <Badge variant="default" className="bg-amber-500 hover:bg-amber-500">
              <Shield className="mr-1 h-3 w-3" />
              Propietario
            </Badge>
          );
        }

        if (member.role) {
          return (
            <Badge
              variant="outline"
              style={member.role.color ? { borderColor: member.role.color, color: member.role.color } : undefined}
            >
              {member.role.name}
            </Badge>
          );
        }

        return <span className="text-muted-foreground">Sin rol</span>;
      },
      enableSorting: false,
    },
    {
      accessorKey: 'employee',
      meta: { title: 'Empleado Vinculado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Empleado Vinculado" />,
      cell: ({ row }) => {
        const member = row.original;

        if (!member.employee) {
          return <span className="text-muted-foreground">No vinculado</span>;
        }

        return (
          <div className="flex flex-col">
            <span className="font-medium">
              {member.employee.firstName} {member.employee.lastName}
            </span>
            <span className="text-sm text-muted-foreground">Legajo: {member.employee.employeeNumber}</span>
          </div>
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: 'createdAt',
      meta: { title: 'Miembro desde' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Miembro desde" />,
      cell: ({ row }) => {
        return moment(row.original.createdAt).format('DD/MM/YYYY');
      },
    },
  ];

  // Solo agregar columna de acciones si el usuario tiene al menos un permiso
  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const member = row.original;
        const isCurrentUser = member.userId === currentUserId;
        const canEditMember = !member.isOwner && !isCurrentUser;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEditMember && canUpdate && (
                <DropdownMenuItem onClick={() => onEditRole(member)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Cambiar rol
                </DropdownMenuItem>
              )}
              {canEditMember && canUpdate && canDelete && <DropdownMenuSeparator />}
              {canEditMember && canDelete && (
                <DropdownMenuItem
                  onClick={() => onDeactivate(member)}
                  className="text-destructive focus:text-destructive"
                >
                  <UserMinus className="mr-2 h-4 w-4" />
                  Desactivar
                </DropdownMenuItem>
              )}
              {member.isOwner && (
                <DropdownMenuItem disabled>
                  <Shield className="mr-2 h-4 w-4" />
                  Propietario (no editable)
                </DropdownMenuItem>
              )}
              {isCurrentUser && !member.isOwner && (
                <DropdownMenuItem disabled>No puedes editarte a ti mismo</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
  }

  return baseColumns;
}
