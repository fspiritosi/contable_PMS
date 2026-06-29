'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { _ProductForm } from './_ProductForm';
import { createProduct } from '../../list/actions.server';
import type { CreateProductFormData } from '../../../shared/validators';
import type { ProductCategory } from '../../../shared/types';
import { logger } from '@/shared/lib/logger';

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

interface CreateProductFormProps {
  categories: ProductCategory[];
  accounts?: AccountOption[];
  costCenters?: CostCenterOption[];
  warehouses?: WarehouseOption[];
  suppliers?: SupplierOption[];
}

export function _CreateProductForm({
  categories,
  accounts = [],
  costCenters = [],
  warehouses = [],
  suppliers = [],
}: CreateProductFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: CreateProductFormData) => {
    setIsSubmitting(true);
    try {
      await createProduct(data);
      toast.success('Artículo creado correctamente');
      router.push('/dashboard/commercial/products');
      router.refresh();
    } catch (error) {
      logger.error('Error al crear artículo', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al crear artículo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <_ProductForm
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      submitLabel="Crear Artículo"
      categories={categories}
      accounts={accounts}
      costCenters={costCenters}
      warehouses={warehouses}
      suppliers={suppliers}
    />
  );
}
