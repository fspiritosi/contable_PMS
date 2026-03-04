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
import type { ReceivingNoteListItem } from './actions.server';
import { RECEIVING_NOTE_STATUS_LABELS, RECEIVING_NOTE_STATUS_VARIANTS } from '../shared/validators';
import type { ReceivingNoteStatus } from '@/generated/prisma/enums';

interface ColumnsProps {
  onView: (note: ReceivingNoteListItem) => void;
  onEdit?: (note: ReceivingNoteListItem) => void;
  onConfirm?: (note: ReceivingNoteListItem) => void;
  onCancel?: (note: ReceivingNoteListItem) => void;
  onDelete?: (note: ReceivingNoteListItem) => void;
  loading: string | null;
}

export function getColumns({
  onView,
  onEdit,
  onConfirm,
  onCancel,
  onDelete,
  loading,
}: ColumnsProps): ColumnDef<ReceivingNoteListItem>[] {
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
      accessorKey: 'supplier',
      meta: { title: 'Proveedor' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Proveedor" />,
      cell: ({ row }) => (
        <div className="max-w-[200px]">
          <div className="font-medium truncate">
            {row.original.supplier.tradeName || row.original.supplier.businessName}
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {row.original.supplier.taxId}
          </div>
        </div>
      ),
    },
    {
      id: 'document',
      meta: { title: 'Documento' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Documento" />,
      cell: ({ row }) => {
        const po = row.original.purchaseOrder;
        const pi = row.original.purchaseInvoice;
        if (po) {
          return (
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-xs">OC</Badge>
              <span className="font-mono text-sm">{po.fullNumber}</span>
            </div>
          );
        }
        if (pi) {
          return (
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-xs">FC</Badge>
              <span className="font-mono text-sm">{pi.fullNumber}</span>
            </div>
          );
        }
        return <span className="text-sm text-muted-foreground">Sin documento</span>;
      },
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
      accessorKey: 'receptionDate',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => (
        <div className="text-sm">{moment.utc(row.original.receptionDate).format('DD/MM/YYYY')}</div>
      ),
    },
    {
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const status = row.original.status as ReceivingNoteStatus;
        return (
          <Badge
            variant={RECEIVING_NOTE_STATUS_VARIANTS[status]}
            className={status === 'CONFIRMED' ? 'bg-green-600 hover:bg-green-700' : undefined}
          >
            {RECEIVING_NOTE_STATUS_LABELS[status]}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const note = row.original;
        const isLoading = loading === note.id;
        const isDraft = note.status === 'DRAFT';
        const isConfirmed = note.status === 'CONFIRMED';

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
              {isDraft && onEdit && (
                <DropdownMenuItem onClick={() => onEdit(note)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {isDraft && onConfirm && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onConfirm(note)} disabled={isLoading}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Confirmar
                  </DropdownMenuItem>
                </>
              )}
              {isConfirmed && onCancel && (
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
              {isDraft && onDelete && (
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
