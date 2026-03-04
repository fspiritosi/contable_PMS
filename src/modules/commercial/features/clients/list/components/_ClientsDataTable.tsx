'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  DataTable,
  type DataTableFacetedFilterConfig,
  type DataTableSearchParams,
} from '@/shared/components/common/DataTable';
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
import type { ModulePermissions } from '@/shared/lib/permissions';
import { getColumns } from '../columns';
import { _ClientFormModal } from './_ClientFormModal';
import {
  deactivateClient,
  reactivateClient,
  type ClientListItem,
} from '../actions.server';

interface Props {
  data: ClientListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _ClientsDataTable({ data, totalRows, searchParams, permissions }: Props) {
  const router = useRouter();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientListItem | null>(null);
  const [deactivatingClient, setDeactivatingClient] = useState<ClientListItem | null>(null);
  const [reactivatingClient, setReactivatingClient] = useState<ClientListItem | null>(null);

  const handleRefresh = () => {
    router.refresh();
  };

  const handleDeactivate = async () => {
    if (!deactivatingClient) return;
    try {
      await deactivateClient(deactivatingClient.id);
      toast.success('Cliente dado de baja exitosamente');
      handleRefresh();
    } catch {
      toast.error('Error al dar de baja el cliente');
    } finally {
      setDeactivatingClient(null);
    }
  };

  const handleReactivate = async () => {
    if (!reactivatingClient) return;
    try {
      await reactivateClient(reactivatingClient.id);
      toast.success('Cliente reactivado exitosamente');
      handleRefresh();
    } catch {
      toast.error('Error al reactivar el cliente');
    } finally {
      setReactivatingClient(null);
    }
  };

  const columns = useMemo(
    () =>
      getColumns({
        onEdit: setEditingClient,
        onDeactivate: setDeactivatingClient,
        onReactivate: setReactivatingClient,
        permissions,
      }),
    [permissions]
  );

  const facetedFilters = useMemo<DataTableFacetedFilterConfig[]>(
    () => [
      {
        columnId: 'isActive',
        title: 'Estado',
        options: [
          { value: 'true', label: 'Activo' },
          { value: 'false', label: 'Inactivo' },
        ],
      },
    ],
    []
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar clientes..."
        tableId="commercial-clients"
        facetedFilters={facetedFilters}
        showFilterToggle
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Cliente
            </Button>
          ) : null
        }
      />

      {/* Modal de crear/editar */}
      <_ClientFormModal
        open={isCreateOpen || !!editingClient}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setEditingClient(null);
          }
        }}
        client={editingClient}
        onSuccess={handleRefresh}
      />

      {/* Diálogo de confirmación para dar de baja */}
      <AlertDialog
        open={!!deactivatingClient}
        onOpenChange={(open) => !open && setDeactivatingClient(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dar de baja este cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              El cliente "{deactivatingClient?.name}" será marcado como inactivo.
              Esta acción se puede revertir posteriormente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Dar de baja
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo de confirmación para reactivar */}
      <AlertDialog
        open={!!reactivatingClient}
        onOpenChange={(open) => !open && setReactivatingClient(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reactivar este cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              El cliente "{reactivatingClient?.name}" será marcado como activo nuevamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleReactivate}>
              Reactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
