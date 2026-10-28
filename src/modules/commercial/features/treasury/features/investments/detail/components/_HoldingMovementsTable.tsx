'use client';

import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo } from 'react';

import { DataTable, DataTableColumnHeader } from '@/shared/components/common/DataTable';
import { Badge } from '@/shared/components/ui/badge';
import { formatCurrency, formatDateUtc } from '@/shared/utils/formatters';

import type { HoldingMovementRow } from '../../list/actions.server';

const KIND_LABELS: Record<HoldingMovementRow['kind'], string> = {
  PURCHASE: 'Compra',
  SALE: 'Venta',
  VALUATION: 'Valuación',
};

const KIND_VARIANT: Record<HoldingMovementRow['kind'], 'default' | 'secondary' | 'outline'> = {
  PURCHASE: 'default',
  SALE: 'secondary',
  VALUATION: 'outline',
};

const signed = (value: number) => `${value > 0 ? '+' : ''}${formatCurrency(value)}`;

function ValuationOrigin({ hasValuation }: { hasValuation: boolean }) {
  if (!hasValuation) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <Link
      href="/dashboard/commercial/treasury/investments/valuation"
      className="text-sm hover:underline"
    >
      Valuación al cierre
    </Link>
  );
}

export function _HoldingMovementsTable({ data }: { data: HoldingMovementRow[] }) {
  const columns = useMemo<ColumnDef<HoldingMovementRow>[]>(
    () => [
      {
        accessorKey: 'date',
        meta: { title: 'Fecha' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDateUtc(row.original.date)}</span>
        ),
      },
      {
        accessorKey: 'kind',
        meta: { title: 'Clase' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Clase" />,
        cell: ({ row }) => (
          <Badge variant={KIND_VARIANT[row.original.kind]}>{KIND_LABELS[row.original.kind]}</Badge>
        ),
      },
      {
        accessorKey: 'amount',
        meta: { title: 'Importe' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Importe" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-medium">{signed(row.original.amount)}</span>
        ),
      },
      {
        accessorKey: 'nominals',
        meta: { title: 'Nominales' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nominales" />,
        cell: ({ row }) => {
          const n = row.original.nominals;
          return <span className="text-sm">{n === null ? '—' : `${n > 0 ? '+' : ''}${n}`}</span>;
        },
      },
      {
        accessorKey: 'result',
        meta: { title: 'Resultado' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Resultado" />,
        cell: ({ row }) => {
          const r = row.original.result;
          if (r === null) return <span className="text-muted-foreground">—</span>;
          return <span className={r < 0 ? 'text-destructive' : ''}>{signed(r)}</span>;
        },
      },
      {
        id: 'origen',
        meta: { title: 'Origen' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Origen" />,
        cell: ({ row }) =>
          row.original.fundMovementId ? (
            <Link
              href="/dashboard/commercial/treasury/fund-movements"
              className="text-sm hover:underline"
            >
              Movimiento de fondos
            </Link>
          ) : (
            <ValuationOrigin hasValuation={!!row.original.valuationId} />
          ),
      },
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      totalRows={data.length}
      searchParams={{ pageSize: '100' }}
      showSearch={false}
      tableId="commercial-holding-movements"
    />
  );
}
