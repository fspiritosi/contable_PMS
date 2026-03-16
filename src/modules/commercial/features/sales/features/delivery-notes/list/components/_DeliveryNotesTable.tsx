'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { usePermissions } from '@/shared/hooks/usePermissions';

import { DataTable, type DataTableSearchParams, type DataTableFacetedFilterConfig } from '@/shared/components/common/DataTable';
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
import type { DeliveryNoteListItem } from '../actions.server';
import {
  acceptDeliveryNote,
  cancelDeliveryNote,
  deleteDeliveryNote,
} from '../actions.server';
import { getColumns } from '../columns';
import { DELIVERY_NOTE_STATUS_LABELS } from '../../shared/validators';

interface FacetCounts {
  status: Record<string, number>;
}

interface DeliveryNotesTableProps {
  data: DeliveryNoteListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  facetCounts?: FacetCounts;
}

interface PendingAction {
  title: string;
  description: string;
  action: () => Promise<unknown>;
  successMessage: string;
  destructive?: boolean;
}

export function _DeliveryNotesTable({ data, totalRows, searchParams, facetCounts }: DeliveryNotesTableProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [loading, setLoading] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [executing, setExecuting] = useState(false);

  const executeAction = async () => {
    if (!pendingAction) return;

    try {
      setExecuting(true);
      await pendingAction.action();
      toast.success(pendingAction.successMessage);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al procesar la acción');
    } finally {
      setExecuting(false);
      setLoading(null);
      setPendingAction(null);
    }
  };

  const handleAccept = (note: DeliveryNoteListItem) => {
    setLoading(note.id);
    setPendingAction({
      title: '¿Aceptar remito?',
      description: `El remito ${note.fullNumber} será marcado como aceptado por el cliente.`,
      action: () => acceptDeliveryNote(note.id),
      successMessage: 'Remito aceptado correctamente',
    });
  };

  const handleCancel = (note: DeliveryNoteListItem) => {
    setLoading(note.id);
    setPendingAction({
      title: '¿Anular remito?',
      description: `El remito ${note.fullNumber} será anulado. Se revertirá el stock.`,
      action: () => cancelDeliveryNote(note.id),
      successMessage: 'Remito anulado correctamente',
      destructive: true,
    });
  };

  const handleDelete = (note: DeliveryNoteListItem) => {
    setLoading(note.id);
    setPendingAction({
      title: '¿Eliminar remito?',
      description: `El remito ${note.fullNumber} será eliminado permanentemente. Se revertirá el stock.`,
      action: () => deleteDeliveryNote(note.id),
      successMessage: 'Remito eliminado',
      destructive: true,
    });
  };

  const canUpdate = hasPermission('commercial.delivery-notes', 'update');
  const canApprove = hasPermission('commercial.delivery-notes', 'approve');
  const canDelete = hasPermission('commercial.delivery-notes', 'delete');

  const columns = useMemo(
    () =>
      getColumns({
        onView: (note) => router.push(`/dashboard/commercial/delivery-notes/${note.id}`),
        onEdit: canUpdate
          ? (note) => router.push(`/dashboard/commercial/delivery-notes/${note.id}/edit`)
          : undefined,
        onAccept: canApprove ? handleAccept : undefined,
        onCancel: canDelete ? handleCancel : undefined,
        onDelete: canDelete ? handleDelete : undefined,
        loading,
      }),
    [loading, canUpdate, canApprove, canDelete] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(DELIVERY_NOTE_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
        externalCounts: facetCounts?.status ? new Map(Object.entries(facetCounts.status)) : undefined,
      },
      {
        columnId: 'deliveryDate',
        title: 'Fecha Entrega',
        type: 'dateRange' as const,
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
        searchPlaceholder="Buscar remitos de entrega..."
        facetedFilters={facetedFilters}
        tableId="commercial-delivery-notes"
        showFilterToggle
      />

      <AlertDialog
        open={!!pendingAction}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
            setLoading(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendingAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={executing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeAction}
              disabled={executing}
              className={pendingAction?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {executing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
