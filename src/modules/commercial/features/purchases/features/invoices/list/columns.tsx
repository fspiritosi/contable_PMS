'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Eye, CheckCircle, XCircle, Pencil, PackageSearch, PackageCheck, PackageMinus } from 'lucide-react';
import { Badge } from '@/shared/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';
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
import { formatCurrency } from '@/shared/utils/formatters';
import type { PurchaseInvoiceListItem } from './actions.server';
import { PURCHASE_INVOICE_STATUS_LABELS, VOUCHER_TYPE_LABELS } from '../shared/validators';
import type { PurchaseInvoiceStatus } from '@/generated/prisma/enums';

interface ColumnsProps {
  onView: (invoice: PurchaseInvoiceListItem) => void;
  onEdit?: (invoice: PurchaseInvoiceListItem) => void;
  onConfirm?: (invoice: PurchaseInvoiceListItem) => void;
  onCancel?: (invoice: PurchaseInvoiceListItem) => void;
  loading: string | null;
}

export function getColumns({ onView, onEdit, onConfirm, onCancel, loading }: ColumnsProps): ColumnDef<PurchaseInvoiceListItem>[] {
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
      accessorKey: 'voucherType',
      meta: { title: 'Tipo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      cell: ({ row }) => (
        <div className="text-sm">
          {VOUCHER_TYPE_LABELS[row.original.voucherType] || row.original.voucherType}
        </div>
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
        <div className="text-sm">{moment(row.original.issueDate).format('DD/MM/YYYY')}</div>
      ),
    },
    {
      accessorKey: 'total',
      meta: { title: 'Total' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total" className="justify-end" />,
      cell: ({ row }) => (
        <div className="text-right font-mono font-semibold">
          {formatCurrency(Number(row.original.total))}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const status = row.original.status;
        const variant:
          | 'default'
          | 'secondary'
          | 'destructive'
          | 'outline'
          | 'success'
          | 'warning' =
          status === 'CONFIRMED'
            ? 'success'
            : status === 'PAID'
            ? 'success'
            : status === 'PARTIAL_PAID'
            ? 'warning'
            : status === 'CANCELLED'
            ? 'destructive'
            : 'secondary';

        return (
          <div className="flex items-center gap-1.5">
            <Badge variant={variant}>
              {PURCHASE_INVOICE_STATUS_LABELS[status as PurchaseInvoiceStatus]}
            </Badge>
            {row.original.receptionStatus === 'pending' && (
              <Tooltip>
                <TooltipTrigger>
                  <PackageSearch className="h-4 w-4 text-yellow-600" />
                </TooltipTrigger>
                <TooltipContent>Pendiente de recepción</TooltipContent>
              </Tooltip>
            )}
            {row.original.receptionStatus === 'partial' && (
              <Tooltip>
                <TooltipTrigger>
                  <PackageMinus className="h-4 w-4 text-orange-500" />
                </TooltipTrigger>
                <TooltipContent>Recibida parcialmente</TooltipContent>
              </Tooltip>
            )}
            {row.original.receptionStatus === 'complete' && (
              <Tooltip>
                <TooltipTrigger>
                  <PackageCheck className="h-4 w-4 text-green-600" />
                </TooltipTrigger>
                <TooltipContent>Recibida completa</TooltipContent>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const invoice = row.original;
        const isLoading = loading === invoice.id;
        const canEdit = invoice.status === 'DRAFT';
        const canConfirm = invoice.status === 'DRAFT';
        const canCancel =
          invoice.status === 'DRAFT' || invoice.status === 'CONFIRMED';

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
              <DropdownMenuItem onClick={() => onView(invoice)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver detalle
              </DropdownMenuItem>
              {canEdit && onEdit && (
                <DropdownMenuItem onClick={() => onEdit(invoice)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {canConfirm && onConfirm && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onConfirm(invoice)}
                    disabled={isLoading}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Confirmar factura
                  </DropdownMenuItem>
                </>
              )}
              {canCancel && onCancel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onCancel(invoice)}
                    disabled={isLoading}
                    className="text-destructive"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancelar factura
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
