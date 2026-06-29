import type { Metadata } from 'next';
import { PriceListsList } from '@/modules/commercial/features/products/features/price-lists/list';

export const metadata: Metadata = {
  title: 'Listas de Precios',
  description: 'Gestión de listas de precios y asignación de precios por artículo',
};

interface Props {
  searchParams: Promise<{
    page?: string;
    search?: string;
    pageSize?: string;
  }>;
}

export default async function PriceListsPage({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams;
  return <PriceListsList searchParams={resolvedSearchParams} />;
}
