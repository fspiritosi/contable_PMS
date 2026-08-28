import {
  getSuppliersForSelect,
  getProductsForSelect,
  getCostCentersForSelect,
  getPurchasesDefaultAccountType,
} from '../list/actions.server';
import { _PurchaseInvoiceForm } from './components/_PurchaseInvoiceForm';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

export async function CreatePurchaseInvoice() {
  const [suppliers, products, costCenters, defaultAccountType] = await Promise.all([
    getSuppliersForSelect(),
    getProductsForSelect(),
    getCostCentersForSelect(),
    getPurchasesDefaultAccountType(),
  ]);

  return (
    <PermissionGuard module="commercial.purchases" action="create" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nueva Factura de Compra</h1>
          <p className="text-muted-foreground">
            Registra una nueva factura de compra de un proveedor
          </p>
        </div>

        <_PurchaseInvoiceForm
          suppliers={suppliers}
          products={products}
          costCenters={costCenters}
          defaultAccountType={defaultAccountType}
        />
      </div>
    </PermissionGuard>
  );
}
