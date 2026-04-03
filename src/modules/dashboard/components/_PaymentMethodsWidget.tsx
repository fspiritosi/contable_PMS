'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { CreditCard } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import { Badge } from '@/shared/components/ui/badge';

interface PaymentMethodItem {
  method: string;
  total: number;
  count: number;
}

interface PaymentMethodsWidgetProps {
  data: PaymentMethodItem[];
}

export function _PaymentMethodsWidget({ data }: PaymentMethodsWidgetProps) {
  const grandTotal = data.reduce((sum, d) => sum + d.total, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Medios de Pago (Cobros)</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            Sin cobros en los últimos 30 días
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((item, index) => {
              const percentage = grandTotal > 0 ? Math.round((item.total / grandTotal) * 100) : 0;
              return (
                <div key={index} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">{item.method}</span>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {item.count}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{percentage}%</span>
                      <span className="text-sm font-mono font-semibold min-w-[90px] text-right">
                        {formatCurrency(item.total)}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
