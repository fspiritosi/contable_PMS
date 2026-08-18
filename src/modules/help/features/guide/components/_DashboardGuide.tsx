'use client';

import {
  AlertTriangle,
  BarChart3,
  Calendar,
  DollarSign,
  Info,
  TrendingUp,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Separator } from '@/shared/components/ui/separator';

export function _DashboardGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Dashboard</h2>
        <p className="text-muted-foreground">
          Panel principal con indicadores clave y alertas de tu negocio
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Indicadores Clave (KPIs)
          </CardTitle>
          <CardDescription>
            Resumen financiero del período seleccionado
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>El dashboard muestra 6 indicadores principales:</p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Ventas del período</strong>: total facturado a clientes
            </li>
            <li>
              <strong>Compras del período</strong>: total facturado por
              proveedores
            </li>
            <li>
              <strong>Cobros realizados</strong>: total de recibos confirmados
            </li>
            <li>
              <strong>Pagos realizados</strong>: total de órdenes de pago
              confirmadas
            </li>
            <li>
              <strong>Stock crítico</strong>: ítems con stock bajo mínimo
            </li>
            <li>
              <strong>Saldo bancario</strong>: suma de todas las cuentas activas
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Filtro de Período
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>Puedes filtrar los datos del dashboard por mes y año:</p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>Selecciona el <strong>mes</strong> en el selector superior</li>
            <li>Selecciona el <strong>año</strong> junto al mes</li>
            <li>Los KPIs y gráficos se actualizan automáticamente</li>
          </ol>
          <p className="text-sm text-muted-foreground">
            Por defecto muestra el mes y año actual.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Rentabilidad Mensual
          </CardTitle>
          <CardDescription>
            Analiza la rentabilidad de tu negocio mes a mes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            El grafico de rentabilidad muestra la evolucion de los ultimos 6
            meses con barras para Ventas, Compras y Gastos, y una linea para la
            Rentabilidad neta (Ventas - Compras - Gastos).
          </p>
          <p>
            <strong>Filtro por tipos de gasto:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Haz clic en el boton <strong>Tipos de gasto</strong> para abrir el
              filtro
            </li>
            <li>
              Desmarca las categorias de gastos que no quieras incluir en el
              calculo
            </li>
            <li>
              El grafico se actualiza automaticamente al cambiar la seleccion
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Esto te permite ver la rentabilidad excluyendo ciertos tipos de
            gastos (por ejemplo, gastos extraordinarios) para tener una vision
            mas precisa.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Graficos de Tendencia
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Debajo del grafico de rentabilidad se muestran graficos individuales
            con la evolucion de los ultimos 6 meses:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Tendencia de Ventas</strong>: evolucion mensual de facturacion
            </li>
            <li>
              <strong>Tendencia de Compras</strong>: evolucion mensual de compras
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Pasa el cursor sobre las barras para ver el detalle de cada mes.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Alertas Automáticas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>El sistema genera alertas cuando detecta situaciones que requieren atención:</p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Facturas vencidas</strong>: facturas de venta con fecha de
              vencimiento pasada sin cobrar
            </li>
            <li>
              <strong>Stock bajo</strong>: ítems cuyo stock está por debajo
              del mínimo configurado
            </li>
          </ul>
        </CardContent>
      </Card>

      <Separator />

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Relación con otros módulos:</strong> Los datos del dashboard se
          alimentan automáticamente de los módulos{' '}
          <strong>Comercial</strong> (ventas/compras),{' '}
          <strong>Tesorería</strong> (cobros/pagos/saldos bancarios) y{' '}
          <strong>Almacenes</strong> (stock). Cuanto más completa sea tu
          información en esos módulos, más útil será el dashboard.
        </AlertDescription>
      </Alert>
    </div>
  );
}
