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
import { deleteVehicleBrand, type VehicleBrandListItem } from '../actions.server';
import { _VehicleBrandFormModal } from './_VehicleBrandFormModal';

interface Props {
  data: VehicleBrandListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _VehicleBrandsDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedVehicleBrand, setSelectedVehicleBrand] = useState<VehicleBrandListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteVehicleBrand,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleBrands'] });
      toast.success('Marca de vehículo eliminada');
      setDeleteDialogOpen(false);
      setSelectedVehicleBrand(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedVehicleBrand(null);
    setFormModalOpen(true);
  };

  const handleEdit = (vehicleBrand: VehicleBrandListItem) => {
    setSelectedVehicleBrand(vehicleBrand);
    setFormModalOpen(true);
  };

  const handleDelete = (vehicleBrand: VehicleBrandListItem) => {
    setSelectedVehicleBrand(vehicleBrand);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedVehicleBrand(null);
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
        searchPlaceholder="Buscar marcas de vehículos..."
        tableId="company-vehicle-brands"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-vehicle-brand-button">
              <Plus className="mr-2 h-4 w-4" />
              Nueva Marca
            </Button>
          ) : null
        }
      />

      {/* Form Modal */}
      <_VehicleBrandFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        vehicleBrand={selectedVehicleBrand}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar marca de vehículo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. La marca &quot;{selectedVehicleBrand?.name}&quot; será eliminada permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedVehicleBrand && deleteMutation.mutate(selectedVehicleBrand.id)}
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
