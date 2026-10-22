'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { cn } from '@/shared/lib/utils';
import { formatCurrency } from '@/shared/utils/formatters';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Landmark,
  Receipt,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { kpiValueFontSize } from './kpi-fit';

export interface KpiData {
  salesThisMonth: { total: number; count: number };
  purchasesThisMonth: { total: number; count: number };
  expensesThisMonth: { total: number; count: number };
  pendingReceivables: { total: number; count: number };
  pendingPayables: { total: number; count: number };
  criticalStockCount: number;
  bankBalance: number;
}

interface KpiItem {
  widgetId: string;
  title: string;
  icon: LucideIcon;
  iconClassName?: string;
  value: string;
  valueClassName?: string;
  caption: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count !== 1 ? 's' : ''}`;

function buildKpis(kpis: KpiData, isCurrentMonth: boolean): KpiItem[] {
  return [
    {
      widgetId: 'kpi-sales',
      title: isCurrentMonth ? 'Ventas del Mes' : 'Ventas',
      icon: TrendingUp,
      value: formatCurrency(kpis.salesThisMonth.total),
      caption: plural(kpis.salesThisMonth.count, 'factura'),
    },
    {
      widgetId: 'kpi-purchases',
      title: isCurrentMonth ? 'Compras del Mes' : 'Compras',
      icon: ShoppingCart,
      value: formatCurrency(kpis.purchasesThisMonth.total),
      caption: plural(kpis.purchasesThisMonth.count, 'factura'),
    },
    {
      widgetId: 'kpi-expenses',
      title: isCurrentMonth ? 'Gastos del Mes' : 'Gastos',
      icon: Receipt,
      value: formatCurrency(kpis.expensesThisMonth.total),
      caption: plural(kpis.expensesThisMonth.count, 'gasto'),
    },
    {
      widgetId: 'kpi-receivables',
      title: 'Pendiente de Cobro',
      icon: ArrowDownCircle,
      iconClassName: 'text-orange-500',
      value: formatCurrency(kpis.pendingReceivables.total),
      valueClassName: 'text-orange-600',
      caption: plural(kpis.pendingReceivables.count, 'documento'),
    },
    {
      widgetId: 'kpi-payables',
      title: 'Pendiente de Pago',
      icon: ArrowUpCircle,
      iconClassName: 'text-red-500',
      value: formatCurrency(kpis.pendingPayables.total),
      valueClassName: 'text-red-600',
      caption: plural(kpis.pendingPayables.count, 'documento'),
    },
    {
      widgetId: 'kpi-critical-stock',
      title: 'Stock Crítico',
      icon: AlertTriangle,
      iconClassName: 'text-yellow-500',
      value: String(kpis.criticalStockCount),
      valueClassName: kpis.criticalStockCount > 0 ? 'text-yellow-600' : undefined,
      caption: `ítem${kpis.criticalStockCount !== 1 ? 's' : ''} bajo mínimo`,
    },
    {
      widgetId: 'kpi-bank-balance',
      title: 'Saldo Bancario',
      icon: Landmark,
      value: formatCurrency(kpis.bankBalance),
      valueClassName: kpis.bankBalance < 0 ? 'text-red-600' : 'text-green-600',
      caption: 'Cuentas activas',
    },
  ];
}

interface KpiCardsProps {
  kpis: KpiData;
  isCurrentMonth: boolean;
  isWidgetVisible: (widgetId: string) => boolean;
}

/**
 * Fila de cards de KPIs del dashboard. Las columnas se reparten según el ancho disponible
 * (no según el viewport, porque el sidebar puede estar abierto o cerrado) y el tamaño de
 * los montos se ajusta al ancho de la card para que nunca se salgan (TSK-790).
 */
export function _KpiCards({ kpis, isCurrentMonth, isWidgetVisible }: KpiCardsProps) {
  const items = buildKpis(kpis, isCurrentMonth).filter((k) => isWidgetVisible(k.widgetId));
  if (items.length === 0) return null;

  const fontSize = kpiValueFontSize(Math.max(...items.map((k) => k.value.length)));

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4">
      {items.map((k) => (
        <Card key={k.widgetId}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{k.title}</CardTitle>
            <k.icon className={cn('h-4 w-4 shrink-0 text-muted-foreground', k.iconClassName)} />
          </CardHeader>
          <CardContent className="@container">
            <div
              className={cn(
                'leading-snug font-bold whitespace-nowrap tabular-nums',
                k.valueClassName
              )}
              style={{ fontSize }}
              title={k.value}
            >
              {k.value}
            </div>
            <p className="text-xs text-muted-foreground">{k.caption}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
