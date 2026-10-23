'use client';

import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { getPaymentOrder } from '../../actions.server';
import { CreatePaymentOrderModal } from './_CreatePaymentOrderModal';
import { isCorrectableStatus } from '@/modules/commercial/shared/correctable-status';
import {
  PAYMENT_ORDER_STATUS_LABELS,
  type CreatePaymentOrderFormData,
} from '../../../../shared/validators';

interface EditPaymentOrderModalProps {
  paymentOrderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function EditPaymentOrderModal({
  paymentOrderId,
  open,
  onOpenChange,
  onSuccess,
}: EditPaymentOrderModalProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['paymentOrder', paymentOrderId],
    queryFn: () => getPaymentOrder(paymentOrderId!),
    enabled: open && Boolean(paymentOrderId),
  });

  const handleSuccess = () => {
    onSuccess?.();
    onOpenChange(false);
  };

  if (!open || !paymentOrderId) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Orden de Pago</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Editar Orden de Pago</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (error || !data) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Orden de Pago</DialogTitle>
          </DialogHeader>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error instanceof Error ? error.message : 'No se pudo cargar la orden de pago'}
            </AlertDescription>
          </Alert>
        </DialogContent>
      </Dialog>
    );
  }

  // Borrador: edición directa. Confirmada: corrección en cadena (TSK-792).
  const isCorrection = isCorrectableStatus(data.status);
  if (data.status !== 'DRAFT' && !isCorrection) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Orden de Pago {data.fullNumber}</DialogTitle>
          </DialogHeader>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Esta orden de pago no se puede editar porque está en estado{' '}
              <strong>{PAYMENT_ORDER_STATUS_LABELS[data.status]}</strong>. Solo se pueden editar órdenes
              en estado Borrador o Confirmada.
            </AlertDescription>
          </Alert>
        </DialogContent>
      </Dialog>
    );
  }

  // Mapear al formato esperado por el form
  const initialPayments: CreatePaymentOrderFormData['payments'] = data.payments.map((p) => ({
    paymentMethod: p.paymentMethod,
    amount: p.amount.toString(),
    cashRegisterId: p.cashRegisterId ?? null,
    bankAccountId: p.bankAccountId ?? null,
    checkNumber: p.checkNumber,
    cardLast4: p.cardLast4,
    cardId: 'cardId' in p ? (p.cardId as string | null) ?? null : null,
    installmentsCount:
      'installmentsCount' in p ? (p.installmentsCount as number | null) ?? null : null,
    reference: p.reference,
    checkBankName: p.checkBankName,
    checkIssueDate: p.checkIssueDate ? new Date(p.checkIssueDate) : null,
    checkDueDate: p.checkDueDate ? new Date(p.checkDueDate) : null,
    checkDrawerName: p.checkDrawerName,
    checkDrawerTaxId: p.checkDrawerTaxId,
    checkOwnership: p.endorsedCheckId ? ('THIRD_PARTY' as const) : ('OWN' as const),
    endorsedCheckId: p.endorsedCheckId,
  }));

  const initialWithholdings: CreatePaymentOrderFormData['withholdings'] = data.withholdings.map(
    (w) => ({
      taxType: w.taxType,
      rate: w.rate.toString(),
      amount: w.amount.toString(),
      certificateNumber: w.certificateNumber,
    })
  );

  // Separar items en invoices y expenses para pre-cargar
  const prefilledInvoices = data.items
    .filter((item) => item.invoice)
    .map((item) => ({
      id: item.invoice!.id,
      // En modo edición usamos el monto actual del item, no el pendiente
      pendingAmount: item.amount,
    }));

  const prefilledExpenses = data.items
    .filter((item) => item.expense)
    .map((item) => ({
      id: item.expense!.id,
      amount: item.amount,
    }));

  const itemInfo = Object.fromEntries(
    data.items.flatMap((item) => {
      const doc = item.invoice ?? item.expense;
      return doc ? [[doc.id, { label: doc.fullNumber, own: item.amount }]] : [];
    })
  );

  return (
    <CreatePaymentOrderModal
      key={data.id}
      isCorrection={isCorrection}
      itemInfo={itemInfo}
      onSuccess={handleSuccess}
      prefilledSupplierId={data.supplier?.id}
      prefilledInvoices={prefilledInvoices}
      prefilledExpenses={prefilledExpenses}
      editPaymentOrderId={paymentOrderId}
      initialDate={new Date(data.date)}
      initialNotes={data.notes}
      initialPayments={initialPayments}
      initialWithholdings={initialWithholdings}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}