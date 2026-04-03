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

import { deleteDiscountPreset, type DiscountPresetListItem } from '../actions.server';
import { getColumns } from '../columns';
import { _DiscountPresetFormModal } from './_DiscountPresetFormModal';

interface Props {
  data: DiscountPresetListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _DiscountPresetsDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<DiscountPresetListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteDiscountPreset,
    onSuccess: () => {
      toast.success('Descuento predefinido eliminado');
      setDeleteDialogOpen(false);
      setSelectedPreset(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedPreset(null);
    setFormModalOpen(true);
  };

  const handleEdit = (preset: DiscountPresetListItem) => {
    setSelectedPreset(preset);
    setFormModalOpen(true);
  };

  const handleDelete = (preset: DiscountPresetListItem) => {
    setSelectedPreset(preset);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedPreset(null);
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
        searchPlaceholder="Buscar descuentos predefinidos..."
        emptyMessage="No hay descuentos predefinidos registrados"
        tableId="company-discount-presets"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-discount-preset-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Descuento
            </Button>
          ) : null
        }
        data-testid="discount-presets-table"
      />

      {/* Form Modal */}
      <_DiscountPresetFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        preset={selectedPreset}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="discount-preset-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar descuento predefinido?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El descuento &quot;{selectedPreset?.name}&quot; será
              eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedPreset && deleteMutation.mutate(selectedPreset.id)}
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
