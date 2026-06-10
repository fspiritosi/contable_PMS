'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { CardTitle } from '@/shared/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/shared/components/ui/chart';
import { formatCurrency } from '@/shared/utils/formatters';
import { _CollapsibleCard } from './_CollapsibleCard';

interface WeeklySalesData {
  day: string;
  currentWeek: number;
  previousWeek: number;
}

interface WeeklySalesChartProps {
  data: WeeklySalesData[];
  defaultOpen?: boolean;
}

const chartConfig = {
  currentWeek: {
    label: 'Semana actual',
    color: 'var(--chart-1)',
  },
  previousWeek: {
    label: 'Semana anterior',
    color: 'var(--chart-2)',
  },
} satisfies ChartConfig;

export function _WeeklySalesChart({ data, defaultOpen }: WeeklySalesChartProps) {
  const hasData = data.some((d) => d.currentWeek > 0 || d.previousWeek > 0);

  return (
    <_CollapsibleCard header={<CardTitle className="text-base">Ventas Semanales</CardTitle>} defaultOpen={defaultOpen}>
      {!hasData ? (
        <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
          Sin ventas en las últimas dos semanas
        </div>
      ) : (
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
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
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="currentWeek" fill="var(--color-currentWeek)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="previousWeek" fill="var(--color-previousWeek)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      )}
    </_CollapsibleCard>
  );
}
