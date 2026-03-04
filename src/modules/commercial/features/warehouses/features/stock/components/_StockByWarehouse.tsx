'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/shared/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Package } from 'lucide-react';
import type { Warehouse, WarehouseStock } from '../../../shared/types';
import { AdjustStockDialog } from './_AdjustStockDialog';
import { TransferStockDialog } from './_TransferStockDialog';
import { getWarehouseStocks } from '../../list/actions.server';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/shared/components/common/DataTable';
import { getColumns } from '../columns';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface StockByWarehouseProps {
  warehouses: Warehouse[];
  defaultWarehouse?: Warehouse;
  defaultStock: WarehouseStock[];
}

export function StockByWarehouse({
  warehouses,
  defaultWarehouse,
  defaultStock,
}: StockByWarehouseProps) {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(
    defaultWarehouse?.id || ''
  );
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [selectedStock, setSelectedStock] = useState<WarehouseStock | null>(null);
  const { hasPermission } = usePermissions();

  const { data: stocks = defaultStock } = useQuery({
    queryKey: ['warehouse-stocks', selectedWarehouseId],
    queryFn: () => getWarehouseStocks(selectedWarehouseId),
    enabled: Boolean(selectedWarehouseId),
    initialData: selectedWarehouseId === defaultWarehouse?.id ? defaultStock : undefined,
  });

  const selectedWarehouse = warehouses.find(w => w.id === selectedWarehouseId);

  const canAdjustStock = hasPermission('commercial.stock', 'update');
  const canTransferStock = hasPermission('commercial.movements', 'create');

  const columns = useMemo(
    () =>
      getColumns({
        onAdjust: (stock) => {
          setSelectedStock(stock);
          setAdjustDialogOpen(true);
        },
        onTransfer: (stock) => {
          setSelectedStock(stock);
          setTransferDialogOpen(true);
        },
        canAdjust: canAdjustStock,
        canTransfer: canTransferStock,
      }),
    [canAdjustStock, canTransferStock]
  );

  return (
    <div className="space-y-4">
      {/* Warehouse Selector */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un almacén" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>
                  <div className="flex items-center gap-2">
                    <span>{warehouse.name}</span>
                    <span className="text-muted-foreground">({warehouse.code})</span>
                    {!warehouse.isActive && (
                      <Badge variant="secondary" className="ml-2">Inactivo</Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedWarehouse && (
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {stocks.length} producto{stocks.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        )}
      </div>

      {/* Stock Table */}
      {selectedWarehouseId ? (
        stocks.length > 0 ? (
          <DataTable<WarehouseStock>
            columns={columns}
            data={stocks}
            totalRows={stocks.length}
            searchPlaceholder="Buscar productos..."
            tableId="commercial-stock"
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center border rounded-md">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No hay stock en este almacén</p>
            <p className="text-sm text-muted-foreground">
              El almacén está vacío o no tiene productos registrados
            </p>
          </div>
        )
      ) : (
        <div className="flex items-center justify-center py-12 text-muted-foreground border rounded-md">
          Selecciona un almacén para ver su stock
        </div>
      )}

      {/* Dialogs */}
      {selectedStock && (
        <>
          <AdjustStockDialog
            open={adjustDialogOpen}
            onOpenChange={setAdjustDialogOpen}
            stock={selectedStock}
            warehouseId={selectedWarehouseId}
          />
          <TransferStockDialog
            open={transferDialogOpen}
            onOpenChange={setTransferDialogOpen}
            stock={selectedStock}
            warehouses={warehouses.filter(w => w.id !== selectedWarehouseId && w.isActive)}
            fromWarehouseId={selectedWarehouseId}
          />
        </>
      )}
    </div>
  );
}
