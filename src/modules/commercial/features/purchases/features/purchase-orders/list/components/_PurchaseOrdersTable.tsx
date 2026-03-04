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
import type { PurchaseOrderListItem } from '../actions.server';
import {
  submitForApproval,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
} from '../actions.server';
import { getColumns } from '../columns';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_INVOICING_STATUS_LABELS,
} from '../../shared/validators';

interface PurchaseOrdersTableProps {
  data: PurchaseOrderListItem[];
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

export function _PurchaseOrdersTable({ data, totalRows, searchParams }: PurchaseOrdersTableProps) {
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

  const handleSubmitForApproval = (order: PurchaseOrderListItem) => {
    setLoading(order.id);
    setPendingAction({
      title: '¿Enviar a aprobación?',
      description: `La orden ${order.fullNumber} será enviada a aprobación.`,
      action: () => submitForApproval(order.id),
      successMessage: 'Orden enviada a aprobación',
    });
  };

  const handleApprove = (order: PurchaseOrderListItem) => {
    setLoading(order.id);
    setPendingAction({
      title: '¿Aprobar orden?',
      description: `La orden ${order.fullNumber} será aprobada.`,
      action: () => approvePurchaseOrder(order.id),
      successMessage: 'Orden aprobada correctamente',
    });
  };

  const handleCancel = (order: PurchaseOrderListItem) => {
    setLoading(order.id);
    setPendingAction({
      title: '¿Cancelar orden?',
      description: `La orden ${order.fullNumber} será cancelada.`,
      action: () => cancelPurchaseOrder(order.id),
      successMessage: 'Orden cancelada',
      destructive: true,
    });
  };

  const handleDelete = (order: PurchaseOrderListItem) => {
    setLoading(order.id);
    setPendingAction({
      title: '¿Eliminar orden?',
      description: `La orden ${order.fullNumber} será eliminada permanentemente. Esta acción no se puede deshacer.`,
      action: () => deletePurchaseOrder(order.id),
      successMessage: 'Orden eliminada',
      destructive: true,
    });
  };

  const canUpdate = hasPermission('commercial.purchase-orders', 'update');
  const canApprove = hasPermission('commercial.purchase-orders', 'approve');
  const canDelete = hasPermission('commercial.purchase-orders', 'delete');

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'status',
        title: 'Recepción',
        options: Object.entries(PURCHASE_ORDER_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
      },
      {
        columnId: 'invoicingStatus',
        title: 'Facturación',
        options: Object.entries(PURCHASE_ORDER_INVOICING_STATUS_LABELS).map(([value, label]) => ({
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
    []
  );

  const columns = useMemo(
    () =>
      getColumns({
        onView: (order) => router.push(`/dashboard/commercial/purchase-orders/${order.id}`),
        onEdit: canUpdate
          ? (order) => router.push(`/dashboard/commercial/purchase-orders/${order.id}`)
          : undefined,
        onSubmitForApproval: canUpdate ? handleSubmitForApproval : undefined,
        onApprove: canApprove ? handleApprove : undefined,
        onCancel: canDelete ? handleCancel : undefined,
        onDelete: canDelete ? handleDelete : undefined,
        loading,
      }),
    [loading, canUpdate, canApprove, canDelete]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar órdenes de compra..."
        facetedFilters={facetedFilters}
        tableId="commercial-purchase-orders"
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
