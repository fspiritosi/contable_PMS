import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { getStockMovements, getStockMovementsPaginated } from '../list/actions.server';
import { getWarehousesForSelect, getStockProductsForSelect } from './actions.server';
import { _MovementsTable } from './components/_MovementsTable';
import { MovementFilters } from './components/_MovementFilters';
import { MovementsSummary } from './components/_MovementsSummary';
import { _MovementActions } from './components/_MovementActions';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

interface StockMovementsProps {
  searchParams?: DataTableSearchParams & {
    warehouseId?: string;
    productId?: string;
    type?: string;
    dateFrom?: string;
    dateTo?: string;
  };
}

export async function StockMovements({ searchParams = {} }: StockMovementsProps) {
  const filters = {
    warehouseId: searchParams?.warehouseId,
    productId: searchParams?.productId,
    type: searchParams?.type,
    dateFrom: searchParams?.dateFrom ? new Date(searchParams.dateFrom) : undefined,
    dateTo: searchParams?.dateTo ? new Date(searchParams.dateTo) : undefined,
  };

  // Fetch data in parallel
  const [allMovements, paginatedResult, warehouses, products] = await Promise.all([
    getStockMovements(filters),
    getStockMovementsPaginated(searchParams, filters),
    getWarehousesForSelect(),
    getStockProductsForSelect(),
  ]);

  return (
    <PermissionGuard module="commercial.movements" action="view" redirect>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Movimientos de Stock</h1>
          <p className="text-muted-foreground">
            Historial completo de todos los movimientos de inventario
          </p>
        </div>
        <_MovementActions warehouses={warehouses} products={products} />
      </div>

      {/* Summary Statistics */}
      {allMovements.length > 0 && <MovementsSummary movements={allMovements} />}

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>
            Filtra los movimientos por almacén, ítem, tipo y fechas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MovementFilters />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de Movimientos</CardTitle>
          <CardDescription>
            Total: {paginatedResult.total} movimientos encontrados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <_MovementsTable
            data={paginatedResult.data}
            totalRows={paginatedResult.total}
            searchParams={searchParams}
          />
        </CardContent>
      </Card>
    </div>
    </PermissionGuard>
  );
}
