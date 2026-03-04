'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Eye, Pencil, Send, CheckCircle, XCircle, Trash2 } from 'lucide-react';
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
import type { PurchaseOrderListItem } from './actions.server';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_VARIANTS,
  PURCHASE_ORDER_INVOICING_STATUS_LABELS,
  PURCHASE_ORDER_INVOICING_STATUS_VARIANTS,
} from '../shared/validators';
import type { PurchaseOrderStatus, PurchaseOrderInvoicingStatus } from '@/generated/prisma/enums';
import { formatCurrency } from '@/shared/utils/formatters';

interface ColumnsProps {
  onView: (order: PurchaseOrderListItem) => void;
  onEdit?: (order: PurchaseOrderListItem) => void;
  onSubmitForApproval?: (order: PurchaseOrderListItem) => void;
  onApprove?: (order: PurchaseOrderListItem) => void;
  onCancel?: (order: PurchaseOrderListItem) => void;
  onDelete?: (order: PurchaseOrderListItem) => void;
  loading: string | null;
}

export function getColumns({
  onView,
  onEdit,
  onSubmitForApproval,
  onApprove,
  onCancel,
  onDelete,
  loading,
}: ColumnsProps): ColumnDef<PurchaseOrderListItem>[] {
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
          {row.original.supplier.taxId && (
            <div className="text-xs text-muted-foreground font-mono">
              {row.original.supplier.taxId}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'issueDate',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => (
        <div className="text-sm">{moment.utc(row.original.issueDate).format('DD/MM/YYYY')}</div>
      ),
    },
    {
      accessorKey: 'expectedDeliveryDate',
      meta: { title: 'Entrega' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Entrega" />,
      cell: ({ row }) => (
        <div className="text-sm">
          {row.original.expectedDeliveryDate
            ? moment.utc(row.original.expectedDeliveryDate).format('DD/MM/YYYY')
            : '-'}
        </div>
      ),
    },
    {
      accessorKey: 'total',
      meta: { title: 'Total' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
      cell: ({ row }) => (
        <div className="text-right font-mono font-semibold">
          {formatCurrency(Number(row.original.total))}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      meta: { title: 'Recepción' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Recepción" />,
      cell: ({ row }) => {
        const status = row.original.status as PurchaseOrderStatus;
        const variant = PURCHASE_ORDER_STATUS_VARIANTS[status];
        return (
          <Badge
            variant={variant}
            className={status === 'APPROVED' ? 'bg-green-600 hover:bg-green-700' : undefined}
          >
            {PURCHASE_ORDER_STATUS_LABELS[status]}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'invoicingStatus',
      meta: { title: 'Facturación' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Facturación" />,
      cell: ({ row }) => {
        const status = row.original.invoicingStatus as PurchaseOrderInvoicingStatus;
        const variant = PURCHASE_ORDER_INVOICING_STATUS_VARIANTS[status];
        return (
          <Badge
            variant={variant}
            className={status === 'FULLY_INVOICED' ? 'bg-green-600 hover:bg-green-700' : undefined}
          >
            {PURCHASE_ORDER_INVOICING_STATUS_LABELS[status]}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const order = row.original;
        const isLoading = loading === order.id;
        const isDraft = order.status === 'DRAFT';
        const isPending = order.status === 'PENDING_APPROVAL';
        const canCancel = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(order.status);

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
              <DropdownMenuItem onClick={() => onView(order)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver detalle
              </DropdownMenuItem>
              {isDraft && onEdit && (
                <DropdownMenuItem onClick={() => onEdit(order)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {isDraft && onSubmitForApproval && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onSubmitForApproval(order)} disabled={isLoading}>
                    <Send className="mr-2 h-4 w-4" />
                    Enviar a aprobación
                  </DropdownMenuItem>
                </>
              )}
              {isPending && onApprove && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onApprove(order)} disabled={isLoading}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Aprobar
                  </DropdownMenuItem>
                </>
              )}
              {canCancel && onCancel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onCancel(order)}
                    disabled={isLoading}
                    className="text-destructive"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancelar
                  </DropdownMenuItem>
                </>
              )}
              {isDraft && onDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(order)}
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
