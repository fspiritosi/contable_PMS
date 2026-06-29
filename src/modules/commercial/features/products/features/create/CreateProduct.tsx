import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getCategories } from '../categories/actions.server';
import { _CreateProductForm } from './components/_CreateProductForm';
import {
  getAccountsForProductSelect,
  getCostCentersForProductSelect,
  getWarehousesForProductSelect,
  getSuppliersForProductSelect,
} from '../../shared/catalog-actions.server';

export async function CreateProduct() {
  const [categories, accounts, costCenters, warehouses, suppliers] =
    await Promise.all([
      getCategories(),
      getAccountsForProductSelect(),
      getCostCentersForProductSelect(),
      getWarehousesForProductSelect(),
      getSuppliersForProductSelect(),
    ]);

  return (
    <PermissionGuard module="commercial.products" action="create" redirect>
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Nuevo Artículo</h1>
        <p className="text-sm text-muted-foreground">
          Crea un nuevo artículo o servicio
        </p>
      </div>

      <_CreateProductForm
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
