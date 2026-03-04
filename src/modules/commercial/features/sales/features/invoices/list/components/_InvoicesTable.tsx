'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { usePermissions } from '@/shared/hooks/usePermissions';

import { DataTable, type DataTableSearchParams, type DataTableFacetedFilterConfig } from '@/shared/components/common/DataTable';
import { VOUCHER_TYPE_LABELS, INVOICE_STATUS_LABELS } from '../../shared/validators';
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
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { _DocumentAttachment } from '@/modules/commercial/shared/components/_DocumentAttachment';
import { confirmInvoice, cancelInvoice, type getInvoices } from '../actions.server';
import { getColumns } from '../columns';

type Invoice = Awaited<ReturnType<typeof getInvoices>>[number];

interface Props {
  data: Invoice[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

export function _InvoicesTable({ data, totalRows, searchParams }: Props) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirmInvoice = async () => {
    if (!selectedInvoice) return;

    setIsProcessing(true);
    try {
      await confirmInvoice(selectedInvoice.id);
      toast.success('Factura confirmada y stock descontado correctamente');
      setConfirmDialogOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al confirmar la factura');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelInvoice = async () => {
    if (!selectedInvoice) return;

    setIsProcessing(true);
    try {
      await cancelInvoice(selectedInvoice.id);
      toast.success('Factura anulada correctamente');
      setCancelDialogOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al anular la factura');
    } finally {
      setIsProcessing(false);
    }
  };

  const canUpdate = hasPermission('commercial.invoices', 'update');
  const canApprove = hasPermission('commercial.invoices', 'approve');
  const canDelete = hasPermission('commercial.invoices', 'delete');

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
      },
      {
        columnId: 'voucherType',
        title: 'Tipo',
        options: Object.entries(VOUCHER_TYPE_LABELS).map(([value, label]) => ({
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
        onView: (invoice) => {
          router.push(`/dashboard/commercial/invoices/${invoice.id}`);
        },
        onEdit: canUpdate
          ? (invoice) => {
              router.push(`/dashboard/commercial/invoices/${invoice.id}/edit`);
            }
          : undefined,
        onConfirm: canApprove
          ? (invoice) => {
              setSelectedInvoice(invoice);
              setConfirmDialogOpen(true);
            }
          : undefined,
        onCancel: canDelete
          ? (invoice) => {
              setSelectedInvoice(invoice);
              setCancelDialogOpen(true);
            }
          : undefined,
        onAttach: (invoice) => {
          setSelectedInvoice(invoice);
          setAttachDialogOpen(true);
        },
      }),
    [canUpdate, canApprove, canDelete]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar facturas..."
        facetedFilters={facetedFilters}
        tableId="commercial-sales-invoices"
        showFilterToggle
      />

      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar factura?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción confirmará la factura{' '}
              <strong>{selectedInvoice?.fullNumber}</strong> y descontará el stock de los
              productos. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmInvoice} disabled={isProcessing}>
              {isProcessing ? 'Confirmando...' : 'Confirmar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular factura?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción anulará la factura <strong>{selectedInvoice?.fullNumber}</strong>.
              Si la factura fue confirmada, el stock será restaurado automáticamente.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelInvoice}
              disabled={isProcessing}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isProcessing ? 'Anulando...' : 'Anular'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={attachDialogOpen} onOpenChange={setAttachDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Documento Adjunto - {selectedInvoice?.fullNumber}
            </DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <_DocumentAttachment
              documentType="sales-invoice"
              documentId={selectedInvoice.id}
              companyId={selectedInvoice.companyId}
              companyName={selectedInvoice.company.name}
              documentNumber={selectedInvoice.fullNumber}
              hasDocument={!!selectedInvoice.documentUrl}
              documentUrl={selectedInvoice.documentUrl}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
