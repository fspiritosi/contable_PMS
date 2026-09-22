'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { DataTable, type DataTableSearchParams, type DataTableFacetedFilterConfig } from '@/shared/components/common/DataTable';
import { confirmPaymentOrder, getPaymentOrderEntryPreview } from '../../actions.server';
import type { PaymentOrderListItem } from '../../../../shared/types';
import { PAYMENT_ORDER_STATUS_LABELS } from '../../../../shared/validators';
import { _ConfirmEntryDialog } from '../../../../shared/components/_ConfirmEntryDialog';
import { getColumns } from '../columns';
import { PaymentOrderDetailModal } from './_PaymentOrderDetailModal';
import { EditPaymentOrderModal } from './_EditPaymentOrderModal';
import { CreatePaymentOrderModal } from './_CreatePaymentOrderModal';
import { _DeletePaymentOrderDialog } from './_DeletePaymentOrderDialog';
import { _PartnerRepaymentDialog } from '../../../partners/features/detail/components/_PartnerRepaymentDialog';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { Button } from '@/shared/components/ui/button';
import { Undo2 } from 'lucide-react';

interface FacetCounts {
  status: Record<string, number>;
}

interface Props {
  data: PaymentOrderListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  facetCounts?: FacetCounts;
}

export function _PaymentOrdersTable({ data, totalRows, searchParams, facetCounts }: Props) {
  const router = useRouter();
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedPaymentOrderId, setSelectedPaymentOrderId] = useState<string | null>(null);
  const [repayOpen, setRepayOpen] = useState(false);
  const { hasPermission } = usePermissions();

  const canCreate = hasPermission('commercial.treasury.payment-orders', 'create');
  const canEdit = hasPermission('commercial.treasury.payment-orders', 'update');
  const canApprove = hasPermission('commercial.treasury.payment-orders', 'approve');
  const canDelete = hasPermission('commercial.treasury.payment-orders', 'delete');

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'fullNumber',
        title: 'Número',
        type: 'text' as const,
        placeholder: 'Buscar por número...',
      },
      {
        columnId: 'supplier',
        title: 'Proveedor',
        type: 'text' as const,
        placeholder: 'Buscar por proveedor...',
      },
      {
        columnId: 'date',
        title: 'Fecha',
        type: 'dateRange' as const,
      },
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(PAYMENT_ORDER_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
        externalCounts: facetCounts?.status ? new Map(Object.entries(facetCounts.status)) : undefined,
      },
    ],
    [facetCounts]
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
        showSearch={false}
        facetedFilters={facetedFilters}
        tableId="commercial-payment-orders"
        showFilterToggle
        toolbarActions={
          canCreate ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRepayOpen(true)}>
                <Undo2 className="mr-2 h-4 w-4" />
                Devolver a socio
              </Button>
              <CreatePaymentOrderModal onSuccess={() => router.refresh()} />
            </div>
          ) : undefined
        }
      />

      {/* Devolución a un socio (OP de devolución de cuenta corriente) */}
      {canCreate && (
        <_PartnerRepaymentDialog
          open={repayOpen}
          onOpenChange={setRepayOpen}
          onSuccess={() => router.refresh()}
        />
      )}

      {/* Diálogo de Confirmación: vista previa del asiento + errores como dato (TSK-728) */}
      <_ConfirmEntryDialog
        documentId={selectedPaymentOrderId}
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        title="¿Confirmar orden de pago?"
        description="Al confirmar la orden de pago se registrarán los movimientos de caja/banco, se actualizará el estado de las facturas y se generará el asiento contable. Esta acción no se puede deshacer."
        previewQueryKey="paymentOrderEntryPreview"
        loadPreview={getPaymentOrderEntryPreview}
        confirm={confirmPaymentOrder}
        successMessage="Orden de pago confirmada correctamente"
        warningsTitle="La orden de pago se confirmó con avisos contables"
        onConfirmed={() => router.refresh()}
      />

      {/* Diálogo de Eliminación */}
      <_DeletePaymentOrderDialog
        paymentOrderId={selectedPaymentOrderId}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onDeleted={() => router.refresh()}
      />

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
