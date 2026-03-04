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
import { getColumns, leadStatusLabels } from '../columns';
import { _LeadFormModal } from './_LeadFormModal';
import { _ConvertLeadModal } from './_ConvertLeadModal';
import {
  deleteLead,
  updateLeadStatus,
  type LeadListItem,
} from '../actions.server';
import type { LeadStatus } from '@/generated/prisma/enums';

interface Props {
  data: LeadListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _LeadsDataTable({
  data,
  totalRows,
  searchParams,
  permissions,
}: Props) {
  const router = useRouter();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<LeadListItem | null>(null);
  const [convertingLead, setConvertingLead] = useState<LeadListItem | null>(null);
  const [deletingLead, setDeletingLead] = useState<LeadListItem | null>(null);

  const handleRefresh = () => {
    router.refresh();
  };

  const handleUpdateStatus = async (lead: LeadListItem, status: LeadStatus) => {
    try {
      await updateLeadStatus(lead.id, status);
      toast.success('Estado actualizado exitosamente');
      handleRefresh();
    } catch {
      toast.error('Error al actualizar el estado');
    }
  };

  const handleDelete = async () => {
    if (!deletingLead) return;
    try {
      await deleteLead(deletingLead.id);
      toast.success('Lead eliminado exitosamente');
      handleRefresh();
    } catch {
      toast.error('Error al eliminar el lead');
    } finally {
      setDeletingLead(null);
    }
  };

  const columns = useMemo(
    () =>
      getColumns({
        onEdit: setEditingLead,
        onConvert: setConvertingLead,
        onUpdateStatus: handleUpdateStatus,
        onDelete: setDeletingLead,
        permissions,
      }),
    [permissions]
  );

  const facetedFilters = useMemo<DataTableFacetedFilterConfig[]>(
    () => [
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(leadStatusLabels).map(([value, label]) => ({
          value,
          label,
        })),
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
        searchPlaceholder="Buscar leads..."
        tableId="commercial-leads"
        facetedFilters={facetedFilters}
        showFilterToggle
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Lead
            </Button>
          ) : null
        }
      />

      {/* Modal de crear/editar */}
      <_LeadFormModal
        open={isCreateOpen || !!editingLead}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setEditingLead(null);
          }
        }}
        lead={editingLead}
        onSuccess={handleRefresh}
      />

      {/* Modal de conversión */}
      <_ConvertLeadModal
        open={!!convertingLead}
        onOpenChange={(open) => !open && setConvertingLead(null)}
        lead={convertingLead}
        onSuccess={handleRefresh}
      />

      {/* Diálogo de confirmación para eliminar */}
      <AlertDialog
        open={!!deletingLead}
        onOpenChange={(open) => !open && setDeletingLead(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este lead?</AlertDialogTitle>
            <AlertDialogDescription>
              El lead "{deletingLead?.name}" será eliminado.
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
