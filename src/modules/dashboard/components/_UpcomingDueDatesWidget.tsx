'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { CalendarClock } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import moment from 'moment';

interface DueItem {
  type: 'sale' | 'purchase';
  number: string;
  entity: string;
  dueDate: Date | null;
  total: number;
  daysUntilDue: number;
}

interface UpcomingDueDatesWidgetProps {
  data: DueItem[];
}

function getDueColor(daysUntilDue: number): string {
  if (daysUntilDue < 0) return 'text-red-600';
  if (daysUntilDue <= 3) return 'text-orange-600';
  return 'text-muted-foreground';
}

function getDueBadgeVariant(daysUntilDue: number): 'destructive' | 'outline' | 'secondary' {
  if (daysUntilDue < 0) return 'destructive';
  if (daysUntilDue <= 3) return 'outline';
  return 'secondary';
}

function getDueLabel(daysUntilDue: number): string {
  if (daysUntilDue < 0) return `Vencido (${Math.abs(daysUntilDue)}d)`;
  if (daysUntilDue === 0) return 'Hoy';
  if (daysUntilDue === 1) return 'Mañana';
  return `${daysUntilDue} días`;
}

export function _UpcomingDueDatesWidget({ data }: UpcomingDueDatesWidgetProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Próximos Vencimientos</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            Sin vencimientos próximos
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((item, index) => (
              <div key={index} className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={item.type === 'sale' ? 'default' : 'secondary'} className="text-xs shrink-0">
                      {item.type === 'sale' ? 'Venta' : 'Compra'}
                    </Badge>
                    <span className="text-sm font-medium truncate">{item.number}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground mt-0.5">{item.entity}</p>
                </div>
                <div className="flex flex-col items-end shrink-0 gap-0.5">
                  <span className="text-sm font-mono font-semibold">
                    {formatCurrency(item.total)}
                  </span>
                  <span className={`text-xs ${getDueColor(item.daysUntilDue)}`}>
                    {item.dueDate ? moment(item.dueDate).format('DD/MM') : '-'}{' '}
                    <Badge variant={getDueBadgeVariant(item.daysUntilDue)} className="text-[10px] px-1 py-0">
                      {getDueLabel(item.daysUntilDue)}
                    </Badge>
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
