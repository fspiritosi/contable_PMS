import type { Metadata } from 'next';

import { PriceIndexDetail } from '@/modules/company/features/price-indexes/detail';

export const metadata: Metadata = {
  title: 'Detalle de Índice de Precios',
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <PriceIndexDetail indexId={id} />;
}
