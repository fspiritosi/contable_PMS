'use client';

import Link from 'next/link';
import { CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Package, ArrowRight } from 'lucide-react';
import { _CollapsibleCard } from './_CollapsibleCard';

interface CriticalStockProduct {
  productId: string;
  productName: string;
  productCode: string;
  totalStock: number;
  minStock: number;
  unitOfMeasure: string;
  stockPercentage: number;
}

interface CriticalStockListProps {
  products: CriticalStockProduct[];
  defaultOpen?: boolean;
}

export function _CriticalStockList({ products, defaultOpen }: CriticalStockListProps) {
  return (
    <_CollapsibleCard
      header={<CardTitle className="text-base">Stock Crítico</CardTitle>}
      defaultOpen={defaultOpen}
      headerRight={
        <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
          <Link href="/dashboard/commercial/stock">
            Ver todo <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      }
    >
        {products.length === 0 ? (
          <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Package className="h-8 w-8" />
            <p className="text-sm">No hay ítems con stock crítico</p>
          </div>
        ) : (
          <div className="space-y-2">
            {products.map((product) => (
              <div
                key={product.productId}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{product.productName}</p>
                  <p className="text-xs text-muted-foreground">{product.productCode}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right text-xs">
                    <span className="font-medium">
                      {product.totalStock} / {product.minStock}
                    </span>
                    <span className="ml-1 text-muted-foreground">{product.unitOfMeasure}</span>
                  </div>
                  {product.totalStock === 0 ? (
                    <Badge variant="destructive" className="text-xs">Sin stock</Badge>
                  ) : (
                    <Badge variant="outline" className="border-yellow-500 text-yellow-600 text-xs">
                      Bajo
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
    </_CollapsibleCard>
  );
}
