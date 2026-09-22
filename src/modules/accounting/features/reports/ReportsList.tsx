import { Suspense } from 'react';

import { getActiveCompanyId } from '@/shared/lib/company';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { _ReportsContent } from './components/_ReportsContent';

export async function ReportsList() {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return (
    <PermissionGuard module="accounting.reports" action="view" redirect>
      {/* `_ReportsContent` usa `useSearchParams` para el deep-link (TSK-719):
          sin este límite de Suspense el build de Next falla. */}
      <Suspense fallback={null}>
        <_ReportsContent companyId={companyId} />
      </Suspense>
    </PermissionGuard>
  );
}
