import { FiscalExports } from '@/modules/commercial/features/fiscal-exports';
import { checkPermission } from '@/shared/lib/permissions';

export default async function FiscalExportsPage() {
  await checkPermission('accounting.reports', 'view');

  return <FiscalExports />;
}
