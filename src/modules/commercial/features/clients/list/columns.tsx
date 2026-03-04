'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Building2, Phone, Mail, Users, Truck, Eye } from 'lucide-react';
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
import type { ClientListItem } from './actions.server';

interface ColumnsProps {
  onEdit: (client: ClientListItem) => void;
  onDeactivate: (client: ClientListItem) => void;
  onReactivate: (client: ClientListItem) => void;
  permissions: ModulePermissions;
}

export function getColumns({ onEdit, onDeactivate, onReactivate, permissions }: ColumnsProps): ColumnDef<ClientListItem>[] {
  const { canUpdate, canDelete } = permissions;
  const hasAnyAction = canUpdate || canDelete;

  const baseColumns: ColumnDef<ClientListItem>[] = [
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
        const client = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Building2 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <Link
                href={`/dashboard/company/commercial/clients/${client.id}`}
                className="font-medium hover:underline"
              >
                {client.name}
              </Link>
              {client.contact && (
                <p className="text-xs text-muted-foreground">
                  {client.contact.firstName} {client.contact.lastName}
                </p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'taxId',
      meta: { title: 'CUIT' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="CUIT" />,
      cell: ({ row }) => row.original.taxId || '-',
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
            <span className="truncate max-w-[200px]">{email}</span>
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
      id: 'allocations',
      meta: { title: 'Asignaciones' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Asignaciones" />,
      cell: ({ row }) => {
        const vehicles = row.original._count.vehicleAllocations;
        const employees = row.original._count.employeeAllocations;
        return (
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-1" title="Equipos asignados">
              <Truck className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{vehicles}</span>
            </div>
            <div className="flex items-center gap-1" title="Empleados asignados">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{employees}</span>
            </div>
          </div>
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
            {isActive ? 'Activo' : 'Inactivo'}
          </Badge>
        );
      },
      filterFn: (row, id, value) => {
        const isActive = row.getValue(id);
        return value.includes(String(isActive));
      },
    },
  ];

  // Solo agregar columna de acciones si el usuario tiene al menos un permiso
  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const client = row.original;
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
                <Link href={`/dashboard/company/commercial/clients/${client.id}`}>
                  <Eye className="mr-2 h-4 w-4" />
                  Ver detalle
                </Link>
              </DropdownMenuItem>
              {canUpdate && (
                <DropdownMenuItem onClick={() => onEdit(client)}>
                  Editar
                </DropdownMenuItem>
              )}
              {canUpdate && canDelete && <DropdownMenuSeparator />}
              {canDelete && client.isActive && (
                <DropdownMenuItem
                  onClick={() => onDeactivate(client)}
                  className="text-destructive"
                >
                  Dar de baja
                </DropdownMenuItem>
              )}
              {canUpdate && !client.isActive && (
                <DropdownMenuItem onClick={() => onReactivate(client)}>
                  Reactivar
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
