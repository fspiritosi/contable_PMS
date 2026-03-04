'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  DataTable,
  type DataTableSearchParams,
  type DataTableFacetedFilterConfig,
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
import type { WarehouseListItem } from '../actions.server';
import { deleteWarehouse, toggleWarehouseActive } from '../actions.server';
import { WAREHOUSE_TYPE_LABELS } from '../../../shared/types';

interface WarehousesTableProps {
  data: WarehouseListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _WarehousesTable({ data, totalRows, searchParams, permissions }: WarehousesTableProps) {
  const router = useRouter();
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseListItem | null>(null);
  const [deletingWarehouse, setDeletingWarehouse] = useState<WarehouseListItem | null>(null);

  const handleRefresh = () => {
    router.refresh();
  };

  const handleDelete = async () => {
    if (!deletingWarehouse) return;
    try {
      await deleteWarehouse(deletingWarehouse.id);
      toast.success('Almacén eliminado correctamente');
      handleRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al eliminar almacén';
      toast.error(message);
    } finally {
      setDeletingWarehouse(null);
    }
  };

  const handleToggleActive = async (warehouse: WarehouseListItem) => {
    try {
      await toggleWarehouseActive(warehouse.id);
      toast.success(warehouse.isActive ? 'Almacén desactivado correctamente' : 'Almacén activado correctamente');
      handleRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al cambiar estado del almacén';
      toast.error(message);
    }
  };

  const columns = useMemo(
    () =>
      getColumns({
        onEdit: setEditingWarehouse,
        onDelete: setDeletingWarehouse,
        onToggleActive: handleToggleActive,
        permissions,
      }),
    [permissions]
  );

  const facetedFilters = useMemo<DataTableFacetedFilterConfig[]>(
    () => [
      {
        columnId: 'type',
        title: 'Tipo',
        options: Object.entries(WAREHOUSE_TYPE_LABELS).map(([value, label]) => ({
          value,
          label,
        })),
      },
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
        searchPlaceholder="Buscar almacenes..."
        tableId="commercial-warehouses"
        facetedFilters={facetedFilters}
        showFilterToggle
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={() => router.push('/dashboard/commercial/warehouses/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Almacén
            </Button>
          ) : null
        }
      />

      {/* Diálogo de confirmación para eliminar */}
      <AlertDialog
        open={!!deletingWarehouse}
        onOpenChange={(open) => !open && setDeletingWarehouse(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este almacén?</AlertDialogTitle>
            <AlertDialogDescription>
              El almacén "{deletingWarehouse?.name}" será eliminado permanentemente.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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
