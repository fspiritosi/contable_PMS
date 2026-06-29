import type { Metadata } from 'next';
import { EquivalencesList } from '@/modules/commercial/features/products/features/equivalences';

export const metadata: Metadata = {
  title: 'Equivalencias',
  description: 'Grupos de artículos equivalentes',
};

interface Props {
  searchParams: Promise<{
    page?: string;
    search?: string;
    pageSize?: string;
  }>;
}

export default async function EquivalencesPage({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams;
  return <EquivalencesList searchParams={resolvedSearchParams} />;
}
