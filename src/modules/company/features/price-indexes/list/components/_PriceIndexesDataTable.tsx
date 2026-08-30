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

import { deletePriceIndex, type PriceIndexListItem } from '../actions.server';
import { getColumns } from '../columns';
import { _PriceIndexFormModal } from './_PriceIndexFormModal';

interface Props {
  data: PriceIndexListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _PriceIndexesDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPriceIndex, setSelectedPriceIndex] = useState<PriceIndexListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deletePriceIndex,
    onSuccess: () => {
      toast.success('Índice de precios eliminado');
      setDeleteDialogOpen(false);
      setSelectedPriceIndex(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedPriceIndex(null);
    setFormModalOpen(true);
  };

  const handleEdit = (priceIndex: PriceIndexListItem) => {
    setSelectedPriceIndex(priceIndex);
    setFormModalOpen(true);
  };

  const handleDelete = (priceIndex: PriceIndexListItem) => {
    setSelectedPriceIndex(priceIndex);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedPriceIndex(null);
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
        searchPlaceholder="Buscar índices de precios..."
        emptyMessage="No hay índices de precios registrados"
        tableId="company-price-indexes"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-price-index-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Índice
            </Button>
          ) : null
        }
        data-testid="price-indexes-table"
      />

      {/* Form Modal */}
      <_PriceIndexFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        priceIndex={selectedPriceIndex}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="price-index-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar índice de precios?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El índice &quot;{selectedPriceIndex?.name}&quot;
              será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedPriceIndex && deleteMutation.mutate(selectedPriceIndex.id)}
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
