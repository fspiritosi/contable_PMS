'use client';

import type { ColumnDef } from '@tanstack/react-table';
import moment from 'moment';
import { ArrowDown, ArrowUp, CheckCircle2, Circle, Link2 } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import { BANK_MOVEMENT_TYPE_LABELS } from '../../../shared/validators';

interface BankMovement extends Record<string, unknown> {
  id: string;
  type: string;
  amount: number;
  date: Date;
  description: string;
  reference: string | null;
  statementNumber: string | null;
  reconciled: boolean;
  reconciledAt: Date | null;
  createdAt: Date;
  receipt?: { id: string; fullNumber: string } | null;
  paymentOrder?: { id: string; fullNumber: string } | null;
}

interface MovementColumnsProps {
  onToggleReconcile: (movement: BankMovement) => void;
  isLoading: boolean;
  canReconcile?: boolean;
}

export function getMovementColumns({ onToggleReconcile, isLoading, canReconcile = true }: MovementColumnsProps): ColumnDef<BankMovement>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Seleccionar todos"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Seleccionar fila"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'date',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {moment(row.original.date).format('DD/MM/YYYY')}
          </span>
          {/* <span className="text-xs text-muted-foreground">
            {moment(row.original.date).format('HH:mm')}
          </span> */}
        </div>
      ),
    },
    {
      accessorKey: 'type',
      meta: { title: 'Tipo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      cell: ({ row }) => {
        const type = row.original.type;
        const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST'].includes(type);

        return (
          <div className="flex items-center gap-2">
            {isIncome ? (
              <ArrowDown className="h-4 w-4 text-green-600" />
            ) : (
              <ArrowUp className="h-4 w-4 text-red-600" />
            )}
            <Badge variant="outline">
              {BANK_MOVEMENT_TYPE_LABELS[type as keyof typeof BANK_MOVEMENT_TYPE_LABELS] || type}
            </Badge>
          </div>
        );
      },
    },
    {
      accessorKey: 'description',
      meta: { title: 'Descripción' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Descripción" />,
      cell: ({ row }) => (
        <div className="max-w-[300px]">
          <p className="truncate">{row.original.description}</p>
          {row.original.reference && (
            <p className="text-xs text-muted-foreground">
              Ref: {row.original.reference}
            </p>
          )}
          {row.original.statementNumber && (
            <p className="text-xs text-muted-foreground">
              Extracto: {row.original.statementNumber}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'document',
      meta: { title: 'Documento' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Documento" />,
      cell: ({ row }) => {
        const { receipt, paymentOrder } = row.original;
        if (receipt) {
          return (
            <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">
              {receipt.fullNumber}
            </Badge>
          );
        }
        if (paymentOrder) {
          return (
            <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50">
              {paymentOrder.fullNumber}
            </Badge>
          );
        }
        return null;
      },
      enableSorting: false,
    },
    {
      accessorKey: 'amount',
      meta: { title: 'Monto' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Monto" />,
      cell: ({ row }) => {
        const type = row.original.type;
        const amount = row.original.amount;
        const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST'].includes(type);

        return (
          <div className={`font-semibold ${isIncome ? 'text-green-600' : 'text-red-600'}`}>
            {isIncome ? '+' : '-'} ${Math.abs(amount).toLocaleString('es-AR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        );
      },
    },
    {
      accessorKey: 'reconciled',
      meta: { title: 'Conciliado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Conciliado" />,
      cell: ({ row }) => {
        const reconciled = row.original.reconciled;
        const reconciledAt = row.original.reconciledAt;

        return (
          <button
            type="button"
            className="flex items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity disabled:opacity-50"
            onClick={() => canReconcile ? onToggleReconcile(row.original) : undefined}
            disabled={isLoading || !canReconcile}
          >
            {reconciled ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <div className="flex flex-col">
                  <span className="text-sm">Conciliado</span>
                  {reconciledAt && (
                    <span className="text-xs text-muted-foreground">
                      {moment(reconciledAt).format('DD/MM/YYYY')}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <Circle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Pendiente</span>
              </>
            )}
          </button>
        );
      },
    },
  ];
}

interface ReconciliationColumnsProps {
  onLink: (movement: BankMovement) => void;
}

export function getReconciliationColumns({ onLink }: ReconciliationColumnsProps): ColumnDef<BankMovement>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Seleccionar todos"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Seleccionar fila"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'date',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {moment(row.original.date).format('DD/MM/YYYY')}
          </span>
          <span className="text-xs text-muted-foreground">
            {moment(row.original.date).format('HH:mm')}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'type',
      meta: { title: 'Tipo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      cell: ({ row }) => {
        const type = row.original.type;
        const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST'].includes(type);

        return (
          <div className="flex items-center gap-2">
            {isIncome ? (
              <ArrowDown className="h-4 w-4 text-green-600" />
            ) : (
              <ArrowUp className="h-4 w-4 text-red-600" />
            )}
            <Badge variant="outline">
              {BANK_MOVEMENT_TYPE_LABELS[type as keyof typeof BANK_MOVEMENT_TYPE_LABELS] || type}
            </Badge>
          </div>
        );
      },
    },
    {
      accessorKey: 'description',
      meta: { title: 'Descripción' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Descripción" />,
      cell: ({ row }) => (
        <div className="max-w-[300px]">
          <p className="truncate">{row.original.description}</p>
          {row.original.reference && (
            <p className="text-xs text-muted-foreground">
              Ref: {row.original.reference}
            </p>
          )}
          {row.original.statementNumber && (
            <p className="text-xs text-muted-foreground">
              Extracto: {row.original.statementNumber}
            </p>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'amount',
      meta: { title: 'Monto' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Monto" />,
      cell: ({ row }) => {
        const type = row.original.type;
        const amount = row.original.amount;
        const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST'].includes(type);

        return (
          <div className={`text-right font-semibold ${isIncome ? 'text-green-600' : 'text-red-600'}`}>
            {isIncome ? '+' : '-'}${Math.abs(amount).toLocaleString('es-AR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        );
      },
    },
    {
      id: 'actions',
      meta: { title: 'Acciones' },
      cell: ({ row }) => {
        const type = row.original.type;
        const canLink = ['DEPOSIT', 'TRANSFER_IN', 'TRANSFER_OUT', 'CHECK'].includes(type);

        if (!canLink) return null;

        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onLink(row.original)}
          >
            <Link2 className="mr-1 h-3.5 w-3.5" />
            Vincular
          </Button>
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
  ];
}
