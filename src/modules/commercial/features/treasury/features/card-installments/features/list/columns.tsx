'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Calendar, CreditCard, User } from 'lucide-react';
import moment from 'moment';

import { Badge } from '@/shared/components/ui/badge';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import { formatCurrency } from '@/shared/utils/formatters';
import type { PaymentInstallmentStatus } from '@/generated/prisma/enums';
import type { getCardInstallments } from './actions.server';

type CardInstallmentsResult = Awaited<ReturnType<typeof getCardInstallments>>;
export type CardInstallment = CardInstallmentsResult['data'][number];

export const CARD_INSTALLMENT_STATUS_LABELS: Record<PaymentInstallmentStatus, string> = {
  PENDING: 'Pendiente',
  PAID: 'Pagada',
};

export function getColumns(): ColumnDef<CardInstallment>[] {
  return [
    {
      accessorKey: 'dueDate',
      meta: { title: 'Vencimiento' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Vencimiento" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Calendar className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm">{moment(row.original.dueDate).format('DD/MM/YYYY')}</span>
        </div>
      ),
    },
    {
      accessorKey: 'cardName',
      meta: { title: 'Tarjeta' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tarjeta" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <CreditCard className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm">{row.original.cardName}</span>
        </div>
      ),
    },
    {
      accessorKey: 'ownerLabel',
      meta: { title: 'Titular' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Titular" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <User className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm">{row.original.ownerLabel}</span>
        </div>
      ),
    },
    {
      accessorKey: 'originFullNumber',
      meta: { title: 'Origen' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Origen" />,
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.originFullNumber}</span>
      ),
    },
    {
      accessorKey: 'number',
      meta: { title: 'Cuota' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Cuota" />,
      cell: ({ row }) => <span className="text-sm">{row.original.number}</span>,
    },
    {
      accessorKey: 'amount',
      meta: { title: 'Monto' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Monto" />,
      cell: ({ row }) => (
        <span className="font-medium tabular-nums">{formatCurrency(row.original.amount)}</span>
      ),
    },
    {
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <Badge variant={status === 'PAID' ? 'success' : 'secondary'}>
            {CARD_INSTALLMENT_STATUS_LABELS[status]}
          </Badge>
        );
      },
    },
  ];
}
