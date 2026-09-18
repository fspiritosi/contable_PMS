'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Edit, Eye, Mail, MoreHorizontal, Phone, Trash2, Users } from 'lucide-react';
import Link from 'next/link';

import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
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
import type { ModulePermissions } from '@/shared/lib/permissions';
import { formatCurrency } from '@/shared/utils/formatters';
import type { PartnerWithBalance } from '../../shared/types';

interface ColumnsProps {
  onEdit: (partner: PartnerWithBalance) => void;
  onDelete: (partner: PartnerWithBalance) => void;
  permissions: ModulePermissions;
}

export function getColumns({
  onEdit,
  onDelete,
  permissions,
}: ColumnsProps): ColumnDef<PartnerWithBalance>[] {
  const { canUpdate, canDelete } = permissions;
  const hasAnyAction = canUpdate || canDelete;

  const baseColumns: ColumnDef<PartnerWithBalance>[] = [
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
        const partner = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <Link
              href={`/dashboard/commercial/treasury/partners/${partner.id}`}
              className="font-medium hover:underline"
            >
              {partner.name}
            </Link>
          </div>
        );
      },
    },
    {
      accessorKey: 'taxId',
      meta: { title: 'CUIT/CUIL' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="CUIT/CUIL" />,
      cell: ({ row }) => {
        const taxId = row.original.taxId;
        if (!taxId) return '-';
        return <span className="font-mono text-sm">{taxId}</span>;
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
      accessorKey: 'contributionsAccount',
      meta: { title: 'Cuenta de aportes' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Cuenta de aportes" />,
      // Es una relación: `stateToPrismaParams` no puede traducir el orderBy.
      enableSorting: false,
      cell: ({ row }) => {
        const account = row.original.contributionsAccount;
        if (!account) return <span className="text-muted-foreground">Por defecto</span>;
        return (
          <span className="font-mono text-xs" title={account.name}>
            {account.code} · {account.name}
          </span>
        );
      },
    },
    {
      accessorKey: 'balance',
      meta: { title: 'Saldo a favor' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Saldo a favor" />,
      cell: ({ row }) => {
        const balance = row.original.balance;
        const colorClass =
          balance > 0
            ? 'text-red-600 font-medium'
            : balance < 0
              ? 'text-green-600 font-medium'
              : 'text-muted-foreground';
        return (
          <div className="text-right">
            <span className={colorClass}>{formatCurrency(balance)}</span>
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
    },
  ];

  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const partner = row.original;
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
                <Link href={`/dashboard/commercial/treasury/partners/${partner.id}`}>
                  <Eye className="mr-2 h-4 w-4" />
                  Ver detalle
                </Link>
              </DropdownMenuItem>
              {canUpdate && (
                <DropdownMenuItem onClick={() => onEdit(partner)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {canUpdate && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem onClick={() => onDelete(partner)} className="text-destructive">
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
