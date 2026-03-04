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
import { confirmPaymentOrder, deletePaymentOrder } from '../../actions.server';
import type { PaymentOrderListItem } from '../../../../shared/types';
import { PAYMENT_ORDER_STATUS_LABELS } from '../../../../shared/validators';
import { getColumns } from '../columns';
import { PaymentOrderDetailModal } from './_PaymentOrderDetailModal';
import { EditPaymentOrderModal } from './_EditPaymentOrderModal';
import { CreatePaymentOrderModal } from './_CreatePaymentOrderModal';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface Props {
  data: PaymentOrderListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

export function _PaymentOrdersTable({ data, totalRows, searchParams }: Props) {
  const router = useRouter();
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedPaymentOrderId, setSelectedPaymentOrderId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { hasPermission } = usePermissions();

  const handleConfirm = async () => {
    if (!selectedPaymentOrderId) return;

    setIsConfirming(true);
    try {
      await confirmPaymentOrder(selectedPaymentOrderId);
      toast.success('Orden de pago confirmada correctamente');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al confirmar orden de pago');
    } finally {
      setIsConfirming(false);
      setConfirmDialogOpen(false);
      setSelectedPaymentOrderId(null);
    }
  };

  const handleDelete = async () => {
    if (!selectedPaymentOrderId) return;

    setIsDeleting(true);
    try {
      await deletePaymentOrder(selectedPaymentOrderId);
      toast.success('Orden de pago eliminada correctamente');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar orden de pago');
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setSelectedPaymentOrderId(null);
    }
  };

  const canCreate = hasPermission('commercial.treasury.payment-orders', 'create');
  const canEdit = hasPermission('commercial.treasury.payment-orders', 'update');
  const canApprove = hasPermission('commercial.treasury.payment-orders', 'approve');
  const canDelete = hasPermission('commercial.treasury.payment-orders', 'delete');

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(PAYMENT_ORDER_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
      },
      {
        columnId: 'date',
        title: 'Fecha',
        type: 'dateRange' as const,
      },
    ],
    []
  );

  const columns = useMemo(
    () =>
      getColumns({
        onViewDetail: (order) => {
          setSelectedPaymentOrderId(order.id);
          setDetailModalOpen(true);
        },
        onEdit: (order) => {
          setSelectedPaymentOrderId(order.id);
          setEditModalOpen(true);
        },
        onConfirm: (order) => {
          setSelectedPaymentOrderId(order.id);
          setConfirmDialogOpen(true);
        },
        onDelete: (order) => {
          setSelectedPaymentOrderId(order.id);
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
        searchPlaceholder="Buscar órdenes de pago..."
        facetedFilters={facetedFilters}
        tableId="commercial-payment-orders"
        showFilterToggle
        toolbarActions={canCreate ? <CreatePaymentOrderModal onSuccess={() => router.refresh()} /> : undefined}
      />

      {/* Diálogo de Confirmación */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar orden de pago?</AlertDialogTitle>
            <AlertDialogDescription>
              Al confirmar la orden de pago se registrarán los movimientos de caja/banco y se actualizará el estado
              de las facturas. Esta acción no se puede deshacer.
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
            <AlertDialogTitle>¿Eliminar orden de pago?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente la orden de pago y todos sus registros asociados.
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
      <PaymentOrderDetailModal
        paymentOrderId={selectedPaymentOrderId}
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
      />

      {/* Modal de Edición */}
      <EditPaymentOrderModal
        paymentOrderId={selectedPaymentOrderId}
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
      />
    </>
  );
}
