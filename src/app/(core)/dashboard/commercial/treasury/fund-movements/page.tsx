import type { Metadata } from 'next';
import { FundMovementsList } from '@/modules/commercial/features/treasury/features/fund-movements';

export const metadata: Metadata = {
  title: 'Movimientos de Fondos',
};

interface Props {
  searchParams: Promise<{
    page?: string;
    pageSize?: string;
  }>;
}

export default async function FundMovementsPage({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams;
  return <FundMovementsList searchParams={resolvedSearchParams} />;
}
