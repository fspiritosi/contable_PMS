import { getActiveCompanyId } from '@/shared/lib/company';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { _MonthlyBalanceView } from './components/_MonthlyBalanceView';

export async function MonthlyBalance() {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return (
    <PermissionGuard module="accounting.reports" action="view" redirect>
      <_MonthlyBalanceView companyId={companyId} />
    </PermissionGuard>
  );
}