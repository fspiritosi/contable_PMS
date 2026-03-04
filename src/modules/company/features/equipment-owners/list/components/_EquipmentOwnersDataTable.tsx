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

import { deleteEquipmentOwner, type EquipmentOwnerListItem } from '../actions.server';
import { getColumns } from '../columns';
import { _EquipmentOwnerFormModal } from './_EquipmentOwnerFormModal';

interface Props {
  data: EquipmentOwnerListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _EquipmentOwnersDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState<EquipmentOwnerListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteEquipmentOwner,
    onSuccess: () => {
      toast.success('Titular eliminado');
      setDeleteDialogOpen(false);
      setSelectedOwner(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedOwner(null);
    setFormModalOpen(true);
  };

  const handleEdit = (owner: EquipmentOwnerListItem) => {
    setSelectedOwner(owner);
    setFormModalOpen(true);
  };

  const handleDelete = (owner: EquipmentOwnerListItem) => {
    setSelectedOwner(owner);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedOwner(null);
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
        searchPlaceholder="Buscar titulares..."
        emptyMessage="No hay titulares registrados"
        tableId="company-equipment-owners"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-owner-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Titular
            </Button>
          ) : null
        }
        data-testid="equipment-owners-table"
      />

      {/* Form Modal */}
      <_EquipmentOwnerFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        owner={selectedOwner}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="owner-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar titular?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta accion no se puede deshacer. El titular &quot;{selectedOwner?.name}&quot; sera
              eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedOwner && deleteMutation.mutate(selectedOwner.id)}
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
