'use client';

import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import moment from 'moment';
import Link from 'next/link';

import { Badge } from '@/shared/components/ui/badge';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import type { SupplierPriceComparison } from '../actions.server';

interface PriceComparisonViewProps {
  products: SupplierPriceComparison[];
  isLoading?: boolean;
}

export function _PriceComparisonView({
  products,
  isLoading,
}: PriceComparisonViewProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-6">
        No se encontraron artículos para comparar
      </p>
    );
  }

  // Determine best/worst purchase prices (only among those with purchase data)
  const withPurchase = products.filter((p) => p.lastPurchasePrice !== null);
  const bestPurchasePrice =
    withPurchase.length > 0
      ? Math.min(...withPurchase.map((p) => p.lastPurchasePrice!))
      : null;
  const worstPurchasePrice =
    withPurchase.length > 0
      ? Math.max(...withPurchase.map((p) => p.lastPurchasePrice!))
      : null;

  return (
    <div className="max-h-[400px] overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Artículo</TableHead>
            <TableHead className="hidden sm:table-cell">Cód. OEM</TableHead>
            <TableHead className="hidden md:table-cell">Cód. Auxiliar</TableHead>
            <TableHead>Proveedor</TableHead>
            <TableHead className="text-right">Precio Compra</TableHead>
            <TableHead className="text-right">Precio Venta</TableHead>
            <TableHead className="text-right hidden sm:table-cell">
              Margen
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            const isBest =
              bestPurchasePrice !== null &&
              product.lastPurchasePrice === bestPurchasePrice &&
              withPurchase.length > 1;
            const isWorst =
              worstPurchasePrice !== null &&
              product.lastPurchasePrice === worstPurchasePrice &&
              withPurchase.length > 1 &&
              bestPurchasePrice !== worstPurchasePrice;
            const lowMargin =
              product.marginPercent !== null && product.marginPercent < 20;

            return (
              <TableRow key={product.productId}>
                <TableCell>
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/commercial/products/${product.productId}`}
                      className="font-mono text-sm hover:underline"
                    >
                      {product.productCode}
                    </Link>
                    <p className="text-sm truncate">{product.productName}</p>
                    {product.brand && (
                      <p className="text-xs text-muted-foreground">
                        {product.brand}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell font-mono text-sm">
                  {product.oemCode || '-'}
                </TableCell>
                <TableCell className="hidden md:table-cell font-mono text-sm">
                  {product.auxiliaryCode || '-'}
                </TableCell>
                <TableCell>
                  <div className="min-w-0">
                    <span className="text-sm truncate block">
                      {product.supplierName || 'Sin compras'}
                    </span>
                    {product.lastPurchaseDate && (
                      <p className="text-xs text-muted-foreground">
                        {moment(product.lastPurchaseDate).format('DD/MM/YYYY')}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {product.lastPurchasePrice !== null ? (
                    <span
                      className={
                        isBest
                          ? 'font-semibold text-green-600'
                          : isWorst
                            ? 'font-semibold text-orange-600'
                            : ''
                      }
                    >
                      ${product.lastPurchasePrice.toFixed(2)}
                      {isBest && (
                        <ArrowDown className="inline ml-1 h-3 w-3 text-green-600" />
                      )}
                      {isWorst && (
                        <ArrowUp className="inline ml-1 h-3 w-3 text-orange-600" />
                      )}
                    </span>
                  ) : (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="text-muted-foreground">
                            <Minus className="inline h-3 w-3" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Sin facturas de compra confirmadas</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  ${product.salePrice.toFixed(2)}
                </TableCell>
                <TableCell className="text-right hidden sm:table-cell">
                  {product.margin !== null ? (
                    <div>
                      <span
                        className={
                          lowMargin
                            ? 'text-yellow-600 font-medium'
                            : 'text-muted-foreground'
                        }
                      >
                        {product.marginPercent!.toFixed(1)}%
                      </span>
                      {lowMargin && (
                        <Badge
                          variant="outline"
                          className="ml-1 text-xs border-yellow-500 text-yellow-600"
                        >
                          Bajo
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">-</span>
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
