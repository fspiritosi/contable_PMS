import type { Metadata } from 'next';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { WithholdingsReceived } from '@/modules/commercial/features/treasury/features/withholdings/list';

export const metadata: Metadata = {
  title: 'Retenciones Recibidas',
};

interface Props {
  searchParams: Promise<DataTableSearchParams>;
}

export default async function WithholdingsPage({ searchParams }: Props) {
  const params = await searchParams;
  return <WithholdingsReceived searchParams={params} />;
}
