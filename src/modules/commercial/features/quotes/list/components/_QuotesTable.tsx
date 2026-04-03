'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { usePermissions } from '@/shared/hooks/usePermissions';

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
import { Button } from '@/shared/components/ui/button';

import { updateQuoteStatus, deleteQuote, duplicateQuote } from '../actions.server';
import { getColumns, type QuoteListItem } from '../columns';
import { QUOTE_STATUS_LABELS } from '../../shared/validators';

interface Props {
  data: QuoteListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

type DialogAction =
  | { type: 'delete'; quote: QuoteListItem }
  | { type: 'status'; quote: QuoteListItem; newStatus: string };

export function _QuotesTable({ data, totalRows, searchParams }: Props) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [dialogAction, setDialogAction] = useState<DialogAction | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const canCreate = hasPermission('commercial.quotes', 'create');
  const canUpdate = hasPermission('commercial.quotes', 'update');
  const canApprove = hasPermission('commercial.quotes', 'approve');
  const canDelete = hasPermission('commercial.quotes', 'delete');

  const handleStatusChange = async () => {
    if (dialogAction?.type !== 'status') return;

    setIsProcessing(true);
    try {
      await updateQuoteStatus(dialogAction.quote.id, dialogAction.newStatus);
      const statusLabel = QUOTE_STATUS_LABELS[dialogAction.newStatus] ?? dialogAction.newStatus;
      toast.success(`Presupuesto marcado como "${statusLabel}"`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al cambiar estado del presupuesto',
      );
    } finally {
      setIsProcessing(false);
      setDialogAction(null);
    }
  };

  const handleDelete = async () => {
    if (dialogAction?.type !== 'delete') return;

    setIsProcessing(true);
    try {
      await deleteQuote(dialogAction.quote.id);
      toast.success('Presupuesto eliminado correctamente');
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al eliminar el presupuesto',
      );
    } finally {
      setIsProcessing(false);
      setDialogAction(null);
    }
  };

  const handleDuplicate = async (quote: QuoteListItem) => {
    try {
      const result = await duplicateQuote(quote.id);
      toast.success('Presupuesto duplicado correctamente');
      router.push(`/dashboard/company/commercial/quotes/${result.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al duplicar el presupuesto',
      );
    }
  };

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'number',
        title: 'Número',
        type: 'text' as const,
        placeholder: 'Buscar por número...',
      },
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(QUOTE_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
      },
      {
        columnId: 'issueDate',
        title: 'Fecha',
        type: 'dateRange' as const,
      },
    ],
    [],
  );

  const columns = useMemo(
    () =>
      getColumns({
        onView: (quote) => {
          router.push(`/dashboard/company/commercial/quotes/${quote.id}`);
        },
        onEdit: canUpdate
          ? (quote) => {
              router.push(`/dashboard/company/commercial/quotes/${quote.id}/edit`);
            }
          : undefined,
        onDuplicate: canCreate ? handleDuplicate : undefined,
        onUpdateStatus: canUpdate || canApprove
          ? (quote, newStatus) => {
              setDialogAction({ type: 'status', quote, newStatus });
            }
          : undefined,
        onDelete: canDelete
          ? (quote) => {
              setDialogAction({ type: 'delete', quote });
            }
          : undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canUpdate, canCreate, canApprove, canDelete],
  );

  const statusLabel =
    dialogAction?.type === 'status'
      ? (QUOTE_STATUS_LABELS[dialogAction.newStatus] ?? dialogAction.newStatus)
      : '';

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar por número o destinatario..."
        facetedFilters={facetedFilters}
        tableId="commercial-quotes"
        showFilterToggle
        toolbarActions={
          canCreate ? (
            <Button
              onClick={() => router.push('/dashboard/company/commercial/quotes/new')}
              size="sm"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Presupuesto
            </Button>
          ) : undefined
        }
      />

      {/* Diálogo de cambio de estado */}
      <AlertDialog
        open={dialogAction?.type === 'status'}
        onOpenChange={(open) => {
          if (!open) setDialogAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cambiar estado del presupuesto</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que deseas marcar el presupuesto{' '}
              {dialogAction?.type === 'status' ? dialogAction.quote.number : ''} como &quot;
              {statusLabel}&quot;?
              {dialogAction?.type === 'status' &&
                dialogAction.newStatus === 'REJECTED' &&
                ' Esta acción no se puede deshacer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStatusChange}
              disabled={isProcessing}
              className={
                dialogAction?.type === 'status' && dialogAction.newStatus === 'REJECTED'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
            >
              {isProcessing ? 'Procesando...' : 'Confirmar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo de eliminación */}
      <AlertDialog
        open={dialogAction?.type === 'delete'}
        onOpenChange={(open) => {
          if (!open) setDialogAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar presupuesto</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente el presupuesto{' '}
              {dialogAction?.type === 'delete' ? dialogAction.quote.number : ''} y todas sus
              líneas. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isProcessing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isProcessing ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
