'use client';

import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { getPaymentOrder } from '../../actions.server';
import { CreatePaymentOrderModal } from './_CreatePaymentOrderModal';
import type { CreatePaymentOrderFormData } from '../../../../shared/validators';

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

  // Si la OP ya no está en DRAFT, no se puede editar
  if (data.status !== 'DRAFT') {
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
              <strong>{data.status}</strong>. Solo se pueden editar órdenes en estado Borrador.
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
    reference: p.reference,
    checkBankName: null,
    checkIssueDate: null,
    checkDueDate: null,
    checkDrawerName: null,
    checkDrawerTaxId: null,
    checkOwnership: 'OWN' as const,
    endorsedCheckId: null,
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

  return (
    <CreatePaymentOrderModal
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