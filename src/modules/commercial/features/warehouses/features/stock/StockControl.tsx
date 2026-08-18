import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { getWarehouses, getWarehouseStocks } from '../list/actions.server';
import { StockByWarehouse } from './components/_StockByWarehouse';
import { StockByProduct } from './components/_StockByProduct';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

export async function StockControl() {
  const warehouses = await getWarehouses();

  // Get all warehouses for the dropdown
  const allWarehouses = warehouses.data;

  // Get stock for the first active warehouse as default
  const defaultWarehouse = allWarehouses.find(w => w.isActive) || allWarehouses[0];
  const defaultStock = defaultWarehouse ? await getWarehouseStocks(defaultWarehouse.id) : [];

  return (
    <PermissionGuard module="commercial.stock" action="view" redirect>
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Control de Stock</h1>
        <p className="text-muted-foreground">
          Gestiona el inventario, realiza ajustes y transferencias
        </p>
      </div>

      <Tabs defaultValue="by-warehouse" className="space-y-4">
        <TabsList>
          <TabsTrigger value="by-warehouse">Por Almacén</TabsTrigger>
          <TabsTrigger value="by-product">Por Ítem</TabsTrigger>
        </TabsList>

        <TabsContent value="by-warehouse" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Stock por Almacén</CardTitle>
              <CardDescription>
                Visualiza y gestiona el stock de cada almacén
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StockByWarehouse
                warehouses={allWarehouses}
                defaultWarehouse={defaultWarehouse}
                defaultStock={defaultStock}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-product" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Stock por Ítem</CardTitle>
              <CardDescription>
                Visualiza la distribución de stock de cada ítem en todos los almacenes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StockByProduct />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </PermissionGuard>
  );
}
