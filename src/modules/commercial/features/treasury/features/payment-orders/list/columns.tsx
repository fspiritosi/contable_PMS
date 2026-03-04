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
import { PAYMENT_ORDER_STATUS_LABELS, PAYMENT_ORDER_STATUS_BADGES } from '../../../shared/validators';
import type { PaymentOrderListItem } from '../../../shared/types';

interface ColumnsProps {
  onViewDetail: (order: PaymentOrderListItem) => void;
  onEdit: (order: PaymentOrderListItem) => void;
  onConfirm: (order: PaymentOrderListItem) => void;
  onDelete: (order: PaymentOrderListItem) => void;
  canEdit?: boolean;
  canApprove?: boolean;
  canDelete?: boolean;
}

export function getColumns({ onViewDetail, onEdit, onConfirm, onDelete, canEdit = true, canApprove = true, canDelete = true }: ColumnsProps): ColumnDef<PaymentOrderListItem>[] {
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
      accessorKey: 'supplier',
      meta: { title: 'Proveedor' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Proveedor" />,
      cell: ({ row }) => {
        const supplier = row.original.supplier;
        return supplier ? (supplier.tradeName || supplier.businessName) : <span className="text-muted-foreground">-</span>;
      },
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
      meta: { title: 'Items' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Items" />,
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
        <Badge variant={PAYMENT_ORDER_STATUS_BADGES[row.original.status]}>
          {PAYMENT_ORDER_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const paymentOrder = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onViewDetail(paymentOrder)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver Detalle
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => {
                  window.open(`/api/payment-orders/${paymentOrder.id}/pdf`, '_blank');
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                Descargar PDF
              </DropdownMenuItem>

              {paymentOrder.status === 'DRAFT' && (
                <>
                  {canEdit && (
                    <DropdownMenuItem onClick={() => onEdit(paymentOrder)}>
                      <Edit className="mr-2 h-4 w-4" />
                      Editar
                    </DropdownMenuItem>
                  )}

                  {canApprove && (
                    <DropdownMenuItem onClick={() => onConfirm(paymentOrder)}>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Confirmar Orden
                    </DropdownMenuItem>
                  )}

                  {canDelete && (
                    <DropdownMenuItem onClick={() => onDelete(paymentOrder)} className="text-destructive">
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
