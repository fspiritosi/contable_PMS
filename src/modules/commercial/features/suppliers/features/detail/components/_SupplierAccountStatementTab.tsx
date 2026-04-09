'use client';

import { useState } from 'react';
import moment from 'moment';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { DataTable } from '@/shared/components/common/DataTable';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { DollarSign, TrendingDown, TrendingUp } from 'lucide-react';
import type { SupplierAccountStatement, SupplierInvoiceWithBalance, SupplierPayment } from '../actions.server';
import { isCreditNote } from '@/modules/commercial/shared/voucher-utils';

interface SupplierAccountStatementTabProps {
  accountStatement: SupplierAccountStatement;
}

const VOUCHER_TYPE_LABELS: Record<string, string> = {
  FACTURA_A: 'Factura A',
  FACTURA_B: 'Factura B',
  FACTURA_C: 'Factura C',
  FACTURA_X: 'Factura X',
  NOTA_DEBITO_A: 'ND A',
  NOTA_DEBITO_B: 'ND B',
  NOTA_DEBITO_C: 'ND C',
  NOTA_CREDITO_A: 'NC A',
  NOTA_CREDITO_B: 'NC B',
  NOTA_CREDITO_C: 'NC C',
};

export function _SupplierAccountStatementTab({ accountStatement }: SupplierAccountStatementTabProps) {
  const { invoices, payments, summary } = accountStatement;
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [selectedPayments, setSelectedPayments] = useState<string[]>([]);

  // Columnas para facturas de compra
  const invoiceColumns: ColumnDef<SupplierInvoiceWithBalance>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Seleccionar todas"
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
      accessorKey: 'fullNumber',
      header: 'Número',
      meta: { title: 'Número' },
      cell: ({ row }) => (
        <Link
          href={`/dashboard/commercial/purchases/${row.original.id}`}
          target="_blank"
          className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
        >
          {row.original.fullNumber}
        </Link>
      ),
    },
    {
      accessorKey: 'voucherType',
      header: 'Tipo',
      meta: { title: 'Tipo' },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {VOUCHER_TYPE_LABELS[row.original.voucherType] || row.original.voucherType}
        </span>
      ),
    },
    {
      accessorKey: 'issueDate',
      header: 'Fecha Emisión',
      meta: { title: 'Fecha Emisión' },
      cell: ({ row }) => moment(row.original.issueDate).format('DD/MM/YYYY'),
    },
    {
      accessorKey: 'dueDate',
      header: 'Vencimiento',
      meta: { title: 'Vencimiento' },
      cell: ({ row }) => {
        const invoice = row.original;
        const isOverdue =
          invoice.balance > 0 &&
          invoice.dueDate &&
          moment(invoice.dueDate).isBefore(moment(), 'day');

        return invoice.dueDate ? (
          <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
            {moment(invoice.dueDate).format('DD/MM/YYYY')}
          </span>
        ) : (
          '-'
        );
      },
    },
    {
      accessorKey: 'total',
      header: 'Total',
      meta: { title: 'Total' },
      cell: ({ row }) => {
        const isNC = isCreditNote(row.original.voucherType);
        return (
          <div className={`text-right font-medium ${isNC ? 'text-green-600' : ''}`}>
            {isNC ? '-' : ''}${row.original.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
          </div>
        );
      },
    },
    {
      accessorKey: 'paid',
      header: 'Pagado',
      meta: { title: 'Pagado' },
      cell: ({ row }) => (
        <div className="text-right text-green-600">
          ${row.original.paid.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
        </div>
      ),
    },
    {
      accessorKey: 'balance',
      header: 'Saldo',
      meta: { title: 'Saldo' },
      cell: ({ row }) => {
        const balance = row.original.balance;
        const colorClass = balance < 0 ? 'text-green-600 font-medium' : balance > 0 ? 'text-red-600 font-medium' : 'text-muted-foreground';
        return (
          <div className="text-right">
            <span className={colorClass}>
              ${balance.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      meta: { title: 'Estado' },
      cell: ({ row }) => {
        const invoice = row.original;
        const isNC = isCreditNote(invoice.voucherType);

        if (isNC) {
          const isFullyApplied = invoice.balance >= -0.01;
          return isFullyApplied
            ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Aplicada</Badge>
            : <Badge variant="secondary">Sin aplicar</Badge>;
        }

        const isOverdue =
          invoice.balance > 0 &&
          invoice.dueDate &&
          moment(invoice.dueDate).isBefore(moment(), 'day');
        const isPaid = invoice.balance <= 0.01;

        if (isPaid) {
          return <Badge variant="default">Pagada</Badge>;
        }
        if (isOverdue) {
          return <Badge variant="destructive">Vencida</Badge>;
        }
        return <Badge variant="secondary">Pendiente</Badge>;
      },
    },
  ];

  // Columnas para órdenes de pago
  const paymentColumns: ColumnDef<SupplierPayment>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Seleccionar todas"
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
      accessorKey: 'fullNumber',
      header: 'Número',
      meta: { title: 'Número' },
      cell: ({ row }) => (
        <div className="font-medium">{row.original.fullNumber}</div>
      ),
    },
    {
      accessorKey: 'date',
      header: 'Fecha',
      meta: { title: 'Fecha' },
      cell: ({ row }) => moment(row.original.date).format('DD/MM/YYYY'),
    },
    {
      id: 'invoices',
      header: 'Facturas Aplicadas',
      meta: { title: 'Facturas Aplicadas' },
      cell: ({ row }) => (
        <div className="space-y-1">
          {row.original.invoices.map((invoice, index) => (
            <div key={index} className="text-sm">
              <span className="text-muted-foreground">{invoice.invoiceNumber}</span>
              <span className="ml-2 text-green-600 font-medium">
                ${invoice.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'withholdings',
      header: 'Retenciones',
      meta: { title: 'Retenciones' },
      cell: ({ row }) => {
        const total = row.original.withholdingsTotal;
        return total > 0 ? (
          <div className="text-right text-orange-600 font-medium">
            ${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
          </div>
        ) : (
          <div className="text-right text-muted-foreground">-</div>
        );
      },
    },
    {
      accessorKey: 'totalAmount',
      header: 'Monto Total',
      meta: { title: 'Monto Total' },
      cell: ({ row }) => (
        <div className="text-right font-bold text-green-600">
          ${row.original.totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Resumen de Saldos */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facturado</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${summary.totalInvoiced.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground">Facturas y ND confirmadas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pagado</CardTitle>
            <TrendingDown className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${summary.totalPaid.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground">Pagos + NC aplicadas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo</CardTitle>
            <TrendingUp className={`h-4 w-4 ${summary.totalBalance > 0 ? 'text-red-600' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.totalBalance > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
              ${summary.totalBalance.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground">
              {summary.totalBalance > 0 ? 'A pagar al proveedor' : 'Sin saldo pendiente'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Facturas de Compra */}
      <Card>
        <CardHeader>
          <CardTitle>Facturas de Compra</CardTitle>
          <CardDescription>Detalle de facturas confirmadas y su estado de pago</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay facturas registradas</p>
          ) : (
            <DataTable
              columns={invoiceColumns}
              data={invoices}
              totalRows={invoices.length}
              searchPlaceholder="Buscar facturas..."
              tableId="commercial-supplier-invoices"
            />
          )}
        </CardContent>
      </Card>

      {/* Órdenes de Pago */}
      <Card>
        <CardHeader>
          <CardTitle>Órdenes de Pago</CardTitle>
          <CardDescription>Detalle de pagos confirmados realizados al proveedor</CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay órdenes de pago registradas</p>
          ) : (
            <DataTable
              columns={paymentColumns}
              data={payments}
              totalRows={payments.length}
              searchPlaceholder="Buscar pagos..."
              tableId="commercial-supplier-payments"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
