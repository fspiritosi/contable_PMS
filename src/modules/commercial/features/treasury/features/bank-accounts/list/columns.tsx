'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, Power, PowerOff, Lock, ArrowLeftRight } from 'lucide-react';
import Link from 'next/link';

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
import type { BankAccountWithBalance } from '../../../shared/types';
import {
  BANK_ACCOUNT_TYPE_LABELS,
  BANK_ACCOUNT_STATUS_LABELS,
  BANK_ACCOUNT_STATUS_BADGES,
} from '../../../shared/validators';

interface ColumnsProps {
  onEdit: (account: BankAccountWithBalance) => void;
  onToggleStatus: (account: BankAccountWithBalance) => void;
  onClose: (account: BankAccountWithBalance) => void;
  isLoading: boolean;
  canEdit?: boolean;
  canToggleStatus?: boolean;
  canClose?: boolean;
}

export function getColumns({ onEdit, onToggleStatus, onClose, isLoading, canEdit = true, canToggleStatus = true, canClose = true }: ColumnsProps): ColumnDef<BankAccountWithBalance>[] {
  return [
    {
      accessorKey: 'bankName',
      meta: { title: 'Banco' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Banco" />,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.bankName}</p>
          <p className="text-sm text-muted-foreground">
            {BANK_ACCOUNT_TYPE_LABELS[row.original.accountType]}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'accountNumber',
      meta: { title: 'Número de Cuenta' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Número de Cuenta" />,
      cell: ({ row }) => (
        <div>
          <p className="font-mono">{row.original.accountNumber}</p>
          {row.original.alias && (
            <p className="text-sm text-muted-foreground">{row.original.alias}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'cbu',
      meta: { title: 'CBU' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="CBU" />,
      cell: ({ row }) => {
        return row.original.cbu ? (
          <span className="font-mono text-sm">{row.original.cbu}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      accessorKey: 'balance',
      meta: { title: 'Saldo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Saldo" />,
      cell: ({ row }) => {
        const balance = row.original.balance;
        const isNegative = balance < 0;
        return (
          <div className={`text-right font-semibold ${isNegative ? 'text-red-600' : ''}`}>
            ${balance.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        );
      },
    },
    {
      accessorKey: 'accountType',
      meta: { title: 'Tipo de Cuenta' },
      header: 'Tipo de Cuenta',
      enableHiding: false,
      enableSorting: false,
      cell: () => null,
    },
    {
      accessorKey: 'currency',
      meta: { title: 'Moneda' },
      header: 'Moneda',
      enableHiding: false,
      enableSorting: false,
      cell: () => null,
    },
    {
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => (
        <Badge variant={BANK_ACCOUNT_STATUS_BADGES[row.original.status]}>
          {BANK_ACCOUNT_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const account = row.original;
        const isActive = account.status === 'ACTIVE';
        const isClosed = account.status === 'CLOSED';

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

              {!isClosed && (
                <>
                  {canEdit && (
                    <DropdownMenuItem onClick={() => onEdit(account)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Editar
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuItem asChild>
                    <Link href={`/dashboard/commercial/treasury/bank-accounts/${account.id}`}>
                      <ArrowLeftRight className="mr-2 h-4 w-4" />
                      Ver Movimientos
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {canToggleStatus && (
                    <DropdownMenuItem onClick={() => onToggleStatus(account)} disabled={isLoading}>
                      {isActive ? (
                        <>
                          <PowerOff className="mr-2 h-4 w-4" />
                          Desactivar
                        </>
                      ) : (
                        <>
                          <Power className="mr-2 h-4 w-4" />
                          Activar
                        </>
                      )}
                    </DropdownMenuItem>
                  )}

                  {canClose && account.balance === 0 && (
                    <DropdownMenuItem onClick={() => onClose(account)} disabled={isLoading}>
                      <Lock className="mr-2 h-4 w-4" />
                      Cerrar Cuenta
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
