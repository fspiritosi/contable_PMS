import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import {
  ShoppingCart,
  Package,
  Settings,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Factory,
  AlertTriangle,
} from 'lucide-react';
import type { StockMovement } from '../../../shared/types';
import { STOCK_MOVEMENT_TYPE_LABELS } from '../../../shared/types';

interface MovementsSummaryProps {
  movements: StockMovement[];
}

const MOVEMENT_TYPE_ICONS = {
  PURCHASE: ShoppingCart,
  SALE: Package,
  ADJUSTMENT: Settings,
  TRANSFER_OUT: ArrowUp,
  TRANSFER_IN: ArrowDown,
  RETURN: RotateCcw,
  PRODUCTION: Factory,
  LOSS: AlertTriangle,
};

export function MovementsSummary({ movements }: MovementsSummaryProps) {
  // Count by type
  const countByType = movements.reduce((acc, movement) => {
    acc[movement.type] = (acc[movement.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Total quantity moved (absolute values)
  const totalQuantity = movements.reduce((sum, m) => sum + m.quantity, 0);

  // Most active warehouses
  const warehouseCounts = movements.reduce((acc, movement) => {
    const warehouseId = movement.warehouseId;
    const warehouseName = movement.warehouse?.name || 'Desconocido';
    if (!acc[warehouseId]) {
      acc[warehouseId] = { name: warehouseName, count: 0 };
    }
    acc[warehouseId].count++;
    return acc;
  }, {} as Record<string, { name: string; count: number }>);

  const topWarehouses = Object.values(warehouseCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Most moved products
  const productCounts = movements.reduce((acc, movement) => {
    const productId = movement.productId;
    const productName = movement.product?.name || 'Desconocido';
    const productCode = movement.product?.code || '';
    if (!acc[productId]) {
      acc[productId] = { name: productName, code: productCode, count: 0, quantity: 0 };
    }
    acc[productId].count++;
    acc[productId].quantity += movement.quantity;
    return acc;
  }, {} as Record<string, { name: string; code: string; count: number; quantity: number }>);

  const topProducts = Object.values(productCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* Summary Cards by Type */}
      <Card className="md:col-span-2 lg:col-span-3">
        <CardHeader>
          <CardTitle>Resumen por Tipo de Movimiento</CardTitle>
          <CardDescription>
            Distribución de {movements.length} movimientos totales
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Object.entries(countByType).map(([type, count]) => {
              const Icon = MOVEMENT_TYPE_ICONS[type as keyof typeof MOVEMENT_TYPE_ICONS];
              const label = STOCK_MOVEMENT_TYPE_LABELS[type as keyof typeof STOCK_MOVEMENT_TYPE_LABELS];

              return (
                <div key={type} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="rounded-md bg-muted p-2">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{count}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Top Warehouses */}
      <Card>
        <CardHeader>
          <CardTitle>Almacenes Más Activos</CardTitle>
          <CardDescription>Por cantidad de movimientos</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topWarehouses.length > 0 ? (
              topWarehouses.map((warehouse, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                      {index + 1}
                    </div>
                    <span className="font-medium">{warehouse.name}</span>
                  </div>
                  <Badge variant="secondary">{warehouse.count}</Badge>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Sin datos</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Top Products */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Ítems Más Movidos</CardTitle>
          <CardDescription>Por cantidad de transacciones</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topProducts.length > 0 ? (
              topProducts.map((product, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                      {index + 1}
                    </div>
                    <div>
                      <div className="font-medium">{product.name}</div>
                      <div className="text-xs text-muted-foreground">{product.code}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant="secondary">{product.count} mov.</Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {product.quantity.toLocaleString()} unidades
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Sin datos</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
