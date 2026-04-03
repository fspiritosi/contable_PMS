import type { Metadata } from 'next';

import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { DiscountPresetsPage } from '@/modules/company/features/discount-presets';

export const metadata: Metadata = {
  title: 'Descuentos Predefinidos',
};

interface Props {
  searchParams: Promise<DataTableSearchParams>;
}

export default async function Page({ searchParams }: Props) {
  const params = await searchParams;
  return <DiscountPresetsPage searchParams={params} />;
}
