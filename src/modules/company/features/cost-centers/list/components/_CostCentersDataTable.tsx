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

import { deleteCostCenter, type CostCenterListItem } from '../actions.server';
import { getColumns } from '../columns';
import { _CostCenterFormModal } from './_CostCenterFormModal';

interface Props {
  data: CostCenterListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _CostCentersDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCostCenter, setSelectedCostCenter] = useState<CostCenterListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteCostCenter,
    onSuccess: () => {
      toast.success('Centro de costo eliminado');
      setDeleteDialogOpen(false);
      setSelectedCostCenter(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedCostCenter(null);
    setFormModalOpen(true);
  };

  const handleEdit = (costCenter: CostCenterListItem) => {
    setSelectedCostCenter(costCenter);
    setFormModalOpen(true);
  };

  const handleDelete = (costCenter: CostCenterListItem) => {
    setSelectedCostCenter(costCenter);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedCostCenter(null);
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
        searchPlaceholder="Buscar centros de costo..."
        emptyMessage="No hay centros de costo registrados"
        tableId="company-cost-centers"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-cost-center-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Centro de Costo
            </Button>
          ) : null
        }
        data-testid="cost-centers-table"
      />

      {/* Form Modal */}
      <_CostCenterFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        costCenter={selectedCostCenter}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="cost-center-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar centro de costo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El centro de costo &quot;{selectedCostCenter?.name}&quot; será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedCostCenter && deleteMutation.mutate(selectedCostCenter.id)}
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
