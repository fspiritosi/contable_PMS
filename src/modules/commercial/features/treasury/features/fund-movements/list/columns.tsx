'use client';

import { ColumnDef } from '@tanstack/react-table';
import moment from 'moment';

import { Badge } from '@/shared/components/ui/badge';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import { formatCurrency } from '@/shared/utils/formatters';
import { FUND_MOVEMENT_TYPE_LABELS, type FundMovementTypeValue } from '../shared/validators';
import type { FundMovementListItem } from './actions.server';

const TYPE_BADGE_VARIANT: Record<FundMovementTypeValue, 'default' | 'secondary' | 'outline'> = {
  PARTNER_CONTRIBUTION: 'default',
  PARTNER_WITHDRAWAL: 'secondary',
  ACCOUNT_TRANSFER: 'outline',
};

export function getColumns(): ColumnDef<FundMovementListItem>[] {
  return [
    {
      accessorKey: 'date',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{moment(row.original.date).format('DD/MM/YYYY')}</span>
      ),
    },
    {
      accessorKey: 'type',
      meta: { title: 'Tipo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      cell: ({ row }) => {
        const type = row.original.type as FundMovementTypeValue;
        return <Badge variant={TYPE_BADGE_VARIANT[type]}>{FUND_MOVEMENT_TYPE_LABELS[type]}</Badge>;
      },
    },
    {
      accessorKey: 'description',
      meta: { title: 'Descripción' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Descripción" />,
      cell: ({ row }) => <span className="text-sm">{row.original.description}</span>,
    },
    {
      id: 'origen',
      meta: { title: 'Origen' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Origen" />,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.sourceAccountLabel ?? '—'}</span>
      ),
    },
    {
      id: 'destino',
      meta: { title: 'Destino' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Destino" />,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.destinationAccountLabel ?? '—'}
        </span>
      ),
    },
    {
      id: 'socio',
      meta: { title: 'Socio' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Socio" />,
      cell: ({ row }) => <span className="text-sm">{row.original.partnerName ?? '—'}</span>,
    },
    {
      accessorKey: 'amount',
      meta: { title: 'Monto' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Monto" />,
      cell: ({ row }) => (
        <span className="font-medium whitespace-nowrap">{formatCurrency(row.original.amount)}</span>
      ),
    },
    {
      id: 'asiento',
      meta: { title: 'Asiento' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Asiento" />,
      cell: ({ row }) =>
        row.original.journalEntryNumber ? (
          <span className="font-mono text-xs">N° {row.original.journalEntryNumber}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
}
