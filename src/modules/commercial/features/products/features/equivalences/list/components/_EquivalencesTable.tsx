'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  DataTable,
  type DataTableSearchParams,
  type DataTableFacetedFilterConfig,
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
import type { ModulePermissions } from '@/shared/lib/permissions';
import { logger } from '@/shared/lib/logger';
import {
  getEquivalenceColumns,
  type EquivalenceRow,
} from '../columns';
import {
  createEquivalence,
  updateEquivalence,
  deleteEquivalence,
  type CreateEquivalenceInput,
} from '../actions.server';
import { _EquivalenceFormModal } from './_EquivalenceFormModal';
import { _EquivalenceDetailModal } from './_EquivalenceDetailModal';

interface EquivalencesTableProps {
  data: EquivalenceRow[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _EquivalencesTable({
  data,
  totalRows,
  searchParams,
  permissions,
}: EquivalencesTableProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<EquivalenceRow | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<EquivalenceRow | null>(null);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEdit = useCallback((group: EquivalenceRow) => {
    setEditingGroup(group);
    setFormOpen(true);
  }, []);

  const handleViewDetail = useCallback((group: EquivalenceRow) => {
    setDetailGroupId(group.id);
    setDetailOpen(true);
  }, []);

  const handleCreate = useCallback(() => {
    setEditingGroup(null);
    setFormOpen(true);
  }, []);

  const handleFormSubmit = async (data: CreateEquivalenceInput) => {
    setIsSubmitting(true);
    try {
      if (editingGroup) {
        await updateEquivalence(editingGroup.id, data);
        toast.success('Grupo actualizado correctamente');
      } else {
        await createEquivalence(data);
        toast.success('Grupo creado correctamente');
      }
      setFormOpen(false);
      setEditingGroup(null);
      router.refresh();
    } catch (error) {
      logger.error('Error al guardar grupo de equivalencia', { data: { error } });
      toast.error(
        error instanceof Error ? error.message : 'Error al guardar grupo',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingGroup) return;
    try {
      await deleteEquivalence(deletingGroup.id);
      toast.success('Grupo eliminado correctamente');
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error al eliminar grupo';
      toast.error(message);
    } finally {
      setDeletingGroup(null);
    }
  };

  const columns = useMemo(
    () =>
      getEquivalenceColumns({
        onEdit: handleEdit,
        onDelete: setDeletingGroup,
        onViewDetail: handleViewDetail,
        permissions,
      }),
    [permissions, handleEdit, handleViewDetail],
  );

  const facetedFilters = useMemo<DataTableFacetedFilterConfig[]>(
    () => [
      {
        columnId: 'name',
        title: 'Grupo',
        type: 'text' as const,
        placeholder: 'Buscar por nombre...',
      },
      {
        columnId: 'oemCode',
        title: 'Código OEM',
        type: 'text' as const,
        placeholder: 'Buscar por OEM...',
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        showSearch={false}
        tableId="commercial-equivalences"
        facetedFilters={facetedFilters}
        showFilterToggle
        toolbarActions={
          permissions.canCreate && (
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Grupo
            </Button>
          )
        }
      />

      {/* Modal de formulario (crear/editar) */}
      <_EquivalenceFormModal
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingGroup(null);
        }}
        onSubmit={handleFormSubmit}
        editingGroup={editingGroup}
        isSubmitting={isSubmitting}
      />

      {/* Modal de detalle */}
      <_EquivalenceDetailModal
        groupId={detailGroupId}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setDetailGroupId(null);
        }}
      />

      {/* Diálogo de confirmación para eliminar */}
      <AlertDialog
        open={!!deletingGroup}
        onOpenChange={(open) => !open && setDeletingGroup(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este grupo?</AlertDialogTitle>
            <AlertDialogDescription>
              El grupo &quot;{deletingGroup?.name}&quot; será eliminado. Los
              artículos vinculados serán desvinculados pero no eliminados.
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
