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
import type { ReceivingNoteListItem } from '../actions.server';
import {
  confirmReceivingNote,
  cancelReceivingNote,
  deleteReceivingNote,
} from '../actions.server';
import { getColumns } from '../columns';
import { RECEIVING_NOTE_STATUS_LABELS } from '../../shared/validators';

interface ReceivingNotesTableProps {
  data: ReceivingNoteListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

interface PendingAction {
  title: string;
  description: string;
  action: () => Promise<unknown>;
  successMessage: string;
  destructive?: boolean;
}

export function _ReceivingNotesTable({ data, totalRows, searchParams }: ReceivingNotesTableProps) {
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

  const handleConfirm = (note: ReceivingNoteListItem) => {
    setLoading(note.id);
    setPendingAction({
      title: '¿Confirmar remito?',
      description: `El remito ${note.fullNumber} será confirmado. Se actualizará el stock.`,
      action: () => confirmReceivingNote(note.id),
      successMessage: 'Remito confirmado correctamente',
    });
  };

  const handleCancel = (note: ReceivingNoteListItem) => {
    setLoading(note.id);
    setPendingAction({
      title: '¿Anular remito?',
      description: `El remito ${note.fullNumber} será anulado. Se revertirá el stock.`,
      action: () => cancelReceivingNote(note.id),
      successMessage: 'Remito anulado correctamente',
      destructive: true,
    });
  };

  const handleDelete = (note: ReceivingNoteListItem) => {
    setLoading(note.id);
    setPendingAction({
      title: '¿Eliminar remito?',
      description: `El remito ${note.fullNumber} será eliminado permanentemente. Esta acción no se puede deshacer.`,
      action: () => deleteReceivingNote(note.id),
      successMessage: 'Remito eliminado',
      destructive: true,
    });
  };

  const canUpdate = hasPermission('commercial.receiving-notes', 'update');
  const canApprove = hasPermission('commercial.receiving-notes', 'approve');
  const canDelete = hasPermission('commercial.receiving-notes', 'delete');

  const columns = useMemo(
    () =>
      getColumns({
        onView: (note) => router.push(`/dashboard/commercial/receiving-notes/${note.id}`),
        onEdit: canUpdate
          ? (note) => router.push(`/dashboard/commercial/receiving-notes/${note.id}/edit`)
          : undefined,
        onConfirm: canApprove ? handleConfirm : undefined,
        onCancel: canDelete ? handleCancel : undefined,
        onDelete: canDelete ? handleDelete : undefined,
        loading,
      }),
    [loading, canUpdate, canApprove, canDelete]
  );

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(RECEIVING_NOTE_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
      },
      {
        columnId: 'receptionDate',
        title: 'Fecha Recepción',
        type: 'dateRange' as const,
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
        searchPlaceholder="Buscar remitos de recepción..."
        facetedFilters={facetedFilters}
        tableId="commercial-receiving-notes"
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
