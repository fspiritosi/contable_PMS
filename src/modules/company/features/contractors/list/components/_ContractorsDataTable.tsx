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

import {
  DataTable,
  type DataTableSearchParams,
} from '@/shared/components/common/DataTable';
import type { ModulePermissions } from '@/shared/lib/permissions';

import { deleteContractor, type ContractorListItem } from '../actions.server';
import { getColumns } from '../columns';
import { _ContractorFormModal } from './_ContractorFormModal';

interface Props {
  data: ContractorListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _ContractorsDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedContractor, setSelectedContractor] = useState<ContractorListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteContractor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contractors'] });
      toast.success('Contratista eliminado');
      setDeleteDialogOpen(false);
      setSelectedContractor(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedContractor(null);
    setFormModalOpen(true);
  };

  const handleEdit = (contractor: ContractorListItem) => {
    setSelectedContractor(contractor);
    setFormModalOpen(true);
  };

  const handleDelete = (contractor: ContractorListItem) => {
    setSelectedContractor(contractor);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedContractor(null);
  };

  // Memoize columns with handlers and permissions
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
        searchPlaceholder="Buscar contratistas..."
        emptyMessage="No hay contratistas registrados"
        tableId="company-contractors"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-contractor-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Contratista
            </Button>
          ) : null
        }
        data-testid="contractors-table"
      />

      {/* Form Modal */}
      <_ContractorFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        contractor={selectedContractor}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="contractor-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar contratista?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta accion no se puede deshacer. El contratista &quot;{selectedContractor?.name}&quot; sera
              eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedContractor && deleteMutation.mutate(selectedContractor.id)}
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
