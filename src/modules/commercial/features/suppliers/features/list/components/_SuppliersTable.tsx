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
import { SUPPLIER_STATUS_LABELS, SUPPLIER_TAX_CONDITION_LABELS } from '../../../shared/types';
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
import type { Supplier } from '../../../shared/types';
import { deleteSupplier } from '../actions.server';

interface FacetCounts {
  status: Record<string, number>;
  taxCondition: Record<string, number>;
}

interface SuppliersTableProps {
  data: Supplier[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
  facetCounts?: FacetCounts;
}

export function _SuppliersTable({ data, totalRows, searchParams, permissions, facetCounts }: SuppliersTableProps) {
  const router = useRouter();
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(null);

  const handleRefresh = () => {
    router.refresh();
  };

  const handleDelete = async () => {
    if (!deletingSupplier) return;
    try {
      await deleteSupplier(deletingSupplier.id);
      toast.success('Proveedor eliminado correctamente');
      handleRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al eliminar proveedor';
      toast.error(message);
    } finally {
      setDeletingSupplier(null);
    }
  };

  const columns = useMemo(
    () =>
      getColumns({
        onEdit: setEditingSupplier,
        onDelete: setDeletingSupplier,
        permissions,
      }),
    [permissions]
  );

  const facetedFilters = useMemo<DataTableFacetedFilterConfig[]>(
    () => [
      {
        columnId: 'businessName',
        title: 'Nombre',
        type: 'text' as const,
        placeholder: 'Buscar por nombre...',
      },
      {
        columnId: 'taxId',
        title: 'CUIT',
        type: 'text' as const,
        placeholder: 'Buscar por CUIT...',
      },
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(SUPPLIER_STATUS_LABELS).map(([value, label]) => ({
          value,
          label,
        })),
        externalCounts: facetCounts?.status ? new Map(Object.entries(facetCounts.status)) : undefined,
      },
      {
        columnId: 'taxCondition',
        title: 'Condición IVA',
        options: Object.entries(SUPPLIER_TAX_CONDITION_LABELS).map(([value, label]) => ({
          value,
          label,
        })),
        externalCounts: facetCounts?.taxCondition ? new Map(Object.entries(facetCounts.taxCondition)) : undefined,
      },
    ],
    [facetCounts]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        showSearch={false}
        tableId="commercial-suppliers"
        facetedFilters={facetedFilters}
        showFilterToggle
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={() => router.push('/dashboard/commercial/suppliers/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Proveedor
            </Button>
          ) : null
        }
      />

      {/* Diálogo de confirmación para eliminar */}
      <AlertDialog
        open={!!deletingSupplier}
        onOpenChange={(open) => !open && setDeletingSupplier(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este proveedor?</AlertDialogTitle>
            <AlertDialogDescription>
              El proveedor "{deletingSupplier?.businessName}" será eliminado permanentemente.
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
