import { Metadata } from 'next';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';

import { BankAccountsList } from '@/modules/commercial/features/treasury/features/bank-accounts/list';

export const metadata: Metadata = {
  title: 'Cuentas Bancarias y Brokers | Tesorería',
  description: 'Gestión de cuentas bancarias, brokers y movimientos',
};

interface Props {
  searchParams: Promise<DataTableSearchParams>;
}

export default async function BankAccountsPage({ searchParams }: Props) {
  const params = await searchParams;
  return <BankAccountsList searchParams={params} />;
}
