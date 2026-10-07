'use client';

import { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

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
import type { ModulePermissions } from '@/shared/lib/permissions';
import { formatCurrency } from '@/shared/utils/formatters';
import {
  FUND_MOVEMENT_TYPE_LABELS,
  formatFundMovementDate,
  type FundMovementTypeValue,
} from '../shared/validators';
import {
  FUND_MOVEMENT_STATUS_LABELS,
  fundMovementStatusVariant,
  getRowActions,
  hasAnyRowAction,
  hasDraftActions,
} from '../shared/view-mode';
import type { FundMovementListItem } from './actions.server';

const TYPE_BADGE_VARIANT: Record<FundMovementTypeValue, 'default' | 'secondary' | 'outline'> = {
  PARTNER_CONTRIBUTION: 'default',
  PARTNER_WITHDRAWAL: 'secondary',
  ACCOUNT_TRANSFER: 'outline',
  BANK_CHARGES: 'secondary',
};

interface ColumnsProps {
  /** Abre el modal en solo lectura (cualquier estado, TSK-720a). */
  onView: (m: FundMovementListItem) => void;
  onEdit: (m: FundMovementListItem) => void;
  onConfirm: (m: FundMovementListItem) => void;
  onDelete: (m: FundMovementListItem) => void;
  permissions: ModulePermissions;
}

export function getColumns({ onView, onEdit, onConfirm, onDelete, permissions }: ColumnsProps): ColumnDef<FundMovementListItem>[] {
  const columns: ColumnDef<FundMovementListItem>[] = [
    {
      accessorKey: 'date',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{formatFundMovementDate(row.original.date)}</span>
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
        <span className="text-xs text-muted-foreground">{row.original.fundOutLabel ?? '—'}</span>
      ),
    },
    {
      id: 'destino',
      meta: { title: 'Destino' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Destino" />,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.fundInLabel ?? '—'}</span>
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
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <Badge variant={fundMovementStatusVariant(status)}>
            {FUND_MOVEMENT_STATUS_LABELS[status]}
          </Badge>
        );
      },
    },
  ];

  // "Ver" va en cualquier estado, así que la columna depende también de `canView`
  // (TSK-720a). El N° de asiento ya no tiene columna: se consulta en Ver.
  if (hasAnyRowAction(permissions)) {
    columns.push({
      id: 'actions',
      cell: ({ row }) => {
        const m = row.original;
        const actions = getRowActions(m.status, permissions);
        const draft = hasDraftActions(actions);
        if (!actions.view && !draft) return null;
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
              {actions.view && (
                <DropdownMenuItem onClick={() => onView(m)}>
                  <Eye className="mr-2 h-4 w-4" />
                  Ver
                </DropdownMenuItem>
              )}
              {actions.view && draft && <DropdownMenuSeparator />}
              {actions.confirm && (
                <DropdownMenuItem onClick={() => onConfirm(m)}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Confirmar
                </DropdownMenuItem>
              )}
              {actions.edit && (
                <DropdownMenuItem onClick={() => onEdit(m)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {actions.delete && (
                <>
                  {(actions.confirm || actions.edit) && <DropdownMenuSeparator />}
                  <DropdownMenuItem onClick={() => onDelete(m)} className="text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
  }

  return columns;
}
