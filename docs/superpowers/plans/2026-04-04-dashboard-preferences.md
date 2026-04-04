# Dashboard Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each user to customize their dashboard: choose which widgets to show/hide and whether accordions start open or closed, stored in localStorage.

**Architecture:** A constants file defines all widget IDs and categories. A custom hook reads/writes preferences from localStorage keyed by companyId. A `_DashboardGrid` client component receives all data from the server and conditionally renders widgets based on preferences. A settings dialog provides the UI for toggling widgets and accordion state, accessible from both the dashboard header and the company settings section.

**Tech Stack:** React 19, Next.js 16, shadcn/ui (Dialog, Switch, Checkbox, Separator), localStorage, Zustand-free (hook only)

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/modules/dashboard/constants.ts` | Widget ID definitions and categories |
| Create | `src/modules/dashboard/hooks/useDashboardPreferences.ts` | localStorage read/write hook |
| Create | `src/modules/dashboard/components/_DashboardSettingsDialog.tsx` | Settings UI dialog |
| Create | `src/modules/dashboard/components/_DashboardGrid.tsx` | Client component that conditionally renders all widgets |
| Create | `src/modules/dashboard/features/settings/DashboardSettings.tsx` | Server component for company settings page |
| Create | `src/modules/dashboard/features/settings/index.ts` | Barrel export |
| Create | `src/app/(core)/dashboard/company/dashboard-settings/page.tsx` | Route page |
| Modify | `src/modules/dashboard/DashboardContent.tsx` | Pass all data to _DashboardGrid instead of rendering directly |
| Modify | `src/modules/dashboard/components/_CollapsibleCard.tsx` | No code change needed - already accepts `defaultOpen` |
| Modify | `src/shared/components/layout/_AppSidebar.tsx:336-358` | Add "Dashboard" item to General subgroup |

---

### Task 1: Widget Constants

**Files:**
- Create: `src/modules/dashboard/constants.ts`

- [ ] **Step 1: Create the constants file with widget definitions**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/dashboard/constants.ts
git commit -m "feat(dashboard): add widget ID constants and categories"
```

---

### Task 2: useDashboardPreferences Hook

**Files:**
- Create: `src/modules/dashboard/hooks/useDashboardPreferences.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/modules/dashboard/hooks/useDashboardPreferences.ts
'use client';

import { useCallback, useSyncExternalStore } from 'react';

export interface DashboardPreferences {
  hiddenWidgets: string[];
  accordionsOpen: boolean;
}

const DEFAULT_PREFERENCES: DashboardPreferences = {
  hiddenWidgets: [],
  accordionsOpen: true,
};

function getStorageKey(companyId: string): string {
  return `dashboard-prefs-${companyId}`;
}

function getSnapshot(companyId: string): DashboardPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = localStorage.getItem(getStorageKey(companyId));
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    return {
      hiddenWidgets: Array.isArray(parsed.hiddenWidgets) ? parsed.hiddenWidgets : [],
      accordionsOpen: typeof parsed.accordionsOpen === 'boolean' ? parsed.accordionsOpen : true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferences(companyId: string, prefs: DashboardPreferences): void {
  localStorage.setItem(getStorageKey(companyId), JSON.stringify(prefs));
  // Dispatch storage event so other tabs/components react
  window.dispatchEvent(new Event('dashboard-prefs-change'));
}

// Subscribers for useSyncExternalStore
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);

  const handleChange = () => callback();
  window.addEventListener('dashboard-prefs-change', handleChange);

  return () => {
    listeners.delete(callback);
    window.removeEventListener('dashboard-prefs-change', handleChange);
  };
}

export function useDashboardPreferences(companyId: string) {
  const preferences = useSyncExternalStore(
    subscribe,
    () => getSnapshot(companyId),
    () => DEFAULT_PREFERENCES
  );

  const setPreferences = useCallback(
    (updater: (prev: DashboardPreferences) => DashboardPreferences) => {
      const current = getSnapshot(companyId);
      const next = updater(current);
      savePreferences(companyId, next);
    },
    [companyId]
  );

  const toggleWidget = useCallback(
    (widgetId: string) => {
      setPreferences((prev) => {
        const isHidden = prev.hiddenWidgets.includes(widgetId);
        return {
          ...prev,
          hiddenWidgets: isHidden
            ? prev.hiddenWidgets.filter((id) => id !== widgetId)
            : [...prev.hiddenWidgets, widgetId],
        };
      });
    },
    [setPreferences]
  );

  const setAccordionsOpen = useCallback(
    (open: boolean) => {
      setPreferences((prev) => ({ ...prev, accordionsOpen: open }));
    },
    [setPreferences]
  );

  const isWidgetVisible = useCallback(
    (widgetId: string) => !preferences.hiddenWidgets.includes(widgetId),
    [preferences.hiddenWidgets]
  );

  const resetDefaults = useCallback(() => {
    savePreferences(companyId, DEFAULT_PREFERENCES);
  }, [companyId]);

  return {
    preferences,
    toggleWidget,
    setAccordionsOpen,
    isWidgetVisible,
    resetDefaults,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/dashboard/hooks/useDashboardPreferences.ts
git commit -m "feat(dashboard): add useDashboardPreferences localStorage hook"
```

---

### Task 3: _DashboardSettingsDialog

**Files:**
- Create: `src/modules/dashboard/components/_DashboardSettingsDialog.tsx`

- [ ] **Step 1: Create the settings dialog component**

```typescript
// src/modules/dashboard/components/_DashboardSettingsDialog.tsx
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { Switch } from '@/shared/components/ui/switch';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Separator } from '@/shared/components/ui/separator';
import { Label } from '@/shared/components/ui/label';
import { Settings2, RotateCcw } from 'lucide-react';
import { WIDGET_CATEGORIES, getWidgetsByCategory } from '../constants';
import { useDashboardPreferences } from '../hooks/useDashboardPreferences';

interface DashboardSettingsDialogProps {
  companyId: string;
}

export function _DashboardSettingsDialog({ companyId }: DashboardSettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const { preferences, toggleWidget, setAccordionsOpen, isWidgetVisible, resetDefaults } =
    useDashboardPreferences(companyId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8">
          <Settings2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configurar Dashboard</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Accordion setting */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Iniciar widgets abiertos</Label>
              <p className="text-xs text-muted-foreground">
                Los acordeones de los widgets se abren automaticamente al cargar
              </p>
            </div>
            <Switch
              checked={preferences.accordionsOpen}
              onCheckedChange={setAccordionsOpen}
            />
          </div>

          <Separator />

          {/* Widgets by category */}
          <div className="space-y-4">
            <Label className="text-sm font-medium">Widgets visibles</Label>
            {WIDGET_CATEGORIES.map((category) => {
              const widgets = getWidgetsByCategory(category);
              return (
                <div key={category}>
                  <p className="text-sm font-medium text-muted-foreground mb-2">{category}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {widgets.map((widget) => (
                      <label
                        key={widget.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={isWidgetVisible(widget.id)}
                          onCheckedChange={() => toggleWidget(widget.id)}
                        />
                        <span>{widget.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <Separator />

          {/* Reset */}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={resetDefaults} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar valores por defecto
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/dashboard/components/_DashboardSettingsDialog.tsx
git commit -m "feat(dashboard): add settings dialog for widget visibility and accordion state"
```

---

### Task 4: _DashboardGrid Client Component

**Files:**
- Create: `src/modules/dashboard/components/_DashboardGrid.tsx`
- Modify: `src/modules/dashboard/DashboardContent.tsx`

This is the core task. `_DashboardGrid` receives all server data and renders widgets conditionally. `DashboardContent` becomes a thin server wrapper that fetches data and passes it down.

- [ ] **Step 1: Create _DashboardGrid**

Create `src/modules/dashboard/components/_DashboardGrid.tsx` as a client component. It receives all widget data as props plus `companyId`. Internally uses `useDashboardPreferences` to decide what to render.

The component must:
- Import all widget components (`_SalesTrendChart`, `_PurchasesTrendChart`, etc.)
- Import `_DashboardSettingsDialog`
- Import `_PeriodSelector` and `_MonthsRangeSelector`
- Receive `companyId`, all fetched data, `isCurrentMonth`, `periodLabel`, `displayPeriod`, `monthsRange`, and `validPeriod` as props
- Render the header (title + period selector + settings button)
- Render KPI cards conditionally (same 7 cards from DashboardContent, each wrapped in `{isWidgetVisible('kpi-xxx') && ...}`)
- Render each widget section conditionally
- Pass `preferences.accordionsOpen` as `defaultOpen` to each `_CollapsibleCard` via the widget components

The full code for this component:

```typescript
// src/modules/dashboard/components/_DashboardGrid.tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  TrendingUp,
  ShoppingCart,
  Receipt,
  ArrowDownCircle,
  ArrowUpCircle,
  AlertTriangle,
  Landmark,
} from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import { useDashboardPreferences } from '../hooks/useDashboardPreferences';
import { _SalesTrendChart } from './_SalesTrendChart';
import { _PurchasesTrendChart } from './_PurchasesTrendChart';
import { _CriticalStockList } from './_CriticalStockList';
import { _AlertsList } from './_AlertsList';
import { _ProfitabilityChart } from './_ProfitabilityChart';
import { _PeriodSelector } from './_PeriodSelector';
import { _MonthsRangeSelector } from './_MonthsRangeSelector';
import { _TopDebtsWidget } from './_TopDebtsWidget';
import { _TopProductsWidget } from './_TopProductsWidget';
import { _WeeklySalesChart } from './_WeeklySalesChart';
import { _PaymentMethodsWidget } from './_PaymentMethodsWidget';
import { _UpcomingDueDatesWidget } from './_UpcomingDueDatesWidget';
import { _DashboardSettingsDialog } from './_DashboardSettingsDialog';

// NOTE: The exact prop types should be inferred from the server action return types.
// Use Awaited<ReturnType<typeof actionFn>> pattern from the project conventions.
// The interface below is a simplified representation - use the actual types from actions.server.ts.

interface DashboardGridProps {
  companyId: string;
  isCurrentMonth: boolean;
  periodLabel: string;
  displayPeriod: string;
  monthsRange: number;
  validPeriod: string | undefined;
  kpis: {
    salesThisMonth: { total: number; count: number };
    purchasesThisMonth: { total: number; count: number };
    expensesThisMonth: { total: number; count: number };
    pendingReceivables: { total: number; count: number };
    pendingPayables: { total: number; count: number };
    criticalStockCount: number;
    bankBalance: number;
  };
  salesTrend: Array<{ month: string; total: number }>;
  purchasesTrend: Array<{ month: string; total: number }>;
  profitabilityTrend: Array<{ month: string; sales: number; purchases: number; expenses: number; profit: number }>;
  expenseCategories: Array<{ id: string; name: string }>;
  criticalStock: Array<{
    productId: string;
    productName: string;
    productCode: string;
    totalStock: number;
    minStock: number;
    unitOfMeasure: string;
    stockPercentage: number;
  }>;
  alerts: Array<{
    type: 'overdue_receivable' | 'overdue_payable' | 'overdue_expense';
    title: string;
    description: string;
    date: Date | null;
    amount: number;
  }>;
  topClientDebts: Array<{ name: string; taxId: string | null; totalDebt: number; invoiceCount: number }>;
  topSupplierDebts: Array<{ name: string; taxId: string | null; totalDebt: number; invoiceCount: number }>;
  topProducts: Array<{ code: string; name: string; totalQty: number; totalAmount: number }>;
  weeklySales: Array<{ day: string; currentWeek: number; previousWeek: number }>;
  paymentMethods: Array<{ method: string; total: number; count: number }>;
  upcomingDueDates: Array<{
    type: 'sale' | 'purchase';
    number: string;
    entity: string;
    dueDate: Date | null;
    total: number;
    daysUntilDue: number;
  }>;
}

export function _DashboardGrid({
  companyId,
  isCurrentMonth,
  periodLabel,
  displayPeriod,
  monthsRange,
  validPeriod,
  kpis,
  salesTrend,
  purchasesTrend,
  profitabilityTrend,
  expenseCategories,
  criticalStock,
  alerts,
  topClientDebts,
  topSupplierDebts,
  topProducts,
  weeklySales,
  paymentMethods,
  upcomingDueDates,
}: DashboardGridProps) {
  const { isWidgetVisible, preferences } = useDashboardPreferences(companyId);
  const accordionsOpen = preferences.accordionsOpen;

  // Check if any KPI is visible
  const anyKpiVisible = [
    'kpi-sales', 'kpi-purchases', 'kpi-expenses',
    'kpi-receivables', 'kpi-payables', 'kpi-critical-stock', 'kpi-bank-balance',
  ].some(isWidgetVisible);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            {isCurrentMonth ? 'Resumen general de tu empresa' : `Datos de ${periodLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <_DashboardSettingsDialog companyId={companyId} />
          <_MonthsRangeSelector currentRange={monthsRange} />
          <_PeriodSelector currentPeriod={displayPeriod} />
        </div>
      </div>

      {/* KPI Cards */}
      {anyKpiVisible && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
          {isWidgetVisible('kpi-sales') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {isCurrentMonth ? 'Ventas del Mes' : 'Ventas'}
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(kpis.salesThisMonth.total)}</div>
                <p className="text-xs text-muted-foreground">
                  {kpis.salesThisMonth.count} factura{kpis.salesThisMonth.count !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-purchases') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {isCurrentMonth ? 'Compras del Mes' : 'Compras'}
                </CardTitle>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(kpis.purchasesThisMonth.total)}</div>
                <p className="text-xs text-muted-foreground">
                  {kpis.purchasesThisMonth.count} factura{kpis.purchasesThisMonth.count !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-expenses') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {isCurrentMonth ? 'Gastos del Mes' : 'Gastos'}
                </CardTitle>
                <Receipt className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(kpis.expensesThisMonth.total)}</div>
                <p className="text-xs text-muted-foreground">
                  {kpis.expensesThisMonth.count} gasto{kpis.expensesThisMonth.count !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-receivables') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pendiente de Cobro</CardTitle>
                <ArrowDownCircle className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">
                  {formatCurrency(kpis.pendingReceivables.total)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {kpis.pendingReceivables.count} documento
                  {kpis.pendingReceivables.count !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-payables') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pendiente de Pago</CardTitle>
                <ArrowUpCircle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {formatCurrency(kpis.pendingPayables.total)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {kpis.pendingPayables.count} documento{kpis.pendingPayables.count !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-critical-stock') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Stock Critico</CardTitle>
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${kpis.criticalStockCount > 0 ? 'text-yellow-600' : ''}`}
                >
                  {kpis.criticalStockCount}
                </div>
                <p className="text-xs text-muted-foreground">
                  producto{kpis.criticalStockCount !== 1 ? 's' : ''} bajo minimo
                </p>
              </CardContent>
            </Card>
          )}

          {isWidgetVisible('kpi-bank-balance') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Saldo Bancario</CardTitle>
                <Landmark className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${kpis.bankBalance < 0 ? 'text-red-600' : 'text-green-600'}`}
                >
                  {formatCurrency(kpis.bankBalance)}
                </div>
                <p className="text-xs text-muted-foreground">Cuentas activas</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Profitability Chart */}
      {isWidgetVisible('chart-profitability') && (
        <_ProfitabilityChart data={profitabilityTrend} categories={expenseCategories} period={validPeriod} monthsRange={monthsRange} defaultOpen={accordionsOpen} />
      )}

      {/* Charts Row */}
      {(isWidgetVisible('chart-sales-trend') || isWidgetVisible('chart-purchases-trend')) && (
        <div className="grid gap-4 md:grid-cols-2">
          {isWidgetVisible('chart-sales-trend') && <_SalesTrendChart data={salesTrend} defaultOpen={accordionsOpen} />}
          {isWidgetVisible('chart-purchases-trend') && <_PurchasesTrendChart data={purchasesTrend} defaultOpen={accordionsOpen} />}
        </div>
      )}

      {/* Weekly Sales + Payment Methods */}
      {(isWidgetVisible('chart-weekly-sales') || isWidgetVisible('widget-payment-methods')) && (
        <div className="grid gap-4 md:grid-cols-2">
          {isWidgetVisible('chart-weekly-sales') && <_WeeklySalesChart data={weeklySales} defaultOpen={accordionsOpen} />}
          {isWidgetVisible('widget-payment-methods') && <_PaymentMethodsWidget data={paymentMethods} defaultOpen={accordionsOpen} />}
        </div>
      )}

      {/* Top Debts */}
      {(isWidgetVisible('widget-client-debts') || isWidgetVisible('widget-supplier-debts')) && (
        <div className="grid gap-4 md:grid-cols-2">
          {isWidgetVisible('widget-client-debts') && (
            <_TopDebtsWidget
              title="Top 10 Deudas de Clientes"
              iconVariant="receivable"
              data={topClientDebts}
              emptyMessage="Sin deudas de clientes pendientes"
              defaultOpen={accordionsOpen}
            />
          )}
          {isWidgetVisible('widget-supplier-debts') && (
            <_TopDebtsWidget
              title="Top 10 Deudas de Proveedores"
              iconVariant="payable"
              data={topSupplierDebts}
              emptyMessage="Sin deudas a proveedores pendientes"
              defaultOpen={accordionsOpen}
            />
          )}
        </div>
      )}

      {/* Top Products + Upcoming Due Dates */}
      {(isWidgetVisible('widget-top-products') || isWidgetVisible('widget-due-dates')) && (
        <div className="grid gap-4 md:grid-cols-2">
          {isWidgetVisible('widget-top-products') && <_TopProductsWidget data={topProducts} defaultOpen={accordionsOpen} />}
          {isWidgetVisible('widget-due-dates') && <_UpcomingDueDatesWidget data={upcomingDueDates} defaultOpen={accordionsOpen} />}
        </div>
      )}

      {/* Bottom Row */}
      {(isWidgetVisible('widget-critical-stock') || isWidgetVisible('widget-alerts')) && (
        <div className="grid gap-4 md:grid-cols-2">
          {isWidgetVisible('widget-critical-stock') && <_CriticalStockList products={criticalStock} defaultOpen={accordionsOpen} />}
          {isWidgetVisible('widget-alerts') && <_AlertsList alerts={alerts} defaultOpen={accordionsOpen} />}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit _DashboardGrid**

```bash
git add src/modules/dashboard/components/_DashboardGrid.tsx
git commit -m "feat(dashboard): add _DashboardGrid client component with conditional widget rendering"
```

---

### Task 5: Add `defaultOpen` Prop to All Widget Components

**Files:**
- Modify: `src/modules/dashboard/components/_SalesTrendChart.tsx`
- Modify: `src/modules/dashboard/components/_PurchasesTrendChart.tsx`
- Modify: `src/modules/dashboard/components/_ProfitabilityChart.tsx`
- Modify: `src/modules/dashboard/components/_WeeklySalesChart.tsx`
- Modify: `src/modules/dashboard/components/_PaymentMethodsWidget.tsx`
- Modify: `src/modules/dashboard/components/_TopDebtsWidget.tsx`
- Modify: `src/modules/dashboard/components/_TopProductsWidget.tsx`
- Modify: `src/modules/dashboard/components/_UpcomingDueDatesWidget.tsx`
- Modify: `src/modules/dashboard/components/_CriticalStockList.tsx`
- Modify: `src/modules/dashboard/components/_AlertsList.tsx`

Each widget currently renders `_CollapsibleCard` without passing `defaultOpen`. Add `defaultOpen` prop to each widget's interface and forward it to `_CollapsibleCard`.

**Pattern for each widget** (example with `_SalesTrendChart`):

1. Add `defaultOpen?: boolean` to the props interface
2. Destructure `defaultOpen` from props
3. Pass `defaultOpen={defaultOpen}` to `_CollapsibleCard`

For `_SalesTrendChart`:
```typescript
interface SalesTrendChartProps {
  data: Array<{ month: string; total: number }>;
  defaultOpen?: boolean;  // ADD THIS
}

export function _SalesTrendChart({ data, defaultOpen }: SalesTrendChartProps) {
  return (
    <_CollapsibleCard header={...} defaultOpen={defaultOpen}>
```

Apply the same pattern to ALL 10 widget components listed above. For `_TopDebtsWidget` which has more props:
```typescript
interface TopDebtsWidgetProps {
  title: string;
  iconVariant: 'receivable' | 'payable';
  data: DebtItem[];
  emptyMessage?: string;
  defaultOpen?: boolean;  // ADD THIS
}

export function _TopDebtsWidget({ title, iconVariant, data, emptyMessage = 'Sin deudas pendientes', defaultOpen }: TopDebtsWidgetProps) {
  // ...
  return (
    <_CollapsibleCard header={...} defaultOpen={defaultOpen}>
```

For `_ProfitabilityChart` which has complex props:
```typescript
interface ProfitabilityChartProps {
  data: ProfitabilityData[];
  categories: ExpenseCategory[];
  period?: string;
  monthsRange?: number;
  defaultOpen?: boolean;  // ADD THIS
}

export function _ProfitabilityChart({ data: initialData, categories, period, monthsRange = 6, defaultOpen }: ProfitabilityChartProps) {
  // ... existing logic
  return (
    <_CollapsibleCard header={...} headerRight={...} defaultOpen={defaultOpen}>
```

For `_CriticalStockList`:
```typescript
interface CriticalStockListProps {
  products: CriticalStockProduct[];
  defaultOpen?: boolean;  // ADD THIS
}

export function _CriticalStockList({ products, defaultOpen }: CriticalStockListProps) {
  return (
    <_CollapsibleCard header={...} headerRight={...} defaultOpen={defaultOpen}>
```

- [ ] **Step 1: Add `defaultOpen` prop to all 10 widget components following the pattern above**

- [ ] **Step 2: Commit**

```bash
git add src/modules/dashboard/components/_SalesTrendChart.tsx \
  src/modules/dashboard/components/_PurchasesTrendChart.tsx \
  src/modules/dashboard/components/_ProfitabilityChart.tsx \
  src/modules/dashboard/components/_WeeklySalesChart.tsx \
  src/modules/dashboard/components/_PaymentMethodsWidget.tsx \
  src/modules/dashboard/components/_TopDebtsWidget.tsx \
  src/modules/dashboard/components/_TopProductsWidget.tsx \
  src/modules/dashboard/components/_UpcomingDueDatesWidget.tsx \
  src/modules/dashboard/components/_CriticalStockList.tsx \
  src/modules/dashboard/components/_AlertsList.tsx
git commit -m "feat(dashboard): add defaultOpen prop to all widget components"
```

---

### Task 6: Refactor DashboardContent to Use _DashboardGrid

**Files:**
- Modify: `src/modules/dashboard/DashboardContent.tsx`

- [ ] **Step 1: Refactor DashboardContent**

Replace all the JSX rendering with a single `_DashboardGrid` component. Keep the data fetching in the server component and pass everything as props.

```typescript
// src/modules/dashboard/DashboardContent.tsx
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getActiveCompanyId } from '@/shared/lib/company';
import {
  getDashboardKPIs,
  getSalesTrend,
  getPurchasesTrend,
  getProfitabilityTrend,
  getExpenseCategories,
  getCriticalStockProducts,
  getRecentAlerts,
  getTopClientDebts,
  getTopSupplierDebts,
  getTopSellingProducts,
  getWeeklySalesComparison,
  getPaymentMethodBreakdown,
  getUpcomingDueDates,
} from './actions.server';
import { _DashboardGrid } from './components/_DashboardGrid';
import moment from 'moment';

interface DashboardContentProps {
  period?: string;
  monthsRange?: number;
}

export async function DashboardContent({ period, monthsRange = 6 }: DashboardContentProps) {
  async function Content() {
    const validPeriod = period && moment(period, 'YYYY-MM', true).isValid() ? period : undefined;
    const displayPeriod = validPeriod || moment().format('YYYY-MM');
    const isCurrentMonth = !validPeriod || moment(validPeriod, 'YYYY-MM').isSame(moment(), 'month');
    const periodLabel = moment(displayPeriod, 'YYYY-MM').format('MMMM YYYY');

    const companyId = await getActiveCompanyId();

    const [
      kpis, salesTrend, purchasesTrend, profitabilityTrend, expenseCategories, criticalStock, alerts,
      topClientDebts, topSupplierDebts, topProducts, weeklySales, paymentMethods, upcomingDueDates,
    ] = await Promise.all([
      getDashboardKPIs(validPeriod),
      getSalesTrend(validPeriod, monthsRange),
      getPurchasesTrend(validPeriod, monthsRange),
      getProfitabilityTrend(validPeriod, undefined, monthsRange),
      getExpenseCategories(),
      getCriticalStockProducts(),
      getRecentAlerts(validPeriod),
      getTopClientDebts(),
      getTopSupplierDebts(),
      getTopSellingProducts(),
      getWeeklySalesComparison(),
      getPaymentMethodBreakdown(),
      getUpcomingDueDates(),
    ]);

    return (
      <_DashboardGrid
        companyId={companyId}
        isCurrentMonth={isCurrentMonth}
        periodLabel={periodLabel}
        displayPeriod={displayPeriod}
        monthsRange={monthsRange}
        validPeriod={validPeriod}
        kpis={kpis}
        salesTrend={salesTrend}
        purchasesTrend={purchasesTrend}
        profitabilityTrend={profitabilityTrend}
        expenseCategories={expenseCategories}
        criticalStock={criticalStock}
        alerts={alerts}
        topClientDebts={topClientDebts}
        topSupplierDebts={topSupplierDebts}
        topProducts={topProducts}
        weeklySales={weeklySales}
        paymentMethods={paymentMethods}
        upcomingDueDates={upcomingDueDates}
      />
    );
  }

  return (
    <PermissionGuard module="dashboard" action="view" redirect>
      <Content />
    </PermissionGuard>
  );
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit 2>&1 | grep dashboard`
Expected: No errors from dashboard files

- [ ] **Step 3: Commit**

```bash
git add src/modules/dashboard/DashboardContent.tsx
git commit -m "refactor(dashboard): delegate rendering to _DashboardGrid client component"
```

---

### Task 7: Company Settings Page

**Files:**
- Create: `src/modules/dashboard/features/settings/DashboardSettings.tsx`
- Create: `src/modules/dashboard/features/settings/index.ts`
- Create: `src/app/(core)/dashboard/company/dashboard-settings/page.tsx`

- [ ] **Step 1: Create DashboardSettings server component**

```typescript
// src/modules/dashboard/features/settings/DashboardSettings.tsx
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getActiveCompanyId } from '@/shared/lib/company';
import { _DashboardSettingsDialog } from '../../components/_DashboardSettingsDialog';

export async function DashboardSettings() {
  const companyId = await getActiveCompanyId();

  return (
    <PermissionGuard module="dashboard" action="view" redirect>
      <div className="flex flex-1 flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Configuracion del Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Personaliza que widgets se muestran en tu dashboard y como se comportan los acordeones
          </p>
        </div>
        <_DashboardSettingsInline companyId={companyId} />
      </div>
    </PermissionGuard>
  );
}
```

For the inline version (not a dialog, rendered directly on the page), create a separate component `_DashboardSettingsInline` that extracts the dialog body into a standalone form. This component reuses the same hook and checkbox logic but renders inside a Card instead of a Dialog.

```typescript
// Add to src/modules/dashboard/features/settings/DashboardSettings.tsx
// (below the server component, or in a separate file at
// src/modules/dashboard/features/settings/components/_DashboardSettingsInline.tsx)

'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Switch } from '@/shared/components/ui/switch';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Separator } from '@/shared/components/ui/separator';
import { Label } from '@/shared/components/ui/label';
import { Button } from '@/shared/components/ui/button';
import { RotateCcw } from 'lucide-react';
import { WIDGET_CATEGORIES, getWidgetsByCategory } from '../../constants';
import { useDashboardPreferences } from '../../hooks/useDashboardPreferences';

interface DashboardSettingsInlineProps {
  companyId: string;
}

export function _DashboardSettingsInline({ companyId }: DashboardSettingsInlineProps) {
  const { preferences, toggleWidget, setAccordionsOpen, isWidgetVisible, resetDefaults } =
    useDashboardPreferences(companyId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Preferencias</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Accordion setting */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Iniciar widgets abiertos</Label>
            <p className="text-xs text-muted-foreground">
              Los acordeones de los widgets se abren automaticamente al cargar
            </p>
          </div>
          <Switch
            checked={preferences.accordionsOpen}
            onCheckedChange={setAccordionsOpen}
          />
        </div>

        <Separator />

        {/* Widgets by category */}
        <div className="space-y-4">
          <Label className="text-sm font-medium">Widgets visibles</Label>
          {WIDGET_CATEGORIES.map((category) => {
            const widgets = getWidgetsByCategory(category);
            return (
              <div key={category}>
                <p className="text-sm font-medium text-muted-foreground mb-2">{category}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {widgets.map((widget) => (
                    <label
                      key={widget.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={isWidgetVisible(widget.id)}
                        onCheckedChange={() => toggleWidget(widget.id)}
                      />
                      <span>{widget.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <Separator />

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={resetDefaults} className="gap-1">
            <RotateCcw className="h-3.5 w-3.5" />
            Restaurar valores por defecto
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

Since the server component imports a client component, split into two files:
- `src/modules/dashboard/features/settings/DashboardSettings.tsx` - Server component
- `src/modules/dashboard/features/settings/components/_DashboardSettingsInline.tsx` - Client component

- [ ] **Step 2: Create barrel export**

```typescript
// src/modules/dashboard/features/settings/index.ts
export { DashboardSettings } from './DashboardSettings';
```

- [ ] **Step 3: Create page route**

```typescript
// src/app/(core)/dashboard/company/dashboard-settings/page.tsx
import type { Metadata } from 'next';
import { DashboardSettings } from '@/modules/dashboard/features/settings';

export const metadata: Metadata = {
  title: 'Configuracion del Dashboard',
  description: 'Personaliza tu dashboard',
};

export default function DashboardSettingsPage() {
  return <DashboardSettings />;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/dashboard/features/settings/ \
  src/app/(core)/dashboard/company/dashboard-settings/
git commit -m "feat(dashboard): add company settings page for dashboard preferences"
```

---

### Task 8: Add Sidebar Entry

**Files:**
- Modify: `src/shared/components/layout/_AppSidebar.tsx:336-358`

- [ ] **Step 1: Add "Dashboard" item to General subgroup**

In the `getNavConfig` function, add a new item to the "General" subgroup (after "Documentos"):

```typescript
{
  title: 'General',
  icon: Building2,
  items: [
    {
      title: isSingleMode ? 'Empresa' : 'Empresas',
      href:
        isSingleMode && activeCompanyId
          ? `/dashboard/companies/${activeCompanyId}`
          : '/dashboard/companies',
      module: null,
    },
    {
      title: 'Centros de Costo',
      href: '/dashboard/company/cost-centers',
      module: 'company.cost-centers',
    },
    {
      title: 'Documentos',
      href: '/dashboard/company/documents',
      module: 'company.documents',
    },
    {
      title: 'Dashboard',
      href: '/dashboard/company/dashboard-settings',
      module: null, // Siempre visible - cada usuario configura su propio dashboard
    },
  ],
},
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/components/layout/_AppSidebar.tsx
git commit -m "feat(dashboard): add dashboard settings entry to company sidebar"
```

---

### Task 9: Verify and Test

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -i dashboard
```
Expected: No errors from dashboard files

- [ ] **Step 2: Run lint**

```bash
npm run lint 2>&1 | grep -i dashboard
```
Expected: No lint errors from dashboard files

- [ ] **Step 3: Manual testing checklist**

Run `npm run dev` and verify:
1. Dashboard loads with all widgets visible (default state)
2. Settings gear button appears in dashboard header
3. Clicking gear opens dialog with switch and checkboxes
4. Toggling a checkbox hides/shows the corresponding widget immediately
5. Toggling "Iniciar widgets abiertos" switch changes accordion default state
6. Clicking "Restaurar valores por defecto" shows all widgets again
7. Navigating to Empresa > General > Dashboard shows the same settings inline
8. Refreshing the page preserves the preferences
9. Responsive: dialog checkboxes stack on mobile

- [ ] **Step 4: Final commit if any fixes were needed**
