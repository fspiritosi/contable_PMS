'use client';

import type { ColumnDef } from '@tanstack/react-table';
import moment from 'moment';
import { ArrowDown, ArrowUp, CheckCircle2, Circle, Link2, Trash2 } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import { BANK_MOVEMENT_TYPE_LABELS } from '../../../shared/validators';
import { formatCurrency } from '@/shared/utils/formatters';

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
  receipt?: {
    id: string;
    fullNumber: string;
    date: Date;
    total: number;
    status: string;
    customer: { name: string };
  } | null;
  paymentOrder?: {
    id: string;
    fullNumber: string;
    date: Date;
    total: number;
    status: string;
    supplier: { businessName: string } | null;
    expenseDescription: string | null;
  } | null;
}

interface MovementColumnsProps {
  onToggleReconcile: (movement: BankMovement) => void;
  onDelete?: (movement: BankMovement) => void;
  isLoading: boolean;
  canReconcile?: boolean;
  canDelete?: boolean;
}

export function getMovementColumns({ onToggleReconcile, onDelete, isLoading, canReconcile = true, canDelete = false }: MovementColumnsProps): ColumnDef<BankMovement>[] {
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
        const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST', 'CHECK'].includes(type);

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
            <Popover>
              <PopoverTrigger asChild className="cursor-pointer">
                <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 cursor-pointer">
                  {receipt.fullNumber}
                </Badge>
              </PopoverTrigger>
              <PopoverContent className="w-64 text-sm">
                <div className="space-y-1">
                  <p className="font-semibold">Recibo de Cobro</p>
                  <p className="text-muted-foreground">{receipt.fullNumber}</p>
                  <div className="grid grid-cols-2 gap-1 pt-1">
                    <span className="text-muted-foreground">Cliente:</span>
                    <span className="font-medium">{receipt.customer?.name || '-'}</span>
                    <span className="text-muted-foreground">Fecha:</span>
                    <span>{moment(receipt.date).format('DD/MM/YYYY')}</span>
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-medium text-green-600">{formatCurrency(receipt.total)}</span>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          );
        }
        if (paymentOrder) {
          return (
            <Popover>
              <PopoverTrigger asChild className="cursor-pointer">
                <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 cursor-pointer">
                  {paymentOrder.fullNumber}
                </Badge>
              </PopoverTrigger>
              <PopoverContent className="w-72 text-sm">
                <div className="space-y-1">
                  <p className="font-semibold">Orden de Pago</p>
                  <p className="text-muted-foreground">{paymentOrder.fullNumber}</p>
                  <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 pt-1">
                    {paymentOrder.supplier?.businessName ? (
                      <>
                        <span className="text-muted-foreground">Proveedor:</span>
                        <span className="font-medium">{paymentOrder.supplier.businessName}</span>
                      </>
                    ) : paymentOrder.expenseDescription ? (
                      <>
                        <span className="text-muted-foreground">Concepto:</span>
                        <span className="font-medium">{paymentOrder.expenseDescription}</span>
                      </>
                    ) : null}
                    <span className="text-muted-foreground">Fecha:</span>
                    <span>{moment(paymentOrder.date).format('DD/MM/YYYY')}</span>
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-medium text-blue-600">{formatCurrency(paymentOrder.total)}</span>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
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
        const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST', 'CHECK'].includes(type);

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
    ...(canDelete && onDelete
      ? [
          {
            id: 'actions',
            meta: { title: 'Acciones' },
            cell: ({ row }: { row: { original: BankMovement } }) => {
              const movement = row.original;
              const isDeletable =
                !movement.reconciled &&
                !movement.receipt &&
                !movement.paymentOrder;

              if (!isDeletable) return null;

              return (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(movement)}
                  disabled={isLoading}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              );
            },
            enableSorting: false,
            enableHiding: false,
          } as ColumnDef<BankMovement>,
        ]
      : []),
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
        const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST', 'CHECK'].includes(type);

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
        const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST', 'CHECK'].includes(type);

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
