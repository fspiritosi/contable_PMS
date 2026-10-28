import type { Metadata } from 'next';

import { InvestmentValuation } from '@/modules/commercial/features/treasury/features/investments';

export const metadata: Metadata = {
  title: 'Valuación de inversiones',
};

export default function InvestmentValuationPage() {
  return <InvestmentValuation />;
}
