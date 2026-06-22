import type { Metadata } from 'next';
import { CardInstallmentsList } from '@/modules/commercial/features/treasury/features/card-installments';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';

export const metadata: Metadata = {
  title: 'Cuotas de Tarjeta',
};

interface Props {
  searchParams: Promise<DataTableSearchParams>;
}

export default async function CardInstallmentsPage({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams;
  return <CardInstallmentsList searchParams={resolvedSearchParams} />;
}
