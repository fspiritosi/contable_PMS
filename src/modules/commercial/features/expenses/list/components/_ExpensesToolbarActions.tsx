'use client';

import { Tags } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import { _CategoryManagementModal } from '../../components/_CategoryManagementModal';
import { _CreateExpenseModal } from './_CreateExpenseModal';

interface ExpensesToolbarActionsProps {
  canCreate: boolean;
  /** Refresca el listado (nuevo egreso, o categorías nuevas para el filtro facetado). */
  onCreated: () => void;
}

/**
 * Barra del listado de Egresos: "Categorías" (TSK-757, visible con `view`: el
 * listado ya está bajo `PermissionGuard`) y "Nuevo egreso" (con `create`).
 */
export function _ExpensesToolbarActions({ canCreate, onCreated }: ExpensesToolbarActionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <_CategoryManagementModal
        trigger={
          <Button variant="outline" size="sm" aria-label="Categorías" title="Categorías de egreso">
            <Tags className="h-4 w-4 sm:mr-2" />
            {/* En móvil solo el ícono: la barra del DataTable no hace wrap */}
            <span className="hidden sm:inline">Categorías</span>
          </Button>
        }
        onClose={onCreated}
      />
      {canCreate && <_CreateExpenseModal onSuccess={onCreated} />}
    </div>
  );
}
