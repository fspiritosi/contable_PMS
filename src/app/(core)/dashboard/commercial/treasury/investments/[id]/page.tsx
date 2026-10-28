import type { Metadata } from 'next';

import { InvestmentHoldingDetail } from '@/modules/commercial/features/treasury/features/investments';

export const metadata: Metadata = {
  title: 'Detalle de tenencia',
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function InvestmentHoldingPage({ params }: Props) {
  const { id } = await params;
  return <InvestmentHoldingDetail holdingId={id} />;
}
