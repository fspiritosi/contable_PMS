'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import moment from 'moment';
import { Wallet, TrendingDown, TrendingUp, CreditCard, Undo2 } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { ClientDataTable } from '@/shared/components/common/ClientDataTable';
import { formatCurrency } from '@/shared/utils/formatters';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { PartnerMovementType } from '@/generated/prisma/enums';
import {
  PARTNER_MOVEMENT_TYPE_LABELS,
  PARTNER_MOVEMENT_TYPE_SIGN,
  type PartnerAccountStatement,
  type PartnerInstallment,
  type PartnerMovement,
} from '../../../shared/types';
import { getPartnerAccountStatement } from '../actions.server';
import { _PartnerMovementDialog } from './_PartnerMovementDialog';
import { _PartnerRepaymentDialog } from './_PartnerRepaymentDialog';

interface PartnerAccountTabProps {
  partnerId: string;
  partnerName?: string;
  initialStatement: PartnerAccountStatement;
}

export function _PartnerAccountTab({ partnerId, partnerName, initialStatement }: PartnerAccountTabProps) {
  const { hasPermission } = usePermissions();
  const canRegister = hasPermission('commercial.treasury.partners', 'update');
  const canRepay = hasPermission('commercial.treasury.payment-orders', 'create');
  const [repayOpen, setRepayOpen] = useState(false);

  const { data: statement } = useQuery({
    queryKey: ['partner-account', partnerId],
    queryFn: () => getPartnerAccountStatement(partnerId),
    initialData: initialStatement,
  });

  const { movements, installments, balance, pendingInstallments, totalOwed, totalRepayment } = statement;
  const hasPendingInstallments = installments.some((i) => i.status === 'PENDING');

  const columns = useMemo<ColumnDef<PartnerMovement>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Fecha',
        meta: { title: 'Fecha' },
        cell: ({ row }) => moment(row.original.date).format('DD/MM/YYYY'),
      },
      {
        accessorKey: 'type',
        header: 'Tipo',
        meta: { title: 'Tipo' },
        cell: ({ row }) => {
          const type = row.original.type;
          const variant =
            type === PartnerMovementType.REPAYMENT
              ? 'default'
              : type === PartnerMovementType.OWED
              ? 'secondary'
              : 'outline';
          return <Badge variant={variant}>{PARTNER_MOVEMENT_TYPE_LABELS[type]}</Badge>;
        },
      },
      {
        accessorKey: 'description',
        header: 'Descripción',
        meta: { title: 'Descripción' },
        cell: ({ row }) => (
          <span className="text-sm">{row.original.description}</span>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Monto',
        meta: { title: 'Monto' },
        cell: ({ row }) => {
          const movement = row.original;
          const sign = PARTNER_MOVEMENT_TYPE_SIGN[movement.type];
          // sign +1 => suma deuda a favor del socio (rojo para la empresa)
          // sign -1 => resta deuda (devolución, verde)
          const colorClass = sign > 0 ? 'text-red-600' : 'text-green-600';
          const prefix = sign > 0 ? '+' : '-';
          return (
            <div className={`text-right font-medium ${colorClass}`}>
              {prefix}
              {formatCurrency(movement.amount)}
            </div>
          );
        },
      },
    ],
    []
  );

  const installmentColumns = useMemo<ColumnDef<PartnerInstallment>[]>(
    () => [
      {
        accessorKey: 'dueDate',
        header: 'Vencimiento',
        meta: { title: 'Vencimiento' },
        cell: ({ row }) => moment(row.original.dueDate).format('DD/MM/YYYY'),
      },
      {
        accessorKey: 'cardName',
        header: 'Tarjeta',
        meta: { title: 'Tarjeta' },
        cell: ({ row }) => <span className="text-sm">{row.original.cardName || '—'}</span>,
      },
      {
        accessorKey: 'originFullNumber',
        header: 'Origen',
        meta: { title: 'Origen' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.originFullNumber}</span>
        ),
      },
      {
        accessorKey: 'number',
        header: 'Cuota',
        meta: { title: 'Cuota' },
        cell: ({ row }) => <span className="text-sm">{row.original.number}</span>,
      },
      {
        accessorKey: 'amount',
        header: 'Monto',
        meta: { title: 'Monto' },
        cell: ({ row }) => (
          <div className="text-right font-medium">{formatCurrency(row.original.amount)}</div>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Estado',
        meta: { title: 'Estado' },
        cell: ({ row }) => {
          const { status, settledByFullNumber } = row.original;
          if (status === 'PAID') {
            return (
              <div className="flex flex-col gap-0.5">
                <Badge variant="default" className="w-fit">Pagada</Badge>
                {settledByFullNumber && (
                  <span className="text-xs text-muted-foreground">{settledByFullNumber}</span>
                )}
              </div>
            );
          }
          return <Badge variant="secondary">Pendiente</Badge>;
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      {/* Resumen */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo a favor del socio</CardTitle>
            <Wallet
              className={`h-4 w-4 ${balance > 0 ? 'text-red-600' : 'text-muted-foreground'}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                balance > 0 ? 'text-red-600' : 'text-muted-foreground'
              }`}
            >
              {formatCurrency(balance)}
            </div>
            <p className="text-xs text-muted-foreground">
              {balance > 0
                ? 'La empresa le debe al socio'
                : 'Sin saldo pendiente con el socio'}
            </p>
            {pendingInstallments > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Cuotas pendientes: {formatCurrency(pendingInstallments)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deuda generada</CardTitle>
            <TrendingUp className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalOwed)}</div>
            <p className="text-xs text-muted-foreground">Pagos con tarjeta del socio</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Devuelto</CardTitle>
            <TrendingDown className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(totalRepayment)}
            </div>
            <p className="text-xs text-muted-foreground">Devoluciones al socio</p>
          </CardContent>
        </Card>
      </div>

      {/* Cuotas (deuda por tarjetas) */}
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Cuotas (deuda por tarjetas)
            </CardTitle>
            <CardDescription>
              Cuotas que la empresa le debe al socio por pagos con su tarjeta
            </CardDescription>
          </div>
          {canRepay && hasPendingInstallments && (
            <Button onClick={() => setRepayOpen(true)}>
              <Undo2 className="mr-2 h-4 w-4" />
              Devolver / Pagar al socio
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {installments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay cuotas registradas</p>
          ) : (
            <ClientDataTable
              columns={installmentColumns}
              data={installments}
              searchPlaceholder="Buscar cuotas..."
              tableId="commercial-treasury-partner-installments"
            />
          )}
        </CardContent>
      </Card>

      {canRepay && (
        <_PartnerRepaymentDialog
          partnerId={partnerId}
          partnerName={partnerName}
          open={repayOpen}
          onOpenChange={setRepayOpen}
        />
      )}

      {/* Movimientos */}
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Movimientos</CardTitle>
            <CardDescription>
              Detalle de la cuenta corriente del socio
            </CardDescription>
          </div>
          {canRegister && <_PartnerMovementDialog partnerId={partnerId} />}
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay movimientos registrados</p>
          ) : (
            <ClientDataTable
              columns={columns}
              data={movements}
              searchPlaceholder="Buscar movimientos..."
              tableId="commercial-treasury-partner-movements"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
