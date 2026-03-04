'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Eye, Edit, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import moment from 'moment';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import { EXPENSE_STATUS_LABELS } from '../validators';

export type ExpenseListItem = {
  id: string;
  number: number;
  fullNumber: string;
  description: string;
  amount: number;
  date: Date;
  dueDate: Date | null;
  status: string;
  createdAt: Date;
  category: { id: string; name: string };
  supplier: { id: string; businessName: string; tradeName: string | null } | null;
  _count: { attachments: number; paymentOrderItems: number };
} & Record<string, unknown>;

type ExpenseStatus = keyof typeof EXPENSE_STATUS_LABELS;

type BadgeVariant = 'secondary' | 'default' | 'outline' | 'destructive';

const STATUS_BADGE_VARIANTS: Record<string, BadgeVariant> = {
  DRAFT: 'secondary',
  CONFIRMED: 'default',
  PARTIAL_PAID: 'outline',
  PAID: 'default',
  CANCELLED: 'destructive',
};

interface ColumnsProps {
  onViewDetail: (expense: ExpenseListItem) => void;
  onEdit?: (expense: ExpenseListItem) => void;
  onConfirm?: (expense: ExpenseListItem) => void;
  onCancel?: (expense: ExpenseListItem) => void;
  onDelete?: (expense: ExpenseListItem) => void;
}

export function getColumns({ onViewDetail, onEdit, onConfirm, onCancel, onDelete }: ColumnsProps): ColumnDef<ExpenseListItem>[] {
  return [
    {
      accessorKey: 'fullNumber',
      meta: { title: 'Número' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Número" />,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.fullNumber}</span>
      ),
    },
    {
      accessorKey: 'description',
      meta: { title: 'Descripción' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Descripción" />,
      cell: ({ row }) => (
        <span className="max-w-[200px] truncate block" title={row.original.description}>
          {row.original.description}
        </span>
      ),
    },
    {
      accessorKey: 'category.name',
      meta: { title: 'Categoría' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Categoría" />,
      cell: ({ row }) => row.original.category.name,
    },
    {
      accessorKey: 'supplier',
      meta: { title: 'Proveedor' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Proveedor" />,
      cell: ({ row }) => {
        const supplier = row.original.supplier;
        if (!supplier) return <span className="text-muted-foreground">-</span>;
        return supplier.tradeName || supplier.businessName;
      },
    },
    {
      accessorKey: 'date',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => moment(row.original.date).format('DD/MM/YYYY'),
    },
    {
      accessorKey: 'dueDate',
      meta: { title: 'Vencimiento' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Vencimiento" />,
      cell: ({ row }) => {
        const { dueDate, status } = row.original;
        if (!dueDate) return <span className="text-muted-foreground">-</span>;

        const isOverdue =
          status !== 'PAID' &&
          status !== 'CANCELLED' &&
          moment(dueDate).isBefore(moment(), 'day');

        return (
          <span className={isOverdue ? 'text-red-600 font-medium' : undefined}>
            {moment(dueDate).format('DD/MM/YYYY')}
          </span>
        );
      },
    },
    {
      accessorKey: 'amount',
      meta: { title: 'Monto' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Monto" />,
      cell: ({ row }) => (
        <span className="font-medium text-right block">
          ${row.original.amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const status = row.original.status as ExpenseStatus;
        const isPaid = status === 'PAID';

        return (
          <Badge
            variant={STATUS_BADGE_VARIANTS[status] ?? 'default'}
            className={isPaid ? 'bg-green-600 hover:bg-green-700 text-white' : undefined}
          >
            {EXPENSE_STATUS_LABELS[status] ?? status}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const expense = row.original;
        const isDraft = expense.status === 'DRAFT';
        const canCancel = expense.status === 'DRAFT' || expense.status === 'CONFIRMED';

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onViewDetail(expense)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver Detalle
              </DropdownMenuItem>

              {isDraft && onEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onEdit(expense)}>
                    <Edit className="mr-2 h-4 w-4" />
                    Editar
                  </DropdownMenuItem>
                </>
              )}

              {isDraft && onConfirm && (
                <DropdownMenuItem onClick={() => onConfirm(expense)}>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Confirmar
                </DropdownMenuItem>
              )}

              {canCancel && onCancel && !isDraft && (
                <DropdownMenuSeparator />
              )}

              {canCancel && onCancel && (
                <DropdownMenuItem onClick={() => onCancel(expense)} className="text-destructive">
                  <XCircle className="mr-2 h-4 w-4" />
                  Cancelar
                </DropdownMenuItem>
              )}

              {isDraft && onDelete && (
                <DropdownMenuItem onClick={() => onDelete(expense)} className="text-destructive">
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
