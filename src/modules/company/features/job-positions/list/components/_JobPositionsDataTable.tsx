'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
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

import { DataTable, type DataTableSearchParams } from '@/shared/components/common/DataTable';
import type { ModulePermissions } from '@/shared/lib/permissions';
import { getColumns } from '../columns';
import { deleteJobPosition, type JobPositionListItem } from '../actions.server';
import { _JobPositionFormModal } from './_JobPositionFormModal';

interface Props {
  data: JobPositionListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _JobPositionsDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedJobPosition, setSelectedJobPosition] = useState<JobPositionListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteJobPosition,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobPositions'] });
      toast.success('Puesto de trabajo eliminado');
      setDeleteDialogOpen(false);
      setSelectedJobPosition(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedJobPosition(null);
    setFormModalOpen(true);
  };

  const handleEdit = (jobPosition: JobPositionListItem) => {
    setSelectedJobPosition(jobPosition);
    setFormModalOpen(true);
  };

  const handleDelete = (jobPosition: JobPositionListItem) => {
    setSelectedJobPosition(jobPosition);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedJobPosition(null);
  };

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
        searchPlaceholder="Buscar puestos de trabajo..."
        tableId="company-job-positions"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-job-position-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Puesto
            </Button>
          ) : null
        }
      />

      {/* Form Modal */}
      <_JobPositionFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        jobPosition={selectedJobPosition}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar puesto de trabajo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El puesto &quot;{selectedJobPosition?.name}&quot; será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedJobPosition && deleteMutation.mutate(selectedJobPosition.id)}
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
