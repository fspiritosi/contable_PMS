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
import type { ClientAccountStatement, ClientInvoiceWithBalance, ClientReceipt } from '../actions.server';
import { isCreditNote } from '@/modules/commercial/shared/voucher-utils';

interface AccountStatementTabProps {
  accountStatement: ClientAccountStatement;
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

export function _AccountStatementTab({ accountStatement }: AccountStatementTabProps) {
  const { invoices, receipts, summary } = accountStatement;
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [selectedReceipts, setSelectedReceipts] = useState<string[]>([]);

  // Columnas para facturas de venta
  const invoiceColumns: ColumnDef<ClientInvoiceWithBalance>[] = [
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
          href={`/dashboard/commercial/invoices/${row.original.id}`}
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
      accessorKey: 'collected',
      header: 'Cobrado',
      meta: { title: 'Cobrado' },
      cell: ({ row }) => (
        <div className="text-right text-green-600">
          ${row.original.collected.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
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
        const isCollected = invoice.balance <= 0.01;

        if (isCollected) {
          return <Badge variant="default">Cobrada</Badge>;
        }
        if (isOverdue) {
          return <Badge variant="destructive">Vencida</Badge>;
        }
        return <Badge variant="secondary">Pendiente</Badge>;
      },
    },
  ];

  // Columnas para recibos de cobro
  const receiptColumns: ColumnDef<ClientReceipt>[] = [
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
            <CardTitle className="text-sm font-medium">Cobrado</CardTitle>
            <TrendingDown className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${summary.totalCollected.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground">Recibos + NC aplicadas</p>
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
              {summary.totalBalance > 0 ? 'A cobrar del cliente' : 'Sin saldo pendiente'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Facturas de Venta */}
      <Card>
        <CardHeader>
          <CardTitle>Facturas de Venta</CardTitle>
          <CardDescription>Detalle de facturas confirmadas y su estado de cobro</CardDescription>
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
              tableId="commercial-client-invoices"
            />
          )}
        </CardContent>
      </Card>

      {/* Recibos de Cobro */}
      <Card>
        <CardHeader>
          <CardTitle>Recibos de Cobro</CardTitle>
          <CardDescription>Detalle de cobros confirmados realizados del cliente</CardDescription>
        </CardHeader>
        <CardContent>
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay recibos registrados</p>
          ) : (
            <DataTable
              columns={receiptColumns}
              data={receipts}
              totalRows={receipts.length}
              searchPlaceholder="Buscar recibos..."
              tableId="commercial-client-receipts"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
