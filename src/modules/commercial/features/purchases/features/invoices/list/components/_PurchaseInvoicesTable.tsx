'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { usePermissions } from '@/shared/hooks/usePermissions';

import { DataTable, type DataTableExportConfig, type DataTableSearchParams, type DataTableFacetedFilterConfig } from '@/shared/components/common/DataTable';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { PackageCheck } from 'lucide-react';
import moment from 'moment';
import type { PurchaseInvoiceListItem } from '../actions.server';
import { confirmPurchaseInvoice, cancelPurchaseInvoice, getAllPurchaseInvoicesForExport } from '../actions.server';
import { getColumns } from '../columns';
import { PURCHASE_INVOICE_STATUS_LABELS, VOUCHER_TYPE_LABELS } from '../../shared/validators';

interface FacetCounts {
  status: Record<string, number>;
  voucherType: Record<string, number>;
}

interface PurchaseInvoicesTableProps {
  data: PurchaseInvoiceListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  facetCounts?: FacetCounts;
}

type AlertAction = {
  type: 'confirm' | 'cancel';
  invoice: PurchaseInvoiceListItem;
};

type ReceivingNotePrompt = {
  invoiceId: string;
  supplierId: string;
};

export function _PurchaseInvoicesTable({ data, totalRows, searchParams, facetCounts }: PurchaseInvoicesTableProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [loading, setLoading] = useState<string | null>(null);
  const [alertAction, setAlertAction] = useState<AlertAction | null>(null);
  const [receivingNotePrompt, setReceivingNotePrompt] = useState<ReceivingNotePrompt | null>(null);

  const handleConfirm = async () => {
    if (!alertAction || alertAction.type !== 'confirm') return;
    const invoice = alertAction.invoice;
    setAlertAction(null);

    try {
      setLoading(invoice.id);
      const result = await confirmPurchaseInvoice(invoice.id);
      toast.success('Factura confirmada correctamente');
      router.refresh();

      if (result.needsReceivingNote) {
        setReceivingNotePrompt({
          invoiceId: result.id,
          supplierId: result.supplierId,
        });
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al confirmar la factura'
      );
    } finally {
      setLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!alertAction || alertAction.type !== 'cancel') return;
    const invoice = alertAction.invoice;
    setAlertAction(null);

    try {
      setLoading(invoice.id);
      await cancelPurchaseInvoice(invoice.id);
      toast.success('Factura cancelada correctamente');
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al cancelar la factura'
      );
    } finally {
      setLoading(null);
    }
  };

  const canUpdate = hasPermission('commercial.purchases', 'update');
  const canApprove = hasPermission('commercial.purchases', 'approve');
  const canDelete = hasPermission('commercial.purchases', 'delete');

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(PURCHASE_INVOICE_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
        externalCounts: facetCounts?.status ? new Map(Object.entries(facetCounts.status)) : undefined,
      },
      {
        columnId: 'voucherType',
        title: 'Tipo',
        options: Object.entries(VOUCHER_TYPE_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
        externalCounts: facetCounts?.voucherType ? new Map(Object.entries(facetCounts.voucherType)) : undefined,
      },
      {
        columnId: 'supplier',
        title: 'Proveedor',
        type: 'text' as const,
        placeholder: 'Buscar por proveedor...',
      },
      {
        columnId: 'fullNumber',
        title: 'Número',
        type: 'text' as const,
        placeholder: 'Buscar por número...',
      },
      {
        columnId: 'issueDate',
        title: 'Fecha',
        type: 'dateRange' as const,
      },
    ],
    [facetCounts]
  );

  const columns = useMemo(
    () =>
      getColumns({
        onView: (invoice) => router.push(`/dashboard/commercial/purchases/${invoice.id}`),
        onEdit: canUpdate
          ? (invoice) => router.push(`/dashboard/commercial/purchases/${invoice.id}/edit`)
          : undefined,
        onConfirm: canApprove
          ? (invoice) => setAlertAction({ type: 'confirm', invoice })
          : undefined,
        onCancel: canDelete
          ? (invoice) => setAlertAction({ type: 'cancel', invoice })
          : undefined,
        loading,
      }),
    [loading, canUpdate, canApprove, canDelete]
  );

  const exportConfig = useMemo(
    () => ({
      fetchAllData: () => getAllPurchaseInvoicesForExport(searchParams),
      options: {
        filename: 'facturas-compra',
        title: 'Facturas de Compra',
        sheetName: 'Facturas',
      },
      formatters: {
        status: (val: unknown) => PURCHASE_INVOICE_STATUS_LABELS[val as keyof typeof PURCHASE_INVOICE_STATUS_LABELS] || String(val),
        voucherType: (val: unknown) => VOUCHER_TYPE_LABELS[val as keyof typeof VOUCHER_TYPE_LABELS] || String(val),
        issueDate: (val: unknown) => val ? moment(val as string).format('DD/MM/YYYY') : '',
        dueDate: (val: unknown) => val ? moment(val as string).format('DD/MM/YYYY') : '',
        total: (val: unknown) => Number(val),
        subtotal: (val: unknown) => Number(val),
        vatAmount: (val: unknown) => Number(val),
      },
      excludeColumns: ['actions'],
    }) satisfies DataTableExportConfig<Record<string, unknown>>,
    [searchParams]
  ) as unknown as DataTableExportConfig<PurchaseInvoiceListItem>;

  const alertTitle = alertAction?.type === 'confirm' ? '¿Confirmar factura?' : '¿Cancelar factura?';
  const alertDescription = alertAction?.type === 'confirm'
    ? `¿Desea confirmar la factura ${alertAction?.invoice.fullNumber}?`
    : `¿Desea cancelar la factura ${alertAction?.invoice.fullNumber}?`;
  const alertActionLabel = alertAction?.type === 'confirm' ? 'Confirmar' : 'Cancelar factura';

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        showSearch={false}
        facetedFilters={facetedFilters}
        tableId="commercial-purchase-invoices"
        showFilterToggle
        exportConfig={exportConfig}
      />

      <AlertDialog open={!!alertAction} onOpenChange={(open) => !open && setAlertAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{alertTitle}</AlertDialogTitle>
            <AlertDialogDescription>{alertDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={alertAction?.type === 'confirm' ? handleConfirm : handleCancel}
            >
              {alertActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!receivingNotePrompt}
        onOpenChange={(open) => !open && setReceivingNotePrompt(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5" />
              Recepción de mercadería
            </DialogTitle>
            <DialogDescription>
              Esta factura tiene productos que controlan stock. ¿Desea crear un remito
              de recepción para registrar el ingreso de la mercadería al almacén?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setReceivingNotePrompt(null)}
            >
              Más tarde
            </Button>
            <Button
              onClick={() => {
                if (receivingNotePrompt) {
                  router.push(
                    `/dashboard/commercial/receiving-notes/new?purchaseInvoiceId=${receivingNotePrompt.invoiceId}&supplierId=${receivingNotePrompt.supplierId}`
                  );
                }
                setReceivingNotePrompt(null);
              }}
            >
              Crear remito
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
