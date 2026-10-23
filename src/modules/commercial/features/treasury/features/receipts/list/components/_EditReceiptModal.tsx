'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Skeleton } from '@/shared/components/ui/skeleton';

import { RECEIPT_STATUS_LABELS } from '../../../../shared/validators';
import { getReceipt } from '../../actions.server';
import { CreateReceiptModal } from './_CreateReceiptModal';
import { receiptToFormValues } from './receipt-form-utils';

interface EditReceiptModalProps {
  receiptId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/** Edición de un recibo en borrador: carga el recibo y abre el formulario en modo edición. */
export function EditReceiptModal({
  receiptId,
  open,
  onOpenChange,
  onSuccess,
}: EditReceiptModalProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['receipt', receiptId],
    queryFn: () => getReceipt(receiptId!),
    enabled: open && Boolean(receiptId),
  });

  const shell = (title: string, body: ReactNode, wide = false) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={wide ? 'md:min-w-[800px]' : 'max-w-md'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );

  if (!open || !receiptId) return null;

  if (isLoading) {
    return shell(
      'Editar Recibo de Cobro',
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>,
      true
    );
  }

  if (error || !data) {
    return shell(
      'Editar Recibo de Cobro',
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {error instanceof Error ? error.message : 'No se pudo cargar el recibo'}
        </AlertDescription>
      </Alert>
    );
  }

  // Solo se editan borradores; los confirmados se corrigen con la corrección en cadena
  if (data.status !== 'DRAFT') {
    return shell(
      `Editar Recibo ${data.fullNumber}`,
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Este recibo no se puede editar porque está{' '}
          <strong>{RECEIPT_STATUS_LABELS[data.status]}</strong>. Solo se pueden editar recibos en
          Borrador.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <CreateReceiptModal
      key={data.id}
      open={open}
      onOpenChange={onOpenChange}
      onSuccess={() => onSuccess?.()}
      editReceiptId={data.id}
      editReceiptNumber={data.fullNumber}
      initialValues={receiptToFormValues(data)}
      initialInvoiceLabels={Object.fromEntries(
        data.items.map((item) => [item.invoice.id, item.invoice.fullNumber])
      )}
    />
  );
}
