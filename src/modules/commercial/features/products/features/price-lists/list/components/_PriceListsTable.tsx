'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  DataTable,
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
import type { PriceList } from '../../../shared/types';
import { deletePriceList, setDefaultPriceList } from '../actions.server';

interface PriceListsTableProps {
  data: PriceList[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _PriceListsTable({ data, totalRows, searchParams, permissions }: PriceListsTableProps) {
  const router = useRouter();
  const [editingPriceList, setEditingPriceList] = useState<PriceList | null>(null);
  const [deletingPriceList, setDeletingPriceList] = useState<PriceList | null>(null);

  const handleRefresh = () => {
    router.refresh();
  };

  const handleDelete = async () => {
    if (!deletingPriceList) return;
    try {
      await deletePriceList(deletingPriceList.id);
      toast.success('Lista de precios eliminada correctamente');
      handleRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al eliminar lista de precios';
      toast.error(message);
    } finally {
      setDeletingPriceList(null);
    }
  };

  const handleSetDefault = async (priceList: PriceList) => {
    try {
      await setDefaultPriceList(priceList.id);
      toast.success(`"${priceList.name}" marcada como lista predeterminada`);
      handleRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al marcar como predeterminada';
      toast.error(message);
    }
  };

  const columns = useMemo(
    () =>
      getColumns({
        onEdit: setEditingPriceList,
        onDelete: setDeletingPriceList,
        onSetDefault: handleSetDefault,
        permissions,
      }),
    [permissions]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar listas de precios..."
        tableId="commercial-price-lists"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={() => router.push('/dashboard/commercial/price-lists/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Nueva Lista de Precios
            </Button>
          ) : null
        }
      />

      {/* Diálogo de confirmación para eliminar */}
      <AlertDialog
        open={!!deletingPriceList}
        onOpenChange={(open) => !open && setDeletingPriceList(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta lista de precios?</AlertDialogTitle>
            <AlertDialogDescription>
              La lista de precios "{deletingPriceList?.name}" será eliminada permanentemente.
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
