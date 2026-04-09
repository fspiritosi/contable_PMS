import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getProductById } from '../list/actions.server';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Pencil, AlertTriangle } from 'lucide-react';
import { BackButton } from '@/shared/components/common/BackButton';
import {
  PRODUCT_TYPE_LABELS,
  PRODUCT_STATUS_LABELS,
  UNIT_OF_MEASURE_LABELS,
  getStockLevel,
} from '../../shared/types';

interface ProductDetailProps {
  productId: string;
}

export async function ProductDetail({ productId }: ProductDetailProps) {
  const product = await getProductById(productId);

  if (!product) {
    notFound();
  }

  return (
    <PermissionGuard module="commercial.products" action="view" redirect>
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold">{product.name}</h1>
            <p className="text-sm text-muted-foreground">Código: {product.code}</p>
          </div>
        </div>
        <Link href={`/dashboard/commercial/products/${product.id}/edit`}>
          <Button>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
        </Link>
      </div>

      {/* Alerta de stock bajo */}
      {(() => {
        const level = getStockLevel(product);
        if (level === 'out') {
          return (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Sin stock.</strong> Este producto no tiene unidades disponibles.
                Stock mínimo configurado: {product.minStock || 0}.
              </AlertDescription>
            </Alert>
          );
        }
        if (level === 'critical') {
          return (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Stock crítico.</strong> El stock actual ({product.currentStock ?? 0}) está por debajo
                del mínimo configurado ({product.minStock || 0}). Déficit: {(product.minStock || 0) - (product.currentStock ?? 0)} unidades.
              </AlertDescription>
            </Alert>
          );
        }
        if (level === 'warning') {
          return (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Stock bajo.</strong> El stock actual ({product.currentStock ?? 0}) está cerca
                del mínimo configurado ({product.minStock || 0}).
              </AlertDescription>
            </Alert>
          );
        }
        return null;
      })()}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Información Básica */}
        <Card>
          <CardHeader>
            <CardTitle>Información Básica</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Tipo</p>
              <Badge variant={product.type === 'PRODUCT' ? 'default' : 'secondary'}>
                {PRODUCT_TYPE_LABELS[product.type]}
              </Badge>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">Categoría</p>
              <p className="text-sm">
                {product.category ? product.category.name : 'Sin categoría'}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">Descripción</p>
              <p className="text-sm">
                {product.description || 'Sin descripción'}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">Unidad de Medida</p>
              <p className="text-sm">
                {product.unitOfMeasure
                  ? UNIT_OF_MEASURE_LABELS[product.unitOfMeasure] || product.unitOfMeasure
                  : 'No especificada'}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">Estado</p>
              <Badge variant={product.status === 'ACTIVE' ? 'default' : 'secondary'}>
                {PRODUCT_STATUS_LABELS[product.status]}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Precios */}
        <Card>
          <CardHeader>
            <CardTitle>Precios e IVA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Precio de Costo</p>
              <p className="text-2xl font-bold">${product.costPrice.toFixed(2)}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">Precio de Venta</p>
              <p className="text-2xl font-bold">${product.salePrice.toFixed(2)}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">IVA</p>
              <p className="text-sm">{product.vatRate}%</p>
            </div>

            <div className="rounded-md bg-muted p-4">
              <p className="text-sm font-medium text-muted-foreground">Precio Final con IVA</p>
              <p className="text-3xl font-bold">${product.salePriceWithTax.toFixed(2)}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">Margen de Ganancia</p>
              <p className="text-sm">
                {product.costPrice > 0
                  ? `${(((product.salePrice - product.costPrice) / product.costPrice) * 100).toFixed(2)}%`
                  : 'N/A'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Control de Stock */}
        <Card>
          <CardHeader>
            <CardTitle>Control de Stock</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Controlar Stock</p>
              <Badge variant={product.trackStock ? 'default' : 'secondary'}>
                {product.trackStock ? 'Sí' : 'No'}
              </Badge>
            </div>

            {product.trackStock && (
              <>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Stock Actual</p>
                  {(() => {
                    const level = getStockLevel(product);
                    const stockValue = product.currentStock ?? 0;
                    if (level === 'out' || level === 'critical') {
                      return <p className="text-2xl font-bold text-destructive">{stockValue}</p>;
                    }
                    if (level === 'warning') {
                      return <p className="text-2xl font-bold text-yellow-600">{stockValue}</p>;
                    }
                    return <p className="text-2xl font-bold">{stockValue}</p>;
                  })()}
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">Stock Mínimo</p>
                  <p className="text-sm">{product.minStock || 0}</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">Stock Máximo</p>
                  <p className="text-sm">{product.maxStock || 'Sin límite'}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Información Adicional */}
        <Card>
          <CardHeader>
            <CardTitle>Información Adicional</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Código de Barras</p>
              <p className="text-sm">{product.barcode || 'No especificado'}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">Código Interno</p>
              <p className="text-sm">{product.internalCode || 'No especificado'}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">Marca</p>
              <p className="text-sm">{product.brand || 'No especificada'}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">Modelo</p>
              <p className="text-sm">{product.model || 'No especificado'}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    </PermissionGuard>
  );
}
