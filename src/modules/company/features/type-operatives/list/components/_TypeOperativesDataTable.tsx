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
import { deleteTypeOperative, type TypeOperativeListItem } from '../actions.server';
import { _TypeOperativeFormModal } from './_TypeOperativeFormModal';

interface Props {
  data: TypeOperativeListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _TypeOperativesDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTypeOperative, setSelectedTypeOperative] = useState<TypeOperativeListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteTypeOperative,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['typeOperatives'] });
      toast.success('Tipo operativo eliminado');
      setDeleteDialogOpen(false);
      setSelectedTypeOperative(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedTypeOperative(null);
    setFormModalOpen(true);
  };

  const handleEdit = (typeOperative: TypeOperativeListItem) => {
    setSelectedTypeOperative(typeOperative);
    setFormModalOpen(true);
  };

  const handleDelete = (typeOperative: TypeOperativeListItem) => {
    setSelectedTypeOperative(typeOperative);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedTypeOperative(null);
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
        searchPlaceholder="Buscar tipos operativos..."
        tableId="company-type-operatives"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-type-operative-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Tipo Operativo
            </Button>
          ) : null
        }
      />

      {/* Form Modal */}
      <_TypeOperativeFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        typeOperative={selectedTypeOperative}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar tipo operativo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El tipo operativo &quot;{selectedTypeOperative?.name}&quot; será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedTypeOperative && deleteMutation.mutate(selectedTypeOperative.id)}
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
