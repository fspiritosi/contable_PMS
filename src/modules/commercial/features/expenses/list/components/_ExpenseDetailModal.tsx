'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import moment from 'moment';
import { CheckCircle, XCircle, Link2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
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
import { Separator } from '@/shared/components/ui/separator';
import { logger } from '@/shared/lib/logger';
import { cn } from '@/shared/lib/utils';

import { getExpenseById, confirmExpense, cancelExpense } from '../../actions.server';
import { EXPENSE_STATUS_LABELS } from '../../validators';
import { _ExpenseAttachments } from '../../components/_ExpenseAttachments';
import { _LinkToProjectionModal } from '@/modules/commercial/shared/components/_LinkToProjectionModal';

type ExpenseDetail = Awaited<ReturnType<typeof getExpenseById>>;

type ExpenseStatus = keyof typeof EXPENSE_STATUS_LABELS;

type BadgeVariant = 'secondary' | 'default' | 'outline' | 'destructive';

const STATUS_BADGE_VARIANTS: Record<string, BadgeVariant> = {
  DRAFT: 'secondary',
  CONFIRMED: 'default',
  PARTIAL_PAID: 'outline',
  PAID: 'default',
  CANCELLED: 'destructive',
};

interface ExpenseDetailModalProps {
  expenseId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function _ExpenseDetailModal({ expenseId, open, onOpenChange, onSuccess }: ExpenseDetailModalProps) {
  const router = useRouter();
  const [expense, setExpense] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [linkProjectionOpen, setLinkProjectionOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const loadExpense = useCallback(async () => {
    if (!expenseId) return;

    setLoading(true);
    try {
      const data = await getExpenseById(expenseId);
      setExpense(data);
    } catch (error) {
      logger.error('Error al cargar egreso', { data: { error } });
      toast.error('Error al cargar el detalle del egreso');
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  useEffect(() => {
    if (open && expenseId) {
      loadExpense();
    } else if (!open) {
      setExpense(null);
    }
  }, [open, expenseId, loadExpense]);

  const handleConfirm = async () => {
    if (!expense) return;

    setIsProcessing(true);
    try {
      const result = await confirmExpense(expense.id);
      toast.success('Egreso confirmado correctamente');

      // Mostrar advertencia presupuestaria si existe (no bloqueante)
      if (result.budgetWarning) {
        toast.warning('Advertencia de presupuesto', {
          description: result.budgetWarning.message,
          duration: 10000,
        });
      }

      setConfirmDialogOpen(false);
      router.refresh();
      onSuccess?.();
      await loadExpense();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al confirmar egreso');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = async () => {
    if (!expense) return;

    setIsProcessing(true);
    try {
      await cancelExpense(expense.id);
      toast.success('Egreso cancelado correctamente');
      setCancelDialogOpen(false);
      router.refresh();
      onSuccess?.();
      await loadExpense();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cancelar egreso');
    } finally {
      setIsProcessing(false);
    }
  };

  const isDraft = expense?.status === 'DRAFT';
  const isConfirmed = expense?.status === 'CONFIRMED';
  const canCancel = isDraft || isConfirmed;
  const hasPayments = (expense?.paymentOrderItems?.length ?? 0) > 0;
  const isPaid = expense?.status === 'PAID';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detalle de Egreso</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : expense ? (
            <div className="space-y-4">
              {/* Información General */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">Información General</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={STATUS_BADGE_VARIANTS[expense.status] ?? 'default'}
                        className={cn(isPaid && 'bg-green-600 hover:bg-green-700 text-white')}
                      >
                        {EXPENSE_STATUS_LABELS[expense.status as ExpenseStatus] ?? expense.status}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Número</p>
                      <p className="font-medium">{expense.fullNumber}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Categoría</p>
                      <p className="font-medium">{expense.category.name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Fecha</p>
                      <p className="font-medium">{moment(expense.date).format('DD/MM/YYYY')}</p>
                    </div>
                    {expense.dueDate && (
                      <div>
                        <p className="text-sm text-muted-foreground">Vencimiento</p>
                        <p
                          className={cn(
                            'font-medium',
                            !isPaid &&
                              expense.status !== 'CANCELLED' &&
                              moment(expense.dueDate).isBefore(moment(), 'day') &&
                              'text-red-600'
                          )}
                        >
                          {moment(expense.dueDate).format('DD/MM/YYYY')}
                        </p>
                      </div>
                    )}
                    <div className="col-span-2">
                      <p className="text-sm text-muted-foreground">Descripción</p>
                      <p className="font-medium">{expense.description}</p>
                    </div>
                    {expense.supplier && (
                      <div className="col-span-2">
                        <p className="text-sm text-muted-foreground">Proveedor</p>
                        <p className="font-medium">
                          {expense.supplier.tradeName || expense.supplier.businessName}
                        </p>
                        {expense.supplier.taxId && (
                          <p className="text-xs text-muted-foreground">
                            CUIT: {expense.supplier.taxId}
                          </p>
                        )}
                      </div>
                    )}
                    {expense.notes && (
                      <div className="col-span-2">
                        <p className="text-sm text-muted-foreground">Notas</p>
                        <p className="text-sm">{expense.notes}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Resumen de Pagos */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Resumen Financiero</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Monto Total</span>
                      <span className="font-medium">
                        ${expense.amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Pagado</span>
                      <span className="font-medium text-green-600">
                        -${expense.paidAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Pendiente</span>
                      <span className={cn('font-bold text-lg', expense.pendingAmount > 0 ? 'text-orange-600' : 'text-green-600')}>
                        ${expense.pendingAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Órdenes de Pago Vinculadas */}
              {expense.paymentOrderItems.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Órdenes de Pago</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {expense.paymentOrderItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between items-center p-3 border rounded-lg"
                        >
                          <div>
                            <p className="font-medium">{item.paymentOrder.fullNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              {moment(item.paymentOrder.date).format('DD/MM/YYYY')} &middot;{' '}
                              {item.paymentOrder.status}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium">
                              ${item.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Documentos Adjuntos */}
              <_ExpenseAttachments
                expenseId={expense.id}
                companyName=""
                expenseNumber={expense.fullNumber}
                attachments={expense.attachments.map((a) => ({
                  ...a,
                  fileSize: a.fileSize ?? null,
                }))}
                onAttachmentsChange={loadExpense}
              />

              {/* Acciones */}
              <div className="flex justify-end gap-2 pt-2">
                {(isConfirmed || expense.status === 'PARTIAL_PAID') && (
                  <Button
                    variant="outline"
                    onClick={() => setLinkProjectionOpen(true)}
                  >
                    <Link2 className="mr-2 h-4 w-4" />
                    Vincular a Proyección
                  </Button>
                )}
                {isDraft && (
                  <Button
                    variant="default"
                    onClick={() => setConfirmDialogOpen(true)}
                    disabled={isProcessing}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Confirmar
                  </Button>
                )}
                {canCancel && !hasPayments && (
                  <Button
                    variant="destructive"
                    onClick={() => setCancelDialogOpen(true)}
                    disabled={isProcessing}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancelar Egreso
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Confirm Dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar egreso</AlertDialogTitle>
            <AlertDialogDescription>
              Al confirmar el egreso {expense?.fullNumber}, quedará registrado como confirmado y
              podrá ser incluido en una orden de pago. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isProcessing}>
              {isProcessing ? 'Confirmando...' : 'Confirmar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar egreso</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que deseas cancelar el egreso {expense?.fullNumber}?
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={isProcessing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isProcessing ? 'Cancelando...' : 'Cancelar Egreso'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Link to Projection Modal */}
      {expense && (
        <_LinkToProjectionModal
          open={linkProjectionOpen}
          onOpenChange={setLinkProjectionOpen}
          documentType="EXPENSE"
          documentId={expense.id}
          documentFullNumber={expense.fullNumber}
          documentTotal={expense.amount}
          onSuccess={() => loadExpense()}
        />
      )}
    </>
  );
}
