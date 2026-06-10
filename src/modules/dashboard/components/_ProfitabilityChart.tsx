'use client';

import { useEffect, useState } from 'react';
import { Bar, CartesianGrid, Line, ComposedChart, XAxis, YAxis } from 'recharts';
import { CardTitle, CardDescription } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/shared/components/ui/chart';
import { formatCurrency } from '@/shared/utils/formatters';
import { Filter, Loader2 } from 'lucide-react';
import { _CollapsibleCard } from './_CollapsibleCard';
import { getProfitabilityTrend } from '../actions.server';
import { toast } from 'sonner';
import { logger } from '@/shared/lib/logger';

interface ProfitabilityData {
  month: string;
  sales: number;
  purchases: number;
  expenses: number;
  profit: number;
}

interface ExpenseCategory {
  id: string;
  name: string;
}

interface ProfitabilityChartProps {
  data: ProfitabilityData[];
  categories: ExpenseCategory[];
  period?: string;
  monthsRange?: number;
  defaultOpen?: boolean;
}

const chartConfig = {
  sales: {
    label: 'Ventas',
    color: 'var(--chart-2)',
  },
  purchases: {
    label: 'Compras',
    color: 'var(--chart-1)',
  },
  expenses: {
    label: 'Gastos',
    color: 'var(--chart-3)',
  },
  profit: {
    label: 'Rentabilidad',
    color: 'var(--chart-4)',
  },
} satisfies ChartConfig;

export function _ProfitabilityChart({ data: initialData, categories, period, monthsRange = 6, defaultOpen }: ProfitabilityChartProps) {
  const [data, setData] = useState<ProfitabilityData[]>(initialData);
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  // Sincronizar cuando cambia el período (nuevos datos del server)
  useEffect(() => {
    setData(initialData);
    setExcludedCategories(new Set());
  }, [initialData]);

  const handleCategoryToggle = async (categoryId: string) => {
    const newExcluded = new Set(excludedCategories);
    if (newExcluded.has(categoryId)) {
      newExcluded.delete(categoryId);
    } else {
      newExcluded.add(categoryId);
    }
    setExcludedCategories(newExcluded);

    try {
      setIsLoading(true);
      const result = await getProfitabilityTrend(
        period,
        newExcluded.size > 0 ? Array.from(newExcluded) : undefined,
        monthsRange
      );
      setData(result);
    } catch (error) {
      logger.error('Error al filtrar rentabilidad', { data: { error } });
      toast.error('Error al actualizar el grafico');
    } finally {
      setIsLoading(false);
    }
  };

  const hasData = data.some((d) => d.sales !== 0 || d.purchases !== 0 || d.expenses !== 0);
  const activeFilters = excludedCategories.size;

  return (
    <_CollapsibleCard
      defaultOpen={defaultOpen}
      header={
        <div>
          <CardTitle className="text-base">Rentabilidad Mensual</CardTitle>
          <CardDescription className="text-xs">
            Ventas - Compras - Gastos
          </CardDescription>
        </div>
      }
      headerRight={
        <>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {categories.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1">
                  <Filter className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Tipos de gasto</span>
                  {activeFilters > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                      {activeFilters}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[250px] p-3" align="end">
                <div className="space-y-1">
                  <p className="text-sm font-medium mb-2">Excluir tipos de gasto</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Desmarca los tipos que no quieras incluir en el calculo
                  </p>
                  <div className="max-h-[200px] space-y-2 overflow-auto">
                    {categories.map((cat) => (
                      <label
                        key={cat.id}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={!excludedCategories.has(cat.id)}
                          onCheckedChange={() => handleCategoryToggle(cat.id)}
                        />
                        <span className={excludedCategories.has(cat.id) ? 'text-muted-foreground line-through' : ''}>
                          {cat.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </>
      }
    >
        {!hasData ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
            Sin datos en los ultimos {monthsRange} meses
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                width={55}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    formatter={(value, name) => {
                      const label = chartConfig[name as keyof typeof chartConfig]?.label ?? name;
                      return (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-mono font-medium tabular-nums">{formatCurrency(Number(value))}</span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="sales" fill="var(--color-sales)" radius={[2, 2, 0, 0]} barSize={20} name="sales" />
              <Bar dataKey="purchases" fill="var(--color-purchases)" radius={[2, 2, 0, 0]} barSize={20} name="purchases" />
              <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[2, 2, 0, 0]} barSize={20} name="expenses" />
              <Line
                type="monotone"
                dataKey="profit"
                stroke="var(--color-profit)"
                strokeWidth={3}
                dot={{ r: 5, fill: 'var(--color-profit)', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 7 }}
                name="profit"
              />
            </ComposedChart>
          </ChartContainer>
        )}
    </_CollapsibleCard>
  );
}
