'use client';

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { CardTitle } from '@/shared/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/shared/components/ui/chart';
import { formatCurrency } from '@/shared/utils/formatters';
import { _CollapsibleCard } from './_CollapsibleCard';

interface PurchasesTrendChartProps {
  data: Array<{ month: string; total: number }>;
  defaultOpen?: boolean;
}

const chartConfig = {
  total: {
    label: 'Compras',
    color: 'var(--chart-2)',
  },
} satisfies ChartConfig;

export function _PurchasesTrendChart({ data, defaultOpen }: PurchasesTrendChartProps) {
  return (
    <_CollapsibleCard header={<CardTitle className="text-base">Tendencia de Compras</CardTitle>} defaultOpen={defaultOpen}>
      {data.every((d) => d.total === 0) ? (
        <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
          Sin datos de compras en el período seleccionado
        </div>
      ) : (
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="fillPurchases" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
              width={50}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => formatCurrency(Number(value))}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="total"
              stroke="var(--color-total)"
              fill="url(#fillPurchases)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </_CollapsibleCard>
  );
}
