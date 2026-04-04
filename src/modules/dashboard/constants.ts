// src/modules/dashboard/constants.ts

export interface WidgetDefinition {
  id: string;
  label: string;
  category: string;
}

export const WIDGET_CATEGORIES = [
  'KPIs',
  'Graficos',
  'Comercial',
  'Operativo',
] as const;

export type WidgetCategory = (typeof WIDGET_CATEGORIES)[number];

export const DASHBOARD_WIDGETS: WidgetDefinition[] = [
  // KPIs
  { id: 'kpi-sales', label: 'Ventas del Mes', category: 'KPIs' },
  { id: 'kpi-purchases', label: 'Compras del Mes', category: 'KPIs' },
  { id: 'kpi-expenses', label: 'Gastos del Mes', category: 'KPIs' },
  { id: 'kpi-receivables', label: 'Pendiente de Cobro', category: 'KPIs' },
  { id: 'kpi-payables', label: 'Pendiente de Pago', category: 'KPIs' },
  { id: 'kpi-critical-stock', label: 'Stock Critico', category: 'KPIs' },
  { id: 'kpi-bank-balance', label: 'Saldo Bancario', category: 'KPIs' },
  // Graficos
  { id: 'chart-profitability', label: 'Rentabilidad Mensual', category: 'Graficos' },
  { id: 'chart-sales-trend', label: 'Tendencia de Ventas', category: 'Graficos' },
  { id: 'chart-purchases-trend', label: 'Tendencia de Compras', category: 'Graficos' },
  { id: 'chart-weekly-sales', label: 'Ventas Semanales', category: 'Graficos' },
  // Comercial
  { id: 'widget-payment-methods', label: 'Medios de Pago', category: 'Comercial' },
  { id: 'widget-client-debts', label: 'Top 10 Deudas de Clientes', category: 'Comercial' },
  { id: 'widget-supplier-debts', label: 'Top 10 Deudas de Proveedores', category: 'Comercial' },
  { id: 'widget-top-products', label: 'Productos Mas Vendidos', category: 'Comercial' },
  // Operativo
  { id: 'widget-due-dates', label: 'Proximos Vencimientos', category: 'Operativo' },
  { id: 'widget-critical-stock', label: 'Stock Critico (lista)', category: 'Operativo' },
  { id: 'widget-alerts', label: 'Alertas y Vencimientos', category: 'Operativo' },
];

export function getWidgetsByCategory(category: string): WidgetDefinition[] {
  return DASHBOARD_WIDGETS.filter((w) => w.category === category);
}
