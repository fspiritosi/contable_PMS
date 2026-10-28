'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';

import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
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
import { formatCurrency, formatDateUtc } from '@/shared/utils/formatters';

import { HOLDING_STATUS_LABELS, INSTRUMENT_TYPE_LABELS } from '../shared/types';
import type { InvestmentHoldingRow } from './actions.server';

interface ColumnsProps {
  canUpdate: boolean;
  canDelete: boolean;
  /** Oculta la columna de custodia cuando la tabla ya está acotada a una cuenta. */
  hideBankAccount?: boolean;
  onEdit: (holding: InvestmentHoldingRow) => void;
  onDelete: (holding: InvestmentHoldingRow) => void;
}

const formatNominals = (value: number | null) =>
  value === null ? '—' : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 6 }).format(value);

export function getColumns({
  canUpdate,
  canDelete,
  hideBankAccount,
  onEdit,
  onDelete,
}: ColumnsProps): ColumnDef<InvestmentHoldingRow>[] {
  const columns: ColumnDef<InvestmentHoldingRow>[] = [
    {
      accessorKey: 'name',
      meta: { title: 'Tenencia' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tenencia" />,
      cell: ({ row }) => (
        <Link
          href={`/dashboard/commercial/treasury/investments/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'instrumentType',
      meta: { title: 'Tipo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      cell: ({ row }) => (
        <span className="text-sm">{INSTRUMENT_TYPE_LABELS[row.original.instrumentType]}</span>
      ),
    },
  ];

  if (!hideBankAccount) {
    columns.push({
      accessorKey: 'bankAccountLabel',
      meta: { title: 'Banco / broker' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Banco / broker" />,
      cell: ({ row }) => <span className="text-sm">{row.original.bankAccountLabel}</span>,
    });
  }

  columns.push(
    {
      accessorKey: 'maturityDate',
      meta: { title: 'Vencimiento' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Vencimiento" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm">
          {formatDateUtc(row.original.maturityDate, '—')}
        </span>
      ),
    },
    {
      accessorKey: 'nominals',
      meta: { title: 'Nominales' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nominales" />,
      cell: ({ row }) => <span className="text-sm">{formatNominals(row.original.nominals)}</span>,
    },
    {
      accessorKey: 'bookValue',
      meta: { title: 'Valor en libros' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Valor en libros" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-medium">
          {formatCurrency(row.original.bookValue)}
        </span>
      ),
    },
    {
      accessorKey: 'averagePrice',
      meta: { title: 'Precio promedio' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Precio promedio" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm">
          {row.original.averagePrice === null ? '—' : formatCurrency(row.original.averagePrice)}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'OPEN' ? 'default' : 'secondary'}>
          {HOLDING_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Abrir menú</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Acciones</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/commercial/treasury/investments/${row.original.id}`}>
                <Eye className="mr-2 h-4 w-4" />
                Ver detalle
              </Link>
            </DropdownMenuItem>
            {(canUpdate || canDelete) && <DropdownMenuSeparator />}
            {canUpdate && (
              <DropdownMenuItem onClick={() => onEdit(row.original)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem className="text-destructive" onClick={() => onDelete(row.original)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }
  );

  return columns;
}
