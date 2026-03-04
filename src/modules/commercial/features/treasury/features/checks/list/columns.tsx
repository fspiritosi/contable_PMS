'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { MoreHorizontal, Eye, Landmark, ArrowRightLeft, Ban, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import moment from 'moment';
import type { CheckListItem } from '../../../shared/types';
import {
  CHECK_TYPE_LABELS,
  CHECK_STATUS_LABELS,
  CHECK_STATUS_BADGES,
} from '../../../shared/validators';

interface ColumnsProps {
  onView: (check: CheckListItem) => void;
  onDeposit: (check: CheckListItem) => void;
  onEndorse: (check: CheckListItem) => void;
  onVoid: (check: CheckListItem) => void;
  onDelete: (check: CheckListItem) => void;
  canDeposit?: boolean;
  canEndorse?: boolean;
  canVoid?: boolean;
  canDelete?: boolean;
}

export function getColumns({
  onView,
  onDeposit,
  onEndorse,
  onVoid,
  onDelete,
  canDeposit = true,
  canEndorse = true,
  canVoid = true,
  canDelete: canDeleteProp = true,
}: ColumnsProps): ColumnDef<CheckListItem>[] {
  return [
    {
      accessorKey: 'checkNumber',
      header: 'Número',
      meta: { title: 'Número' },
    },
    {
      accessorKey: 'type',
      header: 'Tipo',
      meta: { title: 'Tipo' },
      cell: ({ row }) => CHECK_TYPE_LABELS[row.original.type],
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      meta: { title: 'Estado' },
      cell: ({ row }) => (
        <Badge variant={CHECK_STATUS_BADGES[row.original.status]}>
          {CHECK_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: 'bankName',
      header: 'Banco',
      meta: { title: 'Banco' },
    },
    {
      accessorKey: 'drawerName',
      header: 'Librador',
      meta: { title: 'Librador' },
    },
    {
      accessorKey: 'amount',
      header: 'Monto',
      meta: { title: 'Monto' },
      cell: ({ row }) => (
        <span className="font-medium">{formatCurrency(row.original.amount)}</span>
      ),
    },
    {
      accessorKey: 'issueDate',
      header: 'Emisión',
      meta: { title: 'Emisión' },
      cell: ({ row }) => moment(row.original.issueDate).format('DD/MM/YYYY'),
    },
    {
      accessorKey: 'dueDate',
      header: 'Vencimiento',
      meta: { title: 'Vencimiento' },
      cell: ({ row }) => {
        const dueDate = moment(row.original.dueDate);
        const isOverdue = dueDate.isBefore(moment(), 'day') &&
          ['PORTFOLIO', 'DEPOSITED', 'DELIVERED'].includes(row.original.status);
        return (
          <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
            {dueDate.format('DD/MM/YYYY')}
          </span>
        );
      },
    },
    {
      id: 'actions',
      meta: { title: 'Acciones' },
      cell: ({ row }) => {
        const check = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onView(check)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver Detalle
              </DropdownMenuItem>
              {check.type === 'THIRD_PARTY' && check.status === 'PORTFOLIO' && (
                <>
                  {canDeposit && (
                    <DropdownMenuItem onClick={() => onDeposit(check)}>
                      <Landmark className="mr-2 h-4 w-4" />
                      Depositar
                    </DropdownMenuItem>
                  )}
                  {canEndorse && (
                    <DropdownMenuItem onClick={() => onEndorse(check)}>
                      <ArrowRightLeft className="mr-2 h-4 w-4" />
                      Endosar
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {canVoid && !['CLEARED', 'CASHED', 'VOIDED'].includes(check.status) && (
                <DropdownMenuItem onClick={() => onVoid(check)} className="text-destructive">
                  <Ban className="mr-2 h-4 w-4" />
                  Anular
                </DropdownMenuItem>
              )}
              {canDeleteProp && ['PORTFOLIO', 'DELIVERED'].includes(check.status) && (
                <DropdownMenuItem onClick={() => onDelete(check)} className="text-destructive">
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
