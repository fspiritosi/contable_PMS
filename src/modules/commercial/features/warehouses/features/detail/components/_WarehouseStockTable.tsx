'use client';

import { Badge } from '@/shared/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import type { WarehouseStock } from '../../../shared/types';

interface WarehouseStockTableProps {
  stocks: WarehouseStock[];
}

export function WarehouseStockTable({ stocks }: WarehouseStockTableProps) {
  if (stocks.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No hay ítems en stock en este almacén
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Ítem</TableHead>
            <TableHead>Unidad</TableHead>
            <TableHead className="text-right">Cantidad</TableHead>
            <TableHead className="text-right">Reservado</TableHead>
            <TableHead className="text-right">Disponible</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stocks.map((stock) => {
            const product = stock.product;
            const minStock = product?.minStock || 0;
            const isBelowMin = stock.availableQty < minStock;

            return (
              <TableRow key={stock.id}>
                <TableCell className="font-mono text-sm">
                  {product?.code || '-'}
                </TableCell>
                <TableCell className="font-medium">
                  {product?.name || '-'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {product?.unitOfMeasure || '-'}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {stock.quantity.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-mono text-orange-600">
                  {stock.reservedQty.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold">
                  {stock.availableQty.toLocaleString()}
                </TableCell>
                <TableCell>
                  {isBelowMin ? (
                    <Badge variant="destructive">
                      Bajo stock mínimo ({minStock})
                    </Badge>
                  ) : stock.availableQty === 0 ? (
                    <Badge variant="secondary">Sin disponible</Badge>
                  ) : (
                    <Badge variant="default">OK</Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
