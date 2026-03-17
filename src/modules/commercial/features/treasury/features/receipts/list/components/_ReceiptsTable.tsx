'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

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
import { confirmReceipt, deleteReceipt } from '../../actions.server';
import type { ReceiptListItem } from '../../../../shared/types';
import { RECEIPT_STATUS_LABELS } from '../../../../shared/validators';
import { getColumns } from '../columns';
import { ReceiptDetailModal } from './_ReceiptDetailModal';
import { EditReceiptModal } from './_EditReceiptModal';
import { CreateReceiptModal } from './_CreateReceiptModal';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface Props {
  data: ReceiptListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

export function _ReceiptsTable({ data, totalRows, searchParams }: Props) {
  const router = useRouter();
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { hasPermission } = usePermissions();

  const handleConfirm = async () => {
    if (!selectedReceiptId) return;

    setIsConfirming(true);
    try {
      await confirmReceipt(selectedReceiptId);
      toast.success('Recibo confirmado correctamente');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al confirmar recibo');
    } finally {
      setIsConfirming(false);
      setConfirmDialogOpen(false);
      setSelectedReceiptId(null);
    }
  };

  const handleDelete = async () => {
    if (!selectedReceiptId) return;

    setIsDeleting(true);
    try {
      await deleteReceipt(selectedReceiptId);
      toast.success('Recibo eliminado correctamente');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar recibo');
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setSelectedReceiptId(null);
    }
  };

  const canCreate = hasPermission('commercial.treasury.receipts', 'create');
  const canEdit = hasPermission('commercial.treasury.receipts', 'update');
  const canApprove = hasPermission('commercial.treasury.receipts', 'approve');
  const canDelete = hasPermission('commercial.treasury.receipts', 'delete');

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'fullNumber',
        title: 'Número',
        type: 'text' as const,
        placeholder: 'Buscar por número...',
      },
      {
        columnId: 'customer',
        title: 'Cliente',
        type: 'text' as const,
        placeholder: 'Buscar por cliente...',
      },
      {
        columnId: 'date',
        title: 'Fecha',
        type: 'dateRange' as const,
      },
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(RECEIPT_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
      },
    ],
    []
  );

  const columns = useMemo(
    () =>
      getColumns({
        onViewDetail: (receipt) => {
          setSelectedReceiptId(receipt.id);
          setDetailModalOpen(true);
        },
        onEdit: (receipt) => {
          setSelectedReceiptId(receipt.id);
          setEditModalOpen(true);
        },
        onConfirm: (receipt) => {
          setSelectedReceiptId(receipt.id);
          setConfirmDialogOpen(true);
        },
        onDelete: (receipt) => {
          setSelectedReceiptId(receipt.id);
          setDeleteDialogOpen(true);
        },
        canEdit,
        canApprove,
        canDelete,
      }),
    [canEdit, canApprove, canDelete]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        showSearch={false}
        facetedFilters={facetedFilters}
        tableId="commercial-receipts"
        showFilterToggle
        toolbarActions={canCreate ? <CreateReceiptModal onSuccess={() => router.refresh()} /> : undefined}
      />

      {/* Diálogo de Confirmación */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar recibo?</AlertDialogTitle>
            <AlertDialogDescription>
              Al confirmar el recibo se registrarán los movimientos de caja/banco y se actualizará el estado de las
              facturas. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isConfirming}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isConfirming}>
              {isConfirming ? 'Confirmando...' : 'Confirmar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo de Eliminación */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar recibo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente el recibo y todos sus registros asociados.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de Detalle */}
      <ReceiptDetailModal
        receiptId={selectedReceiptId}
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
      />

      {/* Modal de Edición */}
      <EditReceiptModal
        receiptId={selectedReceiptId}
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
      />
    </>
  );
}
