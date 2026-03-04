'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, User, Phone, Mail, Building2 } from 'lucide-react';

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
import type { ContactListItem } from './actions.server';

interface ColumnsProps {
  onEdit: (contact: ContactListItem) => void;
  onDelete: (contact: ContactListItem) => void;
  permissions: ModulePermissions;
}

export function getColumns({ onEdit, onDelete, permissions }: ColumnsProps): ColumnDef<ContactListItem>[] {
  const { canUpdate, canDelete } = permissions;
  const hasAnyAction = canUpdate || canDelete;

  const baseColumns: ColumnDef<ContactListItem>[] = [
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
      id: 'name',
      accessorFn: (row) => `${row.firstName} ${row.lastName}`,
      meta: { title: 'Nombre' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
      cell: ({ row }) => {
        const contact = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div>
              <span className="font-medium">
                {contact.firstName} {contact.lastName}
              </span>
              {contact.position && (
                <p className="text-xs text-muted-foreground">{contact.position}</p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'email',
      meta: { title: 'Email' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
      cell: ({ row }) => {
        const email = row.original.email;
        if (!email) return '-';
        return (
          <div className="flex items-center gap-1">
            <Mail className="h-3 w-3 text-muted-foreground" />
            <span className="truncate max-w-[180px]">{email}</span>
          </div>
        );
      },
    },
    {
      accessorKey: 'phone',
      meta: { title: 'Teléfono' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Teléfono" />,
      cell: ({ row }) => {
        const phone = row.original.phone;
        if (!phone) return '-';
        return (
          <div className="flex items-center gap-1">
            <Phone className="h-3 w-3 text-muted-foreground" />
            <span>{phone}</span>
          </div>
        );
      },
    },
    {
      id: 'linkedTo',
      meta: { title: 'Vinculado a' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Vinculado a" />,
      filterFn: (row, _columnId, filterValues: string[]) => {
        if (!filterValues || filterValues.length === 0) return true;
        const contact = row.original;
        if (contact.contractor && filterValues.includes('client')) return true;
        if (contact.lead && !contact.contractor && filterValues.includes('lead')) return true;
        if (!contact.contractor && !contact.lead && filterValues.includes('none')) return true;
        return false;
      },
      cell: ({ row }) => {
        const contact = row.original;

        if (contact.contractor) {
          return (
            <div className="flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{contact.contractor.name}</span>
              <Badge variant="default" className="text-xs">Cliente</Badge>
            </div>
          );
        }

        if (contact.lead) {
          return (
            <div className="flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{contact.lead.name}</span>
              <Badge variant="secondary" className="text-xs">Lead</Badge>
            </div>
          );
        }

        return <span className="text-muted-foreground">Sin vincular</span>;
      },
    },
  ];

  // Solo agregar columna de acciones si el usuario tiene al menos un permiso
  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const contact = row.original;
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
                <DropdownMenuItem onClick={() => onEdit(contact)}>
                  Editar
                </DropdownMenuItem>
              )}
              {canUpdate && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(contact)}
                  className="text-destructive"
                >
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
