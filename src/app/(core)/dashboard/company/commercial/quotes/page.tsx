import type { Metadata } from 'next';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { QuotesList } from '@/modules/commercial';

export const metadata: Metadata = {
  title: 'Presupuestos',
};

interface Props {
  searchParams: Promise<DataTableSearchParams>;
}

export default async function QuotesPage({ searchParams }: Props) {
  const params = await searchParams;
  return <QuotesList searchParams={params} />;
}
