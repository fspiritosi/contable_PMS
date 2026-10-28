import type { Metadata } from 'next';

import { InvestmentsList } from '@/modules/commercial/features/treasury/features/investments';

export const metadata: Metadata = {
  title: 'Inversiones',
};

export default function InvestmentsPage() {
  return <InvestmentsList />;
}
