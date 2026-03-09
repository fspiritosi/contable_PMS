import { PurchaseReports } from '@/modules/commercial/features/purchases/features/reports';
import { getSuppliersForSelect } from '@/modules/commercial/features/purchases/features/invoices/list/actions.server';

export default async function PurchaseReportsPage() {
  const suppliers = await getSuppliersForSelect();

  return <PurchaseReports suppliers={suppliers} />;
}
