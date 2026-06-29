'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, Package, Scale, TrendingDown } from 'lucide-react';
import Link from 'next/link';

import { useIndustry } from '@/providers/IndustryProvider';
import { Badge } from '@/shared/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { getEquivalenceById, getSupplierPriceComparison } from '../actions.server';
import { _PriceComparisonView } from './_PriceComparisonView';

interface EquivalenceDetailModalProps {
  groupId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function _EquivalenceDetailModal({
  groupId,
  open,
  onOpenChange,
}: EquivalenceDetailModalProps) {
  const { isFeatureAvailable } = useIndustry();
  const showPriceComparison = isFeatureAvailable('products.compare-prices');
  const [activeTab, setActiveTab] = useState('products');

  const { data: group, isLoading } = useQuery({
    queryKey: ['equivalence-detail', groupId],
    queryFn: () => getEquivalenceById(groupId!),
    enabled: !!groupId && open,
  });

  const { data: comparison, isLoading: isLoadingComparison } = useQuery({
    queryKey: ['equivalence-price-comparison', groupId],
    queryFn: () => getSupplierPriceComparison(groupId!),
    enabled: !!groupId && open && showPriceComparison && activeTab === 'prices',
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {isLoading ? (
              <Skeleton className="h-6 w-48" />
            ) : (
              group?.name ?? 'Grupo de Equivalencia'
            )}
          </DialogTitle>
          <DialogDescription>
            {group?.oemCode && (
              <span className="font-mono">OEM: {group.oemCode}</span>
            )}
            {group?.notes && (
              <span className="block mt-1">{group.notes}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : group ? (
          <div className="space-y-4">
            {/* Resumen */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{group.products.length}</p>
                <p className="text-xs text-muted-foreground">Artículos</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{group.totalStock}</p>
                <p className="text-xs text-muted-foreground">Stock Total</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold text-green-600">
                  {group.bestPrice != null ? `$${group.bestPrice.toFixed(2)}` : '-'}
                </p>
                <p className="text-xs text-muted-foreground">Mejor Precio</p>
              </div>
            </div>

            {showPriceComparison ? (
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="products">
                    <Package className="h-4 w-4 mr-1" />
                    Artículos
                  </TabsTrigger>
                  <TabsTrigger value="prices">
                    <Scale className="h-4 w-4 mr-1" />
                    Comparar Precios
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="products" className="mt-4">
                  <ProductsTable products={group.products} bestPrice={group.bestPrice} />
                </TabsContent>
                <TabsContent value="prices" className="mt-4">
                  <_PriceComparisonView
                    products={comparison?.products ?? []}
                    isLoading={isLoadingComparison}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              <ProductsTable products={group.products} bestPrice={group.bestPrice} />
            )}
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-4">
            Grupo no encontrado
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Sub-component: Products table (extracted for reuse between tabbed/non-tabbed)
// ============================================================================

interface ProductRow {
  id: string;
  code: string;
  name: string;
  brand: string | null;
  salePrice: number;
  oemCode: string | null;
  currentStock: number;
  status: string;
}

function ProductsTable({
  products,
  bestPrice,
}: {
  products: ProductRow[];
  bestPrice: number | null;
}) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <Package className="h-8 w-8" />
        <p className="text-sm">No hay artículos en este grupo</p>
        <p className="text-xs">
          Asigná artículos desde la edición de cada artículo
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-[400px] overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Artículo</TableHead>
            <TableHead>Marca</TableHead>
            <TableHead className="text-right">Precio Venta</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            const isBestPrice =
              bestPrice != null &&
              product.salePrice === bestPrice &&
              product.status === 'ACTIVE';

            return (
              <TableRow key={product.id}>
                <TableCell className="font-mono text-sm">
                  <Link
                    href={`/dashboard/commercial/products/${product.id}`}
                    className="hover:underline"
                  >
                    {product.code}
                  </Link>
                </TableCell>
                <TableCell>
                  <div>
                    <span className="font-medium">{product.name}</span>
                    {product.oemCode && (
                      <p className="text-xs text-muted-foreground">
                        OEM: {product.oemCode}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {product.brand || '-'}
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={
                      isBestPrice
                        ? 'font-semibold text-green-600'
                        : ''
                    }
                  >
                    ${product.salePrice.toFixed(2)}
                    {isBestPrice && (
                      <TrendingDown className="inline ml-1 h-3 w-3" />
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {product.currentStock}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      product.status === 'ACTIVE'
                        ? 'default'
                        : 'secondary'
                    }
                  >
                    {product.status === 'ACTIVE'
                      ? 'Activo'
                      : product.status === 'INACTIVE'
                        ? 'Inactivo'
                        : 'Discontinuado'}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
