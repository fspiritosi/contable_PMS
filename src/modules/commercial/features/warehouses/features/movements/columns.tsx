'use client';

import type { ColumnDef } from '@tanstack/react-table';
import moment from 'moment';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  ShoppingCart,
  Package,
  Settings,
  RotateCcw,
  Factory,
  AlertTriangle,
} from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import type { StockMovement } from '../../shared/types';
import { STOCK_MOVEMENT_TYPE_LABELS } from '../../shared/types';
import { cn } from '@/shared/lib/utils';

const REFERENCE_TYPE_LABELS: Record<string, string> = {
  transfer: 'Transferencia',
  sales_invoice: 'Factura de Venta',
  sales_invoice_cancel: 'Anulación Factura Venta',
  purchase_invoice: 'Factura de Compra',
  purchase_invoice_cancel: 'Anulación Factura Compra',
  delivery_note: 'Remito de Entrega',
  delivery_note_cancellation: 'Anulación Remito',
  receiving_note: 'Remito de Recepción',
  receiving_note_cancellation: 'Anulación Recepción',
  entry: 'Entrada',
  exit: 'Salida',
  loss: 'Pérdida/Merma',
};

const REFERENCE_TYPE_ROUTES: Record<string, string> = {
  sales_invoice: '/dashboard/commercial/invoices',
  sales_invoice_cancel: '/dashboard/commercial/invoices',
  purchase_invoice: '/dashboard/commercial/purchases',
  purchase_invoice_cancel: '/dashboard/commercial/purchases',
  delivery_note: '/dashboard/commercial/delivery-notes',
  delivery_note_cancellation: '/dashboard/commercial/delivery-notes',
  receiving_note: '/dashboard/commercial/receiving-notes',
  receiving_note_cancellation: '/dashboard/commercial/receiving-notes',
};

const MOVEMENT_TYPE_CONFIG: Record<string, {
  icon: typeof ShoppingCart;
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
  color: string;
  sign: string;
}> = {
  PURCHASE: { icon: ShoppingCart, variant: 'default', color: 'text-green-600', sign: '+' },
  SALE: { icon: Package, variant: 'secondary', color: 'text-blue-600', sign: '-' },
  ADJUSTMENT: { icon: Settings, variant: 'outline', color: 'text-purple-600', sign: '±' },
  TRANSFER_OUT: { icon: ArrowUp, variant: 'destructive', color: 'text-red-600', sign: '-' },
  TRANSFER_IN: { icon: ArrowDown, variant: 'default', color: 'text-green-600', sign: '+' },
  RETURN: { icon: RotateCcw, variant: 'secondary', color: 'text-orange-600', sign: '+' },
  PRODUCTION: { icon: Factory, variant: 'default', color: 'text-cyan-600', sign: '+' },
  LOSS: { icon: AlertTriangle, variant: 'destructive', color: 'text-red-600', sign: '-' },
};

export function getColumns(): ColumnDef<StockMovement>[] {
  return [
    {
      accessorKey: 'date',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {moment(row.original.date).format('DD/MM/YYYY HH:mm')}
        </span>
      ),
    },
    {
      accessorKey: 'type',
      meta: { title: 'Tipo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      cell: ({ row }) => {
        const config = MOVEMENT_TYPE_CONFIG[row.original.type];
        if (!config) return <Badge variant="outline">{row.original.type}</Badge>;
        const Icon = config.icon;
        return (
          <Badge variant={config.variant} className="gap-1">
            <Icon className="h-3 w-3" />
            {STOCK_MOVEMENT_TYPE_LABELS[row.original.type]}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'product.name',
      meta: { title: 'Producto' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Producto" />,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.product?.name || '-'}</div>
          <div className="text-xs text-muted-foreground">{row.original.product?.code}</div>
        </div>
      ),
    },
    {
      accessorKey: 'warehouse.name',
      meta: { title: 'Almacén' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Almacén" />,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.warehouse?.name || '-'}</div>
          <div className="text-xs text-muted-foreground">{row.original.warehouse?.code}</div>
        </div>
      ),
    },
    {
      accessorKey: 'quantity',
      meta: { title: 'Cantidad' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Cantidad" />,
      cell: ({ row }) => {
        const config = MOVEMENT_TYPE_CONFIG[row.original.type];
        const isPositive = config?.sign === '+';
        const isNegative = config?.sign === '-';

        return (
          <div className="text-right">
            <span
              className={cn(
                'font-mono font-semibold',
                isPositive && 'text-green-600',
                isNegative && 'text-red-600'
              )}
            >
              {config?.sign}
              {row.original.quantity.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground ml-1">
              {row.original.product?.unitOfMeasure}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'referenceType',
      meta: { title: 'Referencia' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Referencia" />,
      cell: ({ row }) => {
        const { referenceType, referenceId, referenceNumber } = row.original;
        if (!referenceType) return <span className="text-muted-foreground">-</span>;

        const route = referenceType ? REFERENCE_TYPE_ROUTES[referenceType] : null;
        const hasLink = route && referenceId;

        return (
          <div className="text-sm">
            <div>{REFERENCE_TYPE_LABELS[referenceType] || referenceType}</div>
            {referenceNumber && (
              hasLink ? (
                <Link
                  href={`${route}/${referenceId}`}
                  target="_blank"
                  className="text-xs font-mono text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {referenceNumber}
                </Link>
              ) : (
                <div className="text-xs text-muted-foreground font-mono">
                  {referenceNumber}
                </div>
              )
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'notes',
      meta: { title: 'Notas' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Notas" />,
      cell: ({ row }) =>
        row.original.notes ? (
          <span className="text-sm max-w-xs truncate block">{row.original.notes}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
  ];
}
