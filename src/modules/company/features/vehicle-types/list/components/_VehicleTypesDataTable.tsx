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

import { deleteVehicleType, type VehicleTypeListItem } from '../actions.server';
import { getColumns } from '../columns';
import { _VehicleTypeFormModal } from './_VehicleTypeFormModal';

interface Props {
  data: VehicleTypeListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _VehicleTypesDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedVehicleType, setSelectedVehicleType] = useState<VehicleTypeListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteVehicleType,
    onSuccess: () => {
      toast.success('Tipo de equipo eliminado');
      setDeleteDialogOpen(false);
      setSelectedVehicleType(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedVehicleType(null);
    setFormModalOpen(true);
  };

  const handleEdit = (vehicleType: VehicleTypeListItem) => {
    setSelectedVehicleType(vehicleType);
    setFormModalOpen(true);
  };

  const handleDelete = (vehicleType: VehicleTypeListItem) => {
    setSelectedVehicleType(vehicleType);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedVehicleType(null);
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
        searchPlaceholder="Buscar tipos de equipo..."
        emptyMessage="No hay tipos de equipo registrados"
        tableId="company-vehicle-types"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-vehicle-type-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Tipo de Equipo
            </Button>
          ) : null
        }
        data-testid="vehicle-types-table"
      />

      {/* Form Modal */}
      <_VehicleTypeFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        vehicleType={selectedVehicleType}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="vehicle-type-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar tipo de equipo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta accion no se puede deshacer. El tipo de equipo &quot;{selectedVehicleType?.name}&quot; sera
              eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedVehicleType && deleteMutation.mutate(selectedVehicleType.id)}
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
