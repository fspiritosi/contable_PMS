import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

import { _FiscalExportsView } from './components/_FiscalExportsView';

/** Pantalla "Archivos ARCA": Libro IVA Digital, SIRE y SIRCAR del mes (TSK-796). */
export function FiscalExports() {
  return (
    <PermissionGuard module="accounting.reports" action="view" redirect>
      <_FiscalExportsView />
    </PermissionGuard>
  );
}
