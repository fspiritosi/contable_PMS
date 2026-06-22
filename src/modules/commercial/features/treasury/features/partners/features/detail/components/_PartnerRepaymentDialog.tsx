'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import moment from 'moment';
import { Plus, Trash2, ArrowDownToLine, Info } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Badge } from '@/shared/components/ui/badge';
import { Separator } from '@/shared/components/ui/separator';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { formatCurrency } from '@/shared/utils/formatters';
import { logger } from '@/shared/lib/logger';
import {
  partnerRepaymentSchema,
  type PartnerRepaymentFormData,
} from '@/modules/commercial/features/treasury/shared/validators';
import {
  getPartnerPendingInstallments,
  createPartnerRepaymentOrder,
} from '../../../../payment-orders/actions.server';
import {
  getAvailableCashRegisters,
  getAvailableBankAccounts,
} from '../../../../receipts/actions.server';
import { getPartners } from '../../list/actions.server';

type PendingInstallment = Awaited<
  ReturnType<typeof getPartnerPendingInstallments>
>[number];

// Métodos de devolución permitidos (NO se devuelve con tarjeta ni cuenta corriente)
const REPAYMENT_METHOD_LABELS = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CHECK: 'Cheque',
} as const;

interface PartnerRepaymentDialogProps {
  /**
   * Si se pasa, el diálogo trabaja directamente con este socio (sin selector).
   * Si NO se pasa, se muestra primero un selector de socio.
   */
  partnerId?: string;
  /** Nombre del socio (opcional, para mostrar en el título cuando partnerId es fijo). */
  partnerName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function _PartnerRepaymentDialog({
  partnerId: fixedPartnerId,
  partnerName,
  open,
  onOpenChange,
  onSuccess,
}: PartnerRepaymentDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Socio seleccionado (solo relevante cuando no hay partnerId fijo)
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(
    fixedPartnerId ?? null
  );
  const partnerId = fixedPartnerId ?? selectedPartnerId;
  const needsPartnerSelector = !fixedPartnerId;

  // Cuotas seleccionadas (por defecto todas)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const form = useForm<PartnerRepaymentFormData>({
    resolver: zodResolver(partnerRepaymentSchema),
    defaultValues: {
      partnerId: partnerId ?? '',
      date: new Date(),
      notes: null,
      installmentIds: [],
      payments: [],
    },
  });

  const { fields: paymentFields, append: appendPayment, remove: removePayment } =
    useFieldArray({ control: form.control, name: 'payments' });

  // Lista de socios (solo si hay que elegir uno)
  const { data: partnersResult } = useQuery({
    queryKey: ['partners', 'repayment-select'],
    queryFn: () => getPartners({ pageSize: '1000' }),
    enabled: open && needsPartnerSelector,
  });
  const partners = partnersResult?.data ?? [];

  const {
    data: installments = [],
    isLoading: loadingInstallments,
  } = useQuery({
    queryKey: ['partner-pending-installments', partnerId],
    queryFn: () => getPartnerPendingInstallments(partnerId!),
    enabled: open && Boolean(partnerId),
  });

  const { data: cashRegisters = [] } = useQuery({
    queryKey: ['availableCashRegisters'],
    queryFn: getAvailableCashRegisters,
    enabled: open,
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['availableBankAccounts'],
    queryFn: getAvailableBankAccounts,
    enabled: open,
  });

  // Al cargar (o cambiar) el set de cuotas, tildar todas por defecto.
  const installmentsKey = installments.map((i) => i.id).join(',');
  const initializedKey = useRef<string | null>(null);
  useEffect(() => {
    if (installments.length > 0 && initializedKey.current !== installmentsKey) {
      initializedKey.current = installmentsKey;
      setSelectedIds(new Set(installments.map((i) => i.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installmentsKey]);

  // Mantener sincronizado el campo del form con la selección (para la validación zod)
  useEffect(() => {
    form.setValue('installmentIds', Array.from(selectedIds), {
      shouldValidate: form.formState.isSubmitted,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  const selectedInstallments = installments.filter((i) => selectedIds.has(i.id));
  const totalToRepayCents = selectedInstallments.reduce(
    (sum, i) => sum + Math.round(i.amount * 100),
    0
  );
  const totalToRepay = totalToRepayCents / 100;

  const totalPaymentsCents = paymentFields.reduce((sum, _f, index) => {
    const amount = form.watch(`payments.${index}.amount`);
    return sum + Math.round(parseFloat(amount || '0') * 100);
  }, 0);
  const totalPayments = totalPaymentsCents / 100;
  const difference = (totalToRepayCents - totalPaymentsCents) / 100;
  const amountsMatch = totalToRepayCents === totalPaymentsCents && totalToRepayCents > 0;

  const toggleInstallment = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected =
    installments.length > 0 && selectedIds.size === installments.length;

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(installments.map((i) => i.id)));
  };

  const handlePartnerChange = (value: string) => {
    setSelectedPartnerId(value);
    setSelectedIds(new Set());
    form.setValue('partnerId', value);
  };

  const addPaymentMethod = () => {
    appendPayment({
      paymentMethod: 'TRANSFER',
      amount: '',
      cashRegisterId: null,
      bankAccountId: null,
      checkNumber: null,
      cardLast4: null,
      cardId: null,
      installmentsCount: null,
      reference: null,
      checkBankName: null,
      checkIssueDate: form.getValues('date') ?? new Date(),
      checkDueDate: null,
      checkDrawerName: null,
      checkDrawerTaxId: null,
      checkOwnership: 'OWN',
      endorsedCheckId: null,
    });
  };

  const getRemainingForPayment = (currentIndex: number) => {
    const otherPaymentsCents = paymentFields.reduce((sum, _f, idx) => {
      if (idx === currentIndex) return sum;
      const amount = form.watch(`payments.${idx}.amount`);
      return sum + Math.round(parseFloat(amount || '0') * 100);
    }, 0);
    return Math.max(0, (totalToRepayCents - otherPaymentsCents) / 100);
  };

  const mutation = useMutation({
    mutationFn: (data: PartnerRepaymentFormData) =>
      createPartnerRepaymentOrder(data),
    onSuccess: async () => {
      toast.success(
        'Devolución creada como borrador. Confirmá la orden de pago para registrar el egreso.'
      );
      if (partnerId) {
        await queryClient.invalidateQueries({ queryKey: ['partner-account', partnerId] });
        await queryClient.invalidateQueries({
          queryKey: ['partner-pending-installments', partnerId],
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['paymentOrders'] });
      await queryClient.invalidateQueries({ queryKey: ['partners'] });
      handleClose(false);
      onSuccess?.();
      router.refresh();
    },
    onError: (error) => {
      logger.error('Error al crear devolución a socio', { data: { error } });
      toast.error(
        error instanceof Error ? error.message : 'Error al crear la devolución'
      );
    },
  });

  const onSubmit = (data: PartnerRepaymentFormData) => {
    if (!amountsMatch) {
      toast.error('El total a devolver debe coincidir con las formas de pago');
      return;
    }
    mutation.mutate({
      ...data,
      partnerId: partnerId ?? data.partnerId,
      installmentIds: Array.from(selectedIds),
    });
  };

  const handleClose = (next: boolean) => {
    if (!next) {
      form.reset({
        partnerId: fixedPartnerId ?? '',
        date: new Date(),
        notes: null,
        installmentIds: [],
        payments: [],
      });
      setSelectedIds(new Set());
      initializedKey.current = null;
      if (needsPartnerSelector) setSelectedPartnerId(null);
    }
    onOpenChange(next);
  };

  const title = partnerName
    ? `Devolver a ${partnerName}`
    : 'Devolver / Pagar al socio';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="md:min-w-[760px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Salda las cuotas pendientes que la empresa le debe al socio mediante una
            orden de pago de devolución.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {/* ── Selector de socio (solo si no hay uno fijo) ── */}
            {needsPartnerSelector && (
              <section className="space-y-2">
                <FormLabel className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Socio
                </FormLabel>
                <Select value={partnerId ?? undefined} onValueChange={handlePartnerChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar socio" />
                  </SelectTrigger>
                  <SelectContent>
                    {partners.length === 0 && (
                      <div className="p-2 text-sm text-muted-foreground">
                        No hay socios
                      </div>
                    )}
                    {partners.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.balance > 0 ? ` — debe ${formatCurrency(p.balance)}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>
            )}

            {/* ── Cuotas pendientes ── */}
            {partnerId && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Cuotas a devolver
                  </h3>
                  {installments.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleSelectAll}
                    >
                      {allSelected ? 'Seleccionar ninguna' : 'Seleccionar todas'}
                    </Button>
                  )}
                </div>

                {loadingInstallments && <Skeleton className="h-24 w-full" />}

                {!loadingInstallments && installments.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Este socio no tiene cuotas pendientes de devolución.
                  </p>
                )}

                {!loadingInstallments && installments.length > 0 && (
                  <div className="rounded-md border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="w-10 px-3 py-2" />
                          <th className="px-3 py-2 text-left font-medium">Vencimiento</th>
                          <th className="px-3 py-2 text-left font-medium">Tarjeta</th>
                          <th className="px-3 py-2 text-left font-medium">Origen</th>
                          <th className="px-3 py-2 text-center font-medium">Cuota</th>
                          <th className="px-3 py-2 text-right font-medium">Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {installments.map((inst: PendingInstallment) => (
                          <tr key={inst.id} className="border-b last:border-0">
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={selectedIds.has(inst.id)}
                                onCheckedChange={() => toggleInstallment(inst.id)}
                                aria-label={`Seleccionar cuota ${inst.number}`}
                              />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {moment(inst.dueDate).format('DD/MM/YYYY')}
                            </td>
                            <td className="px-3 py-2">{inst.cardName || '—'}</td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {inst.originFullNumber}
                            </td>
                            <td className="px-3 py-2 text-center">{inst.number}</td>
                            <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                              {formatCurrency(inst.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {installments.length > 0 && (
                  <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="text-muted-foreground">Total a devolver:</span>
                    <span className="text-lg font-bold">{formatCurrency(totalToRepay)}</span>
                  </div>
                )}
              </section>
            )}

            {partnerId && installments.length > 0 && (
              <>
                <Separator />

                {/* ── Datos de la devolución ── */}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Datos de la devolución
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Fecha *</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              value={moment(field.value).format('YYYY-MM-DD')}
                              onChange={(e) =>
                                field.onChange(new Date(e.target.value + 'T12:00:00'))
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notas (opcional)</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Observaciones"
                              className="resize-none"
                              rows={2}
                              {...field}
                              value={field.value || ''}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </section>

                <Separator />

                {/* ── Formas de devolución ── */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      ¿Cómo se devuelve?
                    </h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addPaymentMethod}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Agregar
                    </Button>
                  </div>

                  {paymentFields.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Agregá al menos una forma de devolución (efectivo, transferencia o cheque).
                    </p>
                  )}

                  {paymentFields.map((field, index) => {
                    const paymentMethod = form.watch(`payments.${index}.paymentMethod`);
                    const isCheckMethod = paymentMethod === 'CHECK';

                    return (
                      <div key={field.id} className="rounded-md border p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Devolución {index + 1}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => removePayment(index)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <FormField
                            control={form.control}
                            name={`payments.${index}.paymentMethod`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Método *</FormLabel>
                                <Select
                                  onValueChange={field.onChange}
                                  value={field.value}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {Object.entries(REPAYMENT_METHOD_LABELS).map(
                                      ([value, label]) => (
                                        <SelectItem key={value} value={value}>
                                          {label}
                                        </SelectItem>
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name={`payments.${index}.amount`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Monto *</FormLabel>
                                <div className="flex gap-1">
                                  <FormControl>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      placeholder="0.00"
                                      {...field}
                                    />
                                  </FormControl>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="px-2 text-xs shrink-0"
                                    onClick={() =>
                                      form.setValue(
                                        `payments.${index}.amount`,
                                        getRemainingForPayment(index).toFixed(2)
                                      )
                                    }
                                    title="Usar monto restante"
                                  >
                                    <ArrowDownToLine className="h-3 w-3 mr-1" />
                                    Resto
                                  </Button>
                                </div>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          {paymentMethod === 'CASH' && (
                            <FormField
                              control={form.control}
                              name={`payments.${index}.cashRegisterId`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Caja</FormLabel>
                                  <Select
                                    onValueChange={field.onChange}
                                    value={field.value || undefined}
                                  >
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Seleccionar caja" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {cashRegisters.map((cr) => (
                                        <SelectItem key={cr.id} value={cr.id}>
                                          {cr.code} - {cr.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}

                          {paymentMethod === 'TRANSFER' && (
                            <FormField
                              control={form.control}
                              name={`payments.${index}.bankAccountId`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Cuenta Bancaria</FormLabel>
                                  <Select
                                    onValueChange={field.onChange}
                                    value={field.value || undefined}
                                  >
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Seleccionar cuenta" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {bankAccounts.map((account) => (
                                        <SelectItem key={account.id} value={account.id}>
                                          {account.bankName} - {account.accountNumber}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                        </div>

                        {/* Datos del cheque propio emitido */}
                        {isCheckMethod && (
                          <div className="grid gap-3 sm:grid-cols-2 rounded-md border bg-muted/30 p-3">
                            <FormField
                              control={form.control}
                              name={`payments.${index}.checkNumber`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">N° de cheque *</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder="123456"
                                      {...field}
                                      value={field.value || ''}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`payments.${index}.checkBankName`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Banco *</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder="Banco Nación"
                                      {...field}
                                      value={field.value || ''}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`payments.${index}.checkIssueDate`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Fecha de emisión</FormLabel>
                                  <FormControl>
                                    <Input
                                      type="date"
                                      value={
                                        field.value
                                          ? moment(field.value).format('YYYY-MM-DD')
                                          : ''
                                      }
                                      onChange={(e) =>
                                        field.onChange(
                                          e.target.value
                                            ? new Date(e.target.value + 'T12:00:00')
                                            : null
                                        )
                                      }
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`payments.${index}.checkDueDate`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Vencimiento *</FormLabel>
                                  <FormControl>
                                    <Input
                                      type="date"
                                      value={
                                        field.value
                                          ? moment(field.value).format('YYYY-MM-DD')
                                          : ''
                                      }
                                      onChange={(e) =>
                                        field.onChange(
                                          e.target.value
                                            ? new Date(e.target.value + 'T12:00:00')
                                            : null
                                        )
                                      }
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>

                <Separator />

                {/* ── Resumen + acciones ── */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-1 text-sm">
                    <div className="flex gap-6">
                      <div>
                        <span className="text-muted-foreground">Total a devolver</span>
                        <p className="font-semibold text-base">
                          {formatCurrency(totalToRepay)}
                        </p>
                      </div>
                      {paymentFields.length > 0 && (
                        <>
                          <div>
                            <span className="text-muted-foreground">Total devolución</span>
                            <p className="font-semibold text-base">
                              {formatCurrency(totalPayments)}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Diferencia</span>
                            <p
                              className={`font-bold text-base ${
                                difference === 0 ? 'text-green-600' : 'text-destructive'
                              }`}
                            >
                              {formatCurrency(Math.abs(difference))}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                    {!amountsMatch && paymentFields.length > 0 && (
                      <p className="text-xs text-destructive">
                        El total de las formas de devolución debe coincidir con el total
                        de cuotas seleccionadas.
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleClose(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        !amountsMatch ||
                        selectedIds.size === 0 ||
                        paymentFields.length === 0 ||
                        mutation.isPending
                      }
                    >
                      {mutation.isPending ? 'Creando...' : 'Crear devolución'}
                    </Button>
                  </div>
                </div>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    La orden de pago se crea en estado{' '}
                    <Badge variant="secondary">Borrador</Badge>. Debés confirmarla desde
                    Órdenes de Pago para registrar el egreso de caja/banco y dar por
                    saldadas las cuotas.
                  </AlertDescription>
                </Alert>
              </>
            )}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
