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
import { deleteSector, type SectorListItem } from '../actions.server';
import { _SectorFormModal } from './_SectorFormModal';

interface Props {
  data: SectorListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _SectorsDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedSector, setSelectedSector] = useState<SectorListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteSector,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sectors'] });
      toast.success('Sector eliminado');
      setDeleteDialogOpen(false);
      setSelectedSector(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedSector(null);
    setFormModalOpen(true);
  };

  const handleEdit = (sector: SectorListItem) => {
    setSelectedSector(sector);
    setFormModalOpen(true);
  };

  const handleDelete = (sector: SectorListItem) => {
    setSelectedSector(sector);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedSector(null);
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
        searchPlaceholder="Buscar sectores..."
        tableId="company-sectors"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-sector-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Sector
            </Button>
          ) : null
        }
      />

      {/* Form Modal */}
      <_SectorFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        sector={selectedSector}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar sector?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El sector &quot;{selectedSector?.name}&quot; será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedSector && deleteMutation.mutate(selectedSector.id)}
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
