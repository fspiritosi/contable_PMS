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
import { deleteJobCategory, type JobCategoryListItem } from '../actions.server';
import { _JobCategoryFormModal } from './_JobCategoryFormModal';

interface Props {
  data: JobCategoryListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _JobCategoriesDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedJobCategory, setSelectedJobCategory] = useState<JobCategoryListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteJobCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobCategories'] });
      toast.success('Categoría laboral eliminada');
      setDeleteDialogOpen(false);
      setSelectedJobCategory(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedJobCategory(null);
    setFormModalOpen(true);
  };

  const handleEdit = (jobCategory: JobCategoryListItem) => {
    setSelectedJobCategory(jobCategory);
    setFormModalOpen(true);
  };

  const handleDelete = (jobCategory: JobCategoryListItem) => {
    setSelectedJobCategory(jobCategory);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedJobCategory(null);
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
        searchPlaceholder="Buscar categorías laborales..."
        tableId="company-job-categories"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-job-category-button">
              <Plus className="mr-2 h-4 w-4" />
              Nueva Categoría
            </Button>
          ) : null
        }
      />

      {/* Form Modal */}
      <_JobCategoryFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        jobCategory={selectedJobCategory}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar categoría laboral?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. La categoría laboral &quot;{selectedJobCategory?.name}&quot; será eliminada permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedJobCategory && deleteMutation.mutate(selectedJobCategory.id)}
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
