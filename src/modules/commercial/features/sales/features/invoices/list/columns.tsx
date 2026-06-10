'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Eye, Pencil, CheckCircle, XCircle, FileText, Download, Paperclip } from 'lucide-react';
import moment from 'moment';

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
import { VOUCHER_TYPE_LABELS, INVOICE_STATUS_LABELS } from '../shared/validators';
import type { getInvoices } from './actions.server';

type Invoice = Awaited<ReturnType<typeof getInvoices>>[number];

function getStatusBadge(status: string) {
  switch (status) {
    case 'DRAFT':
      return (
        <Badge variant="outline" className="gap-1">
          <FileText className="h-3 w-3" />
          {INVOICE_STATUS_LABELS[status]}
        </Badge>
      );
    case 'CONFIRMED':
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          {INVOICE_STATUS_LABELS[status]}
        </Badge>
      );
    case 'PAID':
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          {INVOICE_STATUS_LABELS[status]}
        </Badge>
      );
    case 'PARTIAL_PAID':
      return (
        <Badge variant="warning" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          {INVOICE_STATUS_LABELS[status]}
        </Badge>
      );
    case 'CANCELLED':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          {INVOICE_STATUS_LABELS[status]}
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

interface ColumnsProps {
  onView: (invoice: Invoice) => void;
  onEdit?: (invoice: Invoice) => void;
  onConfirm?: (invoice: Invoice) => void;
  onCancel?: (invoice: Invoice) => void;
  onAttach: (invoice: Invoice) => void;
}

export function getColumns({ onView, onEdit, onConfirm, onCancel, onAttach }: ColumnsProps): ColumnDef<Invoice>[] {
  return [
    {
      accessorKey: 'fullNumber',
      meta: { title: 'Número' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Número" />,
      cell: ({ row }) => <div className="font-mono font-semibold">{row.original.fullNumber}</div>,
    },
    {
      accessorKey: 'voucherType',
      meta: { title: 'Tipo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      cell: ({ row }) => (
        <Badge variant="outline">
          {VOUCHER_TYPE_LABELS[row.original.voucherType as keyof typeof VOUCHER_TYPE_LABELS]}
        </Badge>
      ),
    },
    {
      accessorKey: 'issueDate',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => moment(row.original.issueDate).format('DD/MM/YYYY'),
    },
    {
      accessorKey: 'customer.name',
      meta: { title: 'Cliente' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Cliente" />,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.customer.name}</div>
          {row.original.customer.taxId && (
            <div className="text-xs text-muted-foreground">{row.original.customer.taxId}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'total',
      meta: { title: 'Total' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total" className="justify-end" />,
      cell: ({ row }) => (
        <div className="font-semibold text-right">
          ${Number(row.original.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => getStatusBadge(row.original.status),
    },
    {
      id: 'document',
      meta: { title: 'Adj.' },
      header: () => <div className="text-center">Adj.</div>,
      cell: ({ row }) => (
        <div className="text-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onAttach(row.original)}
            title={row.original.documentUrl ? 'Ver/cambiar adjunto' : 'Adjuntar documento'}
          >
            <Paperclip className={`h-4 w-4 ${row.original.documentUrl ? 'text-primary' : 'text-muted-foreground'}`} />
          </Button>
        </div>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const invoice = row.original;
        const isDraft = invoice.status === 'DRAFT';
        const isCancelled = invoice.status === 'CANCELLED';

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
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onView(invoice)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver Detalle
              </DropdownMenuItem>
              {isDraft && onEdit && (
                <DropdownMenuItem onClick={() => onEdit(invoice)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {isDraft && onConfirm && (
                <DropdownMenuItem onClick={() => onConfirm(invoice)}>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Confirmar
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onAttach(invoice)}>
                <Paperclip className="mr-2 h-4 w-4" />
                {invoice.documentUrl ? 'Ver Adjunto' : 'Adjuntar Documento'}
              </DropdownMenuItem>
              {!isCancelled && onCancel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onCancel(invoice)} className="text-destructive">
                    <XCircle className="mr-2 h-4 w-4" />
                    Anular
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-2 h-4 w-4" />
                  Descargar PDF
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
