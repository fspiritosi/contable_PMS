# Modulo Dashboard

**Ruta:** `/dashboard`
**Archivos:** `src/modules/dashboard/`

---

## KPIs

El dashboard muestra 7 tarjetas KPI para el mes seleccionado (cada una se puede ocultar desde la configuración del dashboard):

| KPI | Descripcion | Color |
|-----|-------------|-------|
| Ventas del Mes | Total facturado + cantidad de facturas (excluye NC) | Verde |
| Compras del Mes | Total comprado + cantidad de facturas (excluye NC) | Azul |
| Gastos del Mes | Total de gastos + cantidad | - |
| Pendiente de Cobro | Facturas de venta pendientes de pago | Naranja |
| Pendiente de Pago | Facturas de compra + gastos pendientes | Rojo |
| Stock Critico | Productos debajo del minimo configurado | Amarillo |
| Saldo Bancario | Saldo consolidado de todas las cuentas bancarias | Verde/Rojo |

### Layout de las tarjetas (TSK-790)

La fila vive en `components/_KpiCards.tsx` y se arma desde una lista de definiciones
(`buildKpis`), filtrada por `isWidgetVisible`.

- **Columnas por ancho disponible, no por breakpoint**: `grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]`.
  El ancho real depende de si el sidebar está abierto, así que los breakpoints de viewport
  (`xl:grid-cols-7`, como estaba antes) dejaban cards de ~128 px y los montos se salían.
- **Monto ajustado al ancho de la card**: `CardContent` es `@container` y el monto usa
  `font-size: min(1.5rem, calc(100cqi / (largo × 0.52)))` (`kpiValueFontSize` en `kpi-fit.ts`).
  El largo es el del monto más largo de la fila, para que todos se vean del mismo tamaño.
  `whitespace-nowrap` evita que un monto se parta en dos líneas y el `title` muestra el valor al pasar el mouse.
- Verificación en navegador: `scripts/guia-presentacion/capturas-tsk790.mjs` (1280, 1440, 1920 y 375 px,
  con montos reales y forzados a 12 cifras).

## Graficos

- **Tendencia de Ventas** - Bar chart de los ultimos 6 meses (Recharts)
- **Tendencia de Compras** - Bar chart de los ultimos 6 meses (Recharts)

Ambos excluyen notas de credito y solo consideran facturas CONFIRMED/PAID/PARTIAL_PAID.

## Secciones Inferiores

- **Stock Critico** - Top 10 productos con stock por debajo del minimo, ordenados por % de stock (peor primero). Siempre muestra datos actuales independientemente del periodo.
- **Alertas** - Hasta 8 alertas: facturas de venta vencidas, facturas de compra vencidas, gastos vencidos.

## Filtro de Periodo

El dashboard acepta un parametro `?month=YYYY-MM` en la URL para ver datos historicos.

- Selector con mes y ano
- Botones de navegacion (mes anterior/siguiente)
- Boton "Hoy" para volver al mes actual
- Componente: `_PeriodSelector.tsx`

Para periodos historicos, el corte es al fin del mes seleccionado. Para el mes actual, el corte es hoy.

## Server Actions

| Funcion | Parametros | Descripcion |
|---------|-----------|-------------|
| `getDashboardKPIs` | `period?: string` | 7 KPIs del mes |
| `getSalesTrend` | `period?: string` | 6 meses de ventas |
| `getPurchasesTrend` | `period?: string` | 6 meses de compras |
| `getCriticalStockProducts` | - | Top 10 stock critico (siempre actual) |
| `getRecentAlerts` | `period?: string` | Hasta 8 alertas de vencimiento |
