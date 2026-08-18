import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Edit, MapPin, Package, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { getWarehouseById, getWarehouseStocks } from '../list/actions.server';
import { WAREHOUSE_TYPE_LABELS } from '../../shared/types';
import { WarehouseStockTable } from './components/_WarehouseStockTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

interface WarehouseDetailProps {
  warehouseId: string;
}

export async function WarehouseDetail({ warehouseId }: WarehouseDetailProps) {
  const warehouse = await getWarehouseById(warehouseId);
  const stocks = await getWarehouseStocks(warehouseId);

  const totalProducts = stocks.length;
  const totalQuantity = stocks.reduce((sum, stock) => sum + stock.quantity, 0);
  const totalReserved = stocks.reduce((sum, stock) => sum + stock.reservedQty, 0);
  const totalAvailable = stocks.reduce((sum, stock) => sum + stock.availableQty, 0);

  return (
    <PermissionGuard module="commercial.warehouses" action="view" redirect>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{warehouse.name}</h1>
            <Badge variant={warehouse.isActive ? 'default' : 'secondary'}>
              {warehouse.isActive ? 'Activo' : 'Inactivo'}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            Código: {warehouse.code}
          </p>
        </div>
        <Button asChild>
          <Link href={`/dashboard/commercial/warehouses/${warehouseId}/edit`}>
            <Edit className="mr-2 h-4 w-4" />
            Editar
          </Link>
        </Button>
      </div>

      {/* Info Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tipo</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {WAREHOUSE_TYPE_LABELS[warehouse.type]}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ítems</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProducts}</div>
            <p className="text-xs text-muted-foreground">
              Cantidad total: {totalQuantity.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Disponible</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {totalAvailable.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              Para venta o transferencia
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reservado</CardTitle>
            <TrendingDown className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {totalReserved.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              Comprometido en operaciones
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Warehouse Details */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Information */}
        <Card>
          <CardHeader>
            <CardTitle>Información General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Código</p>
              <p className="text-lg">{warehouse.code}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Nombre</p>
              <p className="text-lg">{warehouse.name}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Tipo</p>
              <p className="text-lg">{WAREHOUSE_TYPE_LABELS[warehouse.type]}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Estado</p>
              <Badge variant={warehouse.isActive ? 'default' : 'secondary'}>
                {warehouse.isActive ? 'Activo' : 'Inactivo'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Location */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Ubicación
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {warehouse.address || warehouse.city || warehouse.state ? (
              <>
                {warehouse.address && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Dirección</p>
                    <p className="text-lg">{warehouse.address}</p>
                  </div>
                )}
                {warehouse.city && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Ciudad</p>
                    <p className="text-lg">{warehouse.city}</p>
                  </div>
                )}
                {warehouse.state && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Provincia/Estado</p>
                    <p className="text-lg">{warehouse.state}</p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No se especificó ubicación</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stock Table */}
      <Card>
        <CardHeader>
          <CardTitle>Stock del Almacén</CardTitle>
          <CardDescription>
            Ítems disponibles en este almacén con sus cantidades
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WarehouseStockTable stocks={stocks} />
        </CardContent>
      </Card>
    </div>
    </PermissionGuard>
  );
}
