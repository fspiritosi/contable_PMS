import { MonthlyBalance } from '@/modules/accounting/features/monthly-balance';
import { checkPermission } from '@/shared/lib/permissions';

export default async function MonthlyBalancePage() {
  await checkPermission('accounting.reports', 'view');

  return <MonthlyBalance />;
}