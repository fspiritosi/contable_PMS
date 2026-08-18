import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getSupplierById } from '../list/actions.server';
import { getSupplierAccountStatement, getSupplierProducts } from './actions.server';
import { _SupplierDetailContent } from './components/_SupplierDetailContent';
import { _SupplierAccountStatementTab } from './components/_SupplierAccountStatementTab';
import { _SupplierProductsTab } from './components/_SupplierProductsTab';
import { notFound } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

interface SupplierDetailProps {
  supplierId: string;
}

export async function SupplierDetail({ supplierId }: SupplierDetailProps) {
  const [supplier, accountStatement, supplierProducts] = await Promise.all([
    getSupplierById(supplierId),
    getSupplierAccountStatement(supplierId),
    getSupplierProducts(supplierId),
  ]);

  if (!supplier) {
    notFound();
  }

  return (
    <PermissionGuard module="commercial.suppliers" action="view" redirect>
      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="general">Información General</TabsTrigger>
          <TabsTrigger value="products">Ítems</TabsTrigger>
          <TabsTrigger value="account">Cuenta Corriente</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6">
          <_SupplierDetailContent supplier={supplier} />
        </TabsContent>

        <TabsContent value="products" className="mt-6">
          <_SupplierProductsTab supplierId={supplierId} initialProducts={supplierProducts} />
        </TabsContent>

        <TabsContent value="account" className="mt-6">
          <_SupplierAccountStatementTab accountStatement={accountStatement} />
        </TabsContent>
      </Tabs>
    </PermissionGuard>
  );
}
