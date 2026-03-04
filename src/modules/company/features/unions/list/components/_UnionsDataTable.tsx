'use client';

import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

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

import {
  DataTable,
  type DataTableSearchParams,
} from '@/shared/components/common/DataTable';
import type { ModulePermissions } from '@/shared/lib/permissions';

import { deleteUnion, type UnionListItem } from '../actions.server';
import { getColumns } from '../columns';
import { _UnionFormModal } from './_UnionFormModal';

interface Props {
  data: UnionListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _UnionsDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedUnion, setSelectedUnion] = useState<UnionListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteUnion,
    onSuccess: () => {
      toast.success('Sindicato eliminado');
      setDeleteDialogOpen(false);
      setSelectedUnion(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedUnion(null);
    setFormModalOpen(true);
  };

  const handleEdit = (union: UnionListItem) => {
    setSelectedUnion(union);
    setFormModalOpen(true);
  };

  const handleDelete = (union: UnionListItem) => {
    setSelectedUnion(union);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedUnion(null);
  };

  // Memoize columns with handlers
  const columns = useMemo(
    () => getColumns({ onEdit: handleEdit, onDelete: handleDelete, permissions }),
    [permissions]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar sindicatos..."
        emptyMessage="No hay sindicatos registrados"
        tableId="company-unions"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-union-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Sindicato
            </Button>
          ) : null
        }
        data-testid="unions-table"
      />

      {/* Form Modal */}
      <_UnionFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        union={selectedUnion}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="union-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar sindicato?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El sindicato &quot;{selectedUnion?.name}&quot; y sus
              convenios serán eliminados permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedUnion && deleteMutation.mutate(selectedUnion.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
