'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Package } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';

interface ProductItem {
  code: string;
  name: string;
  totalQty: number;
  totalAmount: number;
}

interface TopProductsWidgetProps {
  data: ProductItem[];
}

export function _TopProductsWidget({ data }: TopProductsWidgetProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Productos Más Vendidos</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            Sin ventas en los últimos 30 días
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((item, index) => (
              <div key={index} className="flex items-center gap-3">
                <span className="text-sm font-bold text-muted-foreground w-5 text-right shrink-0">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {item.code && <span className="text-muted-foreground">{item.code} - </span>}
                    {item.name}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {item.totalQty.toLocaleString('es-AR')} uds.
                  </span>
                  <span className="text-sm font-mono font-semibold text-right min-w-[90px]">
                    {formatCurrency(item.totalAmount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
