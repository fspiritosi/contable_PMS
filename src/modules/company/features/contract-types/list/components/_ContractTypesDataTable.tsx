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
import { deleteContractType, type ContractTypeListItem } from '../actions.server';
import { _ContractTypeFormModal } from './_ContractTypeFormModal';

interface Props {
  data: ContractTypeListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _ContractTypesDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedContractType, setSelectedContractType] = useState<ContractTypeListItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteContractType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contractTypes'] });
      toast.success('Tipo de contrato eliminado');
      setDeleteDialogOpen(false);
      setSelectedContractType(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleCreate = () => {
    setSelectedContractType(null);
    setFormModalOpen(true);
  };

  const handleEdit = (contractType: ContractTypeListItem) => {
    setSelectedContractType(contractType);
    setFormModalOpen(true);
  };

  const handleDelete = (contractType: ContractTypeListItem) => {
    setSelectedContractType(contractType);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedContractType(null);
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
        searchPlaceholder="Buscar tipos de contrato..."
        tableId="company-contract-types"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={handleCreate} data-testid="new-contract-type-button">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Tipo de Contrato
            </Button>
          ) : null
        }
      />

      {/* Form Modal */}
      <_ContractTypeFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        contractType={selectedContractType}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar tipo de contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El tipo de contrato &quot;{selectedContractType?.name}&quot; será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedContractType && deleteMutation.mutate(selectedContractType.id)}
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
