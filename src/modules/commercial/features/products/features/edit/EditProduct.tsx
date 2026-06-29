import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getProductById } from '../list/actions.server';
import { getCategories } from '../categories/actions.server';
import { _EditProductForm } from './components/_EditProductForm';
import { notFound } from 'next/navigation';
import {
  getAccountsForProductSelect,
  getCostCentersForProductSelect,
  getWarehousesForProductSelect,
  getSuppliersForProductSelect,
} from '../../shared/catalog-actions.server';

interface EditProductProps {
  productId: string;
}

export async function EditProduct({ productId }: EditProductProps) {
  const [product, categories, accounts, costCenters, warehouses, suppliers] =
    await Promise.all([
      getProductById(productId),
      getCategories(),
      getAccountsForProductSelect(),
      getCostCentersForProductSelect(),
      getWarehousesForProductSelect(),
      getSuppliersForProductSelect(),
    ]);

  if (!product) {
    notFound();
  }

  return (
    <PermissionGuard module="commercial.products" action="update" redirect>
      <div className="flex flex-1 flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Editar Artículo</h1>
          <p className="text-sm text-muted-foreground">
            Modifica la información de: {product.name}
          </p>
        </div>

        <_EditProductForm
          product={product}
          categories={categories}
          accounts={accounts}
          costCenters={costCenters}
          warehouses={warehouses}
          suppliers={suppliers}
        />
      </div>
    </PermissionGuard>
  );
}
