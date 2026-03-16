'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Eye, Pencil, CheckCircle, XCircle, Trash2 } from 'lucide-react';
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
import moment from 'moment';
import type { DeliveryNoteListItem } from './actions.server';
import { DELIVERY_NOTE_STATUS_LABELS, DELIVERY_NOTE_STATUS_VARIANTS } from '../shared/validators';
import type { DeliveryNoteStatus } from '@/generated/prisma/enums';

interface ColumnsProps {
  onView: (note: DeliveryNoteListItem) => void;
  onEdit?: (note: DeliveryNoteListItem) => void;
  onAccept?: (note: DeliveryNoteListItem) => void;
  onCancel?: (note: DeliveryNoteListItem) => void;
  onDelete?: (note: DeliveryNoteListItem) => void;
  loading: string | null;
}

export function getColumns({
  onView,
  onEdit,
  onAccept,
  onCancel,
  onDelete,
  loading,
}: ColumnsProps): ColumnDef<DeliveryNoteListItem>[] {
  return [
    {
      accessorKey: 'fullNumber',
      meta: { title: 'Número' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Número" />,
      cell: ({ row }) => (
        <div className="font-mono text-sm">{row.original.fullNumber}</div>
      ),
    },
    {
      accessorKey: 'customer',
      meta: { title: 'Cliente' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Cliente" />,
      cell: ({ row }) => (
        <div className="max-w-[200px]">
          <div className="font-medium truncate">{row.original.customer.name}</div>
          {row.original.customer.taxId && (
            <div className="text-xs text-muted-foreground font-mono">
              {row.original.customer.taxId}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'warehouse',
      meta: { title: 'Almacén' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Almacén" />,
      cell: ({ row }) => (
        <div className="text-sm">{row.original.warehouse.name}</div>
      ),
    },
    {
      accessorKey: 'deliveryDate',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => (
        <div className="text-sm">{moment.utc(row.original.deliveryDate).format('DD/MM/YYYY')}</div>
      ),
    },
    {
      id: 'invoice',
      meta: { title: 'Factura' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Factura" />,
      cell: ({ row }) => {
        const invoice = row.original.salesInvoice;
        if (!invoice) return <span className="text-sm text-muted-foreground">-</span>;
        return <span className="font-mono text-sm">{invoice.fullNumber}</span>;
      },
    },
    {
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const status = row.original.status as DeliveryNoteStatus;
        return (
          <Badge
            variant={DELIVERY_NOTE_STATUS_VARIANTS[status]}
            className={
              status === 'ACCEPTED'
                ? 'bg-green-600 hover:bg-green-700'
                : status === 'INVOICED'
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : undefined
            }
          >
            {DELIVERY_NOTE_STATUS_LABELS[status]}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const note = row.original;
        const isLoading = loading === note.id;
        const isPending = note.status === 'PENDING_DELIVERY';
        const isAccepted = note.status === 'ACCEPTED';

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0" disabled={isLoading}>
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onView(note)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver detalle
              </DropdownMenuItem>
              {isPending && onEdit && (
                <DropdownMenuItem onClick={() => onEdit(note)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {isPending && onAccept && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onAccept(note)} disabled={isLoading}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Aceptar
                  </DropdownMenuItem>
                </>
              )}
              {(isPending || isAccepted) && onCancel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onCancel(note)}
                    disabled={isLoading}
                    className="text-destructive"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Anular
                  </DropdownMenuItem>
                </>
              )}
              {isPending && onDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(note)}
                  disabled={isLoading}
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
    },
  ];
}
