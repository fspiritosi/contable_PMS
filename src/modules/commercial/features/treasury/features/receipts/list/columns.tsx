'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, CheckCircle, Eye, Download, Edit, Trash2 } from 'lucide-react';
import moment from 'moment';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import { RECEIPT_STATUS_LABELS, RECEIPT_STATUS_BADGES } from '../../../shared/validators';
import type { ReceiptListItem } from '../../../shared/types';

interface ColumnsProps {
  onViewDetail: (receipt: ReceiptListItem) => void;
  onEdit: (receipt: ReceiptListItem) => void;
  onConfirm: (receipt: ReceiptListItem) => void;
  onDelete: (receipt: ReceiptListItem) => void;
  canEdit?: boolean;
  canApprove?: boolean;
  canDelete?: boolean;
}

export function getColumns({ onViewDetail, onEdit, onConfirm, onDelete, canEdit = true, canApprove = true, canDelete = true }: ColumnsProps): ColumnDef<ReceiptListItem>[] {
  return [
    {
      accessorKey: 'fullNumber',
      meta: { title: 'Número' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Número" />,
    },
    {
      accessorKey: 'date',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => moment(row.original.date).format('DD/MM/YYYY'),
    },
    {
      accessorKey: 'customer',
      meta: { title: 'Cliente' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Cliente" />,
      cell: ({ row }) => row.original.customer.name,
    },
    {
      accessorKey: 'totalAmount',
      meta: { title: 'Monto Total' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Monto Total" />,
      cell: ({ row }) => (
        <span className="font-medium">
          ${row.original.totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      accessorKey: '_count.items',
      meta: { title: 'Facturas' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Facturas" />,
      cell: ({ row }) => row.original._count.items,
    },
    {
      accessorKey: '_count.payments',
      meta: { title: 'Pagos' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Pagos" />,
      cell: ({ row }) => row.original._count.payments,
    },
    {
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => (
        <Badge variant={RECEIPT_STATUS_BADGES[row.original.status]}>
          {RECEIPT_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const receipt = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onViewDetail(receipt)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver Detalle
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => {
                  window.open(`/api/receipts/${receipt.id}/pdf`, '_blank');
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                Descargar PDF
              </DropdownMenuItem>

              {receipt.status === 'DRAFT' && (
                <>
                  {canEdit && (
                    <DropdownMenuItem onClick={() => onEdit(receipt)}>
                      <Edit className="mr-2 h-4 w-4" />
                      Editar
                    </DropdownMenuItem>
                  )}

                  {canApprove && (
                    <DropdownMenuItem onClick={() => onConfirm(receipt)}>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Confirmar Recibo
                    </DropdownMenuItem>
                  )}

                  {canDelete && (
                    <DropdownMenuItem onClick={() => onDelete(receipt)} className="text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" />
                      Eliminar
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
