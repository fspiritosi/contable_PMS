'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { _ProductForm } from '../../create/components/_ProductForm';
import { updateProduct } from '../../list/actions.server';
import type { UpdateProductFormData } from '../../../shared/validators';
import type { Product, ProductCategory } from '../../../shared/types';
import { logger } from '@/shared/lib/logger';

interface EquivalenceOption {
  id: string;
  name: string;
}

interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
  nature: string;
}

interface CostCenterOption {
  id: string;
  name: string;
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

interface SupplierOption {
  id: string;
  code: string;
  businessName: string;
  tradeName: string | null;
}

interface EditProductFormProps {
  product: Product;
  categories: ProductCategory[];
  equivalences?: EquivalenceOption[];
  accounts?: AccountOption[];
  costCenters?: CostCenterOption[];
  warehouses?: WarehouseOption[];
  suppliers?: SupplierOption[];
}

export function _EditProductForm({
  product,
  categories,
  equivalences = [],
  accounts = [],
  costCenters = [],
  warehouses = [],
  suppliers = [],
}: EditProductFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: UpdateProductFormData) => {
    setIsSubmitting(true);
    try {
      await updateProduct(product.id, data);
      toast.success('Artículo actualizado correctamente');
      router.push('/dashboard/commercial/products');
      router.refresh();
    } catch (error) {
      logger.error('Error al actualizar artículo', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al actualizar artículo');
    } finally {
      setIsSubmitting(false);
    }
  };

  const defaultValues: UpdateProductFormData = {
    name: product.name,
    description: product.description || '',
    type: product.type,
    usage: product.usage,
    categoryId: product.categoryId || undefined,
    unitOfMeasure: product.unitOfMeasure,
    costPrice: product.costPrice,
    profitMargin: product.profitMargin || 0,
    salePrice: product.salePrice,
    vatRate: product.vatRate,
    trackStock: product.trackStock,
    minStock: product.minStock || 0,
    maxStock: product.maxStock || undefined,
    barcode: product.barcode || '',
    internalCode: product.internalCode || '',
    brand: product.brand || '',
    model: product.model || '',
    oemCode: product.oemCode || '',
    auxiliaryCode: product.auxiliaryCode || '',
    productGroupId: product.productGroupId || undefined,
    defaultExpenseAccountId: product.defaultExpenseAccountId || undefined,
    defaultIncomeAccountId: product.defaultIncomeAccountId || undefined,
    defaultCostCenterId: product.defaultCostCenterId || undefined,
    defaultWarehouseId: product.defaultWarehouseId || undefined,
    defaultSupplierId: product.defaultSupplierId || undefined,
    status: product.status,
  };

  return (
    <_ProductForm
      defaultValues={defaultValues}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      submitLabel="Guardar Cambios"
      categories={categories}
      equivalences={equivalences}
      accounts={accounts}
      costCenters={costCenters}
      warehouses={warehouses}
      suppliers={suppliers}
      showStatus
    />
  );
}
