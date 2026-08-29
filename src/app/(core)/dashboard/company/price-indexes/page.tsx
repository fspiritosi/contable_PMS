import type { Metadata } from 'next';

import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PriceIndexesPage } from '@/modules/company/features/price-indexes';

export const metadata: Metadata = {
  title: 'Índices de Precios',
};

interface Props {
  searchParams: Promise<DataTableSearchParams>;
}

export default async function Page({ searchParams }: Props) {
  const params = await searchParams;
  return <PriceIndexesPage searchParams={params} />;
}
