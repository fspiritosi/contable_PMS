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

import { deleteCollectiveAgreement, type CollectiveAgreementListItem } from '../actions.server';
import { getColumns } from '../columns';
import { _CollectiveAgreementFormModal } from './_CollectiveAgreementFormModal';
import type { UnionOption } from '@/modules/company/features/unions';

interface Props {
  data: CollectiveAgreementListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  unions: UnionOption[];
  permissions: ModulePermissions;
}

export function _CollectiveAgreementsDataTable({
  data,
  totalRows,
  searchParams,
  unions,
  permissions,
}: Props) {
  const router = useRouter();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedAgreement, setSelectedAgreement] = useState<CollectiveAgreementListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteCollectiveAgreement,
    onSuccess: () => {
      toast.success('Convenio colectivo eliminado');
      setDeleteDialogOpen(false);
      setSelectedAgreement(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedAgreement(null);
    setFormModalOpen(true);
  };

  const handleEdit = (agreement: CollectiveAgreementListItem) => {
    setSelectedAgreement(agreement);
    setFormModalOpen(true);
  };

  const handleDelete = (agreement: CollectiveAgreementListItem) => {
    setSelectedAgreement(agreement);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedAgreement(null);
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
        searchPlaceholder="Buscar convenios colectivos..."
        emptyMessage="No hay convenios colectivos registrados"
        tableId="company-collective-agreements"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-collective-agreement-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Convenio
            </Button>
          ) : null
        }
        data-testid="collective-agreements-table"
      />

      {/* Form Modal */}
      <_CollectiveAgreementFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        collectiveAgreement={selectedAgreement}
        unions={unions}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="collective-agreement-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar convenio colectivo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta accion no se puede deshacer. El convenio colectivo &quot;{selectedAgreement?.name}
              &quot; sera eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="collective-agreement-delete-cancel">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedAgreement && deleteMutation.mutate(selectedAgreement.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              data-testid="collective-agreement-delete-confirm"
            >
              {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
