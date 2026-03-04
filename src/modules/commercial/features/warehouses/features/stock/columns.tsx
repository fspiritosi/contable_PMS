'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Settings, ArrowLeftRight } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import type { WarehouseStock } from '../../shared/types';

interface ColumnsProps {
  onAdjust: (stock: WarehouseStock) => void;
  onTransfer: (stock: WarehouseStock) => void;
  canAdjust?: boolean;
  canTransfer?: boolean;
}

export function getColumns({ onAdjust, onTransfer, canAdjust = true, canTransfer = true }: ColumnsProps): ColumnDef<WarehouseStock>[] {
  return [
    {
      accessorKey: 'product.code',
      meta: { title: 'Código' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Código" />,
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.product?.code || '-'}</span>
      ),
    },
    {
      accessorKey: 'product.name',
      meta: { title: 'Producto' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Producto" />,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.product?.name || '-'}</span>
      ),
    },
    {
      accessorKey: 'product.unitOfMeasure',
      meta: { title: 'Unidad' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Unidad" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.product?.unitOfMeasure || '-'}</span>
      ),
    },
    {
      accessorKey: 'quantity',
      meta: { title: 'Cantidad' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Cantidad" />,
      cell: ({ row }) => (
        <div className="text-right font-mono">{row.original.quantity.toLocaleString()}</div>
      ),
    },
    {
      accessorKey: 'reservedQty',
      meta: { title: 'Reservado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Reservado" />,
      cell: ({ row }) => (
        <div className="text-right font-mono text-orange-600">
          {row.original.reservedQty.toLocaleString()}
        </div>
      ),
    },
    {
      accessorKey: 'availableQty',
      meta: { title: 'Disponible' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Disponible" />,
      cell: ({ row }) => (
        <div className="text-right font-mono font-semibold">
          {row.original.availableQty.toLocaleString()}
        </div>
      ),
    },
    {
      id: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const stock = row.original;
        const minStock = stock.product?.minStock || 0;
        const isBelowMin = stock.availableQty < minStock;

        if (isBelowMin) {
          return <Badge variant="destructive">Bajo mínimo ({minStock})</Badge>;
        }
        if (stock.availableQty === 0) {
          return <Badge variant="secondary">Sin stock</Badge>;
        }
        return <Badge variant="default">OK</Badge>;
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const stock = row.original;
        return (
          <div className="flex justify-end gap-2">
            {canAdjust && (
              <Button variant="outline" size="sm" onClick={() => onAdjust(stock)}>
                <Settings className="h-4 w-4 mr-1" />
                Ajustar
              </Button>
            )}
            {canTransfer && (
              <Button variant="outline" size="sm" onClick={() => onTransfer(stock)}>
                <ArrowLeftRight className="h-4 w-4 mr-1" />
                Transferir
              </Button>
            )}
          </div>
        );
      },
    },
  ];
}
