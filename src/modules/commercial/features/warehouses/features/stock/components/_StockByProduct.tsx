'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Badge } from '@/shared/components/ui/badge';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import { Search, Package } from 'lucide-react';
import { getProducts } from '@/modules/commercial/features/products/features/list/actions.server';
import { getProductStock } from '../../list/actions.server';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

export function StockByProduct() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');

  const { data: productsData } = useQuery({
    queryKey: ['products-for-stock'],
    queryFn: () => getProducts(),
  });

  const { data: productStock = [] } = useQuery({
    queryKey: ['product-stock', selectedProductId],
    queryFn: () => getProductStock(selectedProductId),
    enabled: Boolean(selectedProductId),
  });

  const products = productsData?.data || [];

  const filteredProducts = products.filter(
    (product) =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedProduct = products.find(p => p.id === selectedProductId);

  const totalQuantity = productStock.reduce((sum, stock) => sum + stock.quantity, 0);
  const totalReserved = productStock.reduce((sum, stock) => sum + stock.reservedQty, 0);
  const totalAvailable = productStock.reduce((sum, stock) => sum + stock.availableQty, 0);

  return (
    <div className="space-y-4">
      {/* Product Search/Select */}
      <div className="flex gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar ítem por nombre o código..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
      </div>

      {/* Product Selector */}
      {searchTerm && (
        <div className="space-y-2">
          <div className="text-sm font-medium">
            Resultados ({filteredProducts.length})
          </div>
          <Select value={selectedProductId} onValueChange={setSelectedProductId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un ítem" />
            </SelectTrigger>
            <SelectContent>
              {filteredProducts.slice(0, 20).map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{product.code}</span>
                    <span>{product.name}</span>
                  </div>
                </SelectItem>
              ))}
              {filteredProducts.length > 20 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  ... y {filteredProducts.length - 20} más (refina la búsqueda)
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Product Stock Distribution */}
      {selectedProductId ? (
        <div className="space-y-4">
          {/* Product Header */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-muted-foreground">
                    {selectedProduct?.code}
                  </span>
                </div>
                <div className="text-xl font-semibold mt-1">
                  {selectedProduct?.name}
                </div>
              </div>
              <Badge variant="outline">
                {productStock.length} almacén{productStock.length !== 1 ? 'es' : ''}
              </Badge>
            </div>

            {/* Totals */}
            <div className="grid grid-cols-3 gap-4 pt-3 border-t">
              <div>
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="text-2xl font-bold">{totalQuantity.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Reservado</div>
                <div className="text-2xl font-bold text-orange-600">
                  {totalReserved.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Disponible</div>
                <div className="text-2xl font-bold text-green-600">
                  {totalAvailable.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Stock by Warehouse Table */}
          {productStock.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Almacén</TableHead>
                    <TableHead>Ubicación</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Reservado</TableHead>
                    <TableHead className="text-right">Disponible</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productStock.map((stock) => {
                    const warehouse = stock.warehouse;
                    const location = [warehouse?.city, warehouse?.state]
                      .filter(Boolean)
                      .join(', ');

                    return (
                      <TableRow key={stock.id}>
                        <TableCell className="font-mono text-sm">
                          {warehouse?.code || '-'}
                        </TableCell>
                        <TableCell className="font-medium">
                          {warehouse?.name || '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {location || '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {stock.quantity.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-orange-600">
                          {stock.reservedQty.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-green-600">
                          {stock.availableQty.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {stock.availableQty === 0 ? (
                            <Badge variant="secondary">Sin stock</Badge>
                          ) : (
                            <Badge variant="default">Disponible</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center border rounded-md">
              <Package className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Sin stock en almacenes</p>
              <p className="text-sm text-muted-foreground">
                Este ítem no tiene stock registrado en ningún almacén
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center border rounded-md">
          <Search className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-lg font-medium">Busca un ítem</p>
          <p className="text-sm text-muted-foreground">
            Usa el buscador para encontrar un ítem y ver su distribución de stock
          </p>
        </div>
      )}
    </div>
  );
}
