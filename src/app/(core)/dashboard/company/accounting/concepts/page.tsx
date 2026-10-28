import { ConceptsList } from '@/modules/accounting/features/concepts';
import { checkPermission } from '@/shared/lib/permissions';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Conceptos',
};

interface Props {
  searchParams: Promise<{
    page?: string;
    pageSize?: string;
    search?: string;
  }>;
}

export default async function ConceptsPage({ searchParams }: Props) {
  await checkPermission('accounting.concepts', 'view');
  const resolvedSearchParams = await searchParams;
  return <ConceptsList searchParams={resolvedSearchParams} />;
}
