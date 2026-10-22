'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  DataTable,
  type DataTableFacetedFilterConfig,
  type DataTableSearchParams,
} from '@/shared/components/common/DataTable';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Button } from '@/shared/components/ui/button';
import { logger } from '@/shared/lib/logger';
import type { ModulePermissions } from '@/shared/lib/permissions';
import { deleteConcept, setConceptActive, type ConceptRow } from '../actions.server';
import { getColumns } from '../columns';
import { _ConceptFormDialog } from './_ConceptFormDialog';

interface Props {
  data: ConceptRow[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

const FACETED_FILTERS: DataTableFacetedFilterConfig[] = [
  { columnId: 'name', title: 'Nombre', type: 'text', placeholder: 'Buscar por nombre...' },
  {
    columnId: 'isActive',
    title: 'Estado',
    options: [
      { value: 'true', label: 'Activo' },
      { value: 'false', label: 'Inactivo' },
    ],
  },
];

export function _ConceptsTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();
  // `null` = cerrado, `'new'` = alta, otro valor = id del concepto a editar.
  const [formTarget, setFormTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ConceptRow | null>(null);

  const handleToggleActive = async (concept: ConceptRow) => {
    try {
      const result = await setConceptActive(concept.id, !concept.isActive);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(concept.isActive ? 'Concepto desactivado' : 'Concepto activado');
      router.refresh();
    } catch (error) {
      logger.error('Error al cambiar el estado del concepto', { data: { error } });
      toast.error('No se pudo cambiar el estado del concepto');
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const result = await deleteConcept(deleting.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Concepto eliminado');
      router.refresh();
    } catch (error) {
      logger.error('Error al eliminar concepto', { data: { error } });
      toast.error('No se pudo eliminar el concepto');
    } finally {
      setDeleting(null);
    }
  };

  const columns = useMemo(
    () =>
      getColumns({
        onEdit: (concept) => setFormTarget(concept.id),
        onToggleActive: handleToggleActive,
        onDelete: setDeleting,
        permissions,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissions]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        showSearch={false}
        tableId="accounting-concepts"
        facetedFilters={FACETED_FILTERS}
        showFilterToggle
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={() => setFormTarget('new')}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo concepto
            </Button>
          ) : null
        }
      />

      {formTarget && (
        <_ConceptFormDialog
          conceptId={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este concepto?</AlertDialogTitle>
            <AlertDialogDescription>
              El concepto &quot;{deleting?.name}&quot; será eliminado permanentemente. Si ya se usó
              en movimientos, no se puede borrar: desactivalo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
