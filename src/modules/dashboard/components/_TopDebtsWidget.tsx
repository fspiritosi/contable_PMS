'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { formatCurrency } from '@/shared/utils/formatters';
import type { LucideIcon } from 'lucide-react';

interface DebtItem {
  name: string;
  taxId: string | null;
  totalDebt: number;
  invoiceCount: number;
}

interface TopDebtsWidgetProps {
  title: string;
  icon: LucideIcon;
  data: DebtItem[];
  emptyMessage?: string;
}

export function _TopDebtsWidget({ title, icon: Icon, data, emptyMessage = 'Sin deudas pendientes' }: TopDebtsWidgetProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((item, index) => (
              <div key={index} className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  {item.taxId && (
                    <p className="truncate text-xs text-muted-foreground">{item.taxId}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary" className="text-xs">
                    {item.invoiceCount} fact.
                  </Badge>
                  <span className="text-sm font-mono font-semibold text-right min-w-[100px]">
                    {formatCurrency(item.totalDebt)}
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
