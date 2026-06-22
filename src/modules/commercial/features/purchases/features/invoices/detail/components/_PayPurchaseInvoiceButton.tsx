'use client';

import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Separator } from '@/shared/components/ui/separator';
import { Plus, Trash2, ArrowDownToLine, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import moment from 'moment';
import { createPaymentOrder } from '@/modules/commercial/features/treasury/features/payment-orders/actions.server';
import { getAvailableCashRegisters, getAvailableBankAccounts } from '@/modules/commercial/features/treasury/features/receipts/actions.server';
import { getPortfolioChecks } from '@/modules/commercial/features/treasury/features/payment-orders/actions.server';
import {
  createPaymentOrderSchema,
  type CreatePaymentOrderFormData,
  PAYMENT_METHOD_LABELS,
  WITHHOLDING_TAX_TYPE_LABELS,
} from '@/modules/commercial/features/treasury/shared/validators';
import { formatCurrency } from '@/shared/utils/formatters';
import { isCreditNote } from '@/modules/commercial/shared/voucher-utils';

interface Props {
  invoiceId: string;
  supplierId: string;
  fullNumber: string;
  voucherType: string;
  total: number;
  paidAmount: number;
  pendingAmount: number;
}

export function _PayPurchaseInvoiceButton({
  invoiceId,
  supplierId,
  fullNumber,
  voucherType,
  total,
  paidAmount,
  pendingAmount,
}: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  const form = useForm<CreatePaymentOrderFormData>({
    resolver: zodResolver(createPaymentOrderSchema),
    defaultValues: {
      supplierId,
      date: new Date(),
      notes: null,
      items: [{ invoiceId, expenseId: null, amount: pendingAmount.toFixed(2) }],
      payments: [],
      withholdings: [],
    },
  });

  const { fields: paymentFields, append: appendPayment, remove: removePayment } = useFieldArray({
    control: form.control,
    name: 'payments',
  });

  const { fields: withholdingFields, append: appendWithholding, remove: removeWithholding } = useFieldArray({
    control: form.control,
    name: 'withholdings',
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

  const { data: portfolioChecks = [] } = useQuery({
    queryKey: ['portfolioChecks'],
    queryFn: () => getPortfolioChecks(),
    enabled: open,
  });

  const addPaymentMethod = () => {
    appendPayment({
      paymentMethod: 'TRANSFER',
      amount: '',
      cashRegisterId: null,
      bankAccountId: null,
      checkNumber: null,
      cardLast4: null,
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

  const addWithholding = () => {
    appendWithholding({ taxType: 'IVA', rate: '', amount: '', certificateNumber: null });
  };

  const calculateTotals = () => {
    const items = form.watch('items');
    const payments = form.watch('payments');
    const withholdings = form.watch('withholdings');

    const totalItems = items.reduce((sum, item) => sum + Math.round(parseFloat(item.amount || '0') * 100), 0) / 100;
    const totalPayments = payments.reduce((sum, payment) => sum + Math.round(parseFloat(payment.amount || '0') * 100), 0) / 100;
    const totalWithholdings = withholdings.reduce((sum, w) => sum + Math.round(parseFloat(w.amount || '0') * 100), 0) / 100;

    return {
      totalItems,
      totalPayments,
      totalWithholdings,
      difference: Math.round((totalItems - totalPayments - totalWithholdings) * 100) / 100,
    };
  };

  const getRemainingForPayment = (currentIndex: number) => {
    const items = form.watch('items');
    const payments = form.watch('payments');
    const withholdings = form.watch('withholdings');

    const totalItemsCents = items.reduce((sum, item) => sum + Math.round(parseFloat(item.amount || '0') * 100), 0);
    const totalWithholdingsCents = withholdings.reduce((sum, w) => sum + Math.round(parseFloat(w.amount || '0') * 100), 0);
    const otherPaymentsCents = payments.reduce((sum, payment, idx) => {
      if (idx === currentIndex) return sum;
      return sum + Math.round(parseFloat(payment.amount || '0') * 100);
    }, 0);

    return Math.max(0, (totalItemsCents - totalWithholdingsCents - otherPaymentsCents) / 100);
  };

  const { totalItems, totalPayments, totalWithholdings, difference } = calculateTotals();

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      form.reset({
        supplierId,
        date: new Date(),
        notes: null,
        items: [{ invoiceId, expenseId: null, amount: pendingAmount.toFixed(2) }],
        payments: [],
        withholdings: [],
      });
    }
    setOpen(nextOpen);
  };

  const onSubmit = async (data: CreatePaymentOrderFormData) => {
    try {
      await createPaymentOrder(data);
      toast.success('Orden de pago creada correctamente');
      await queryClient.invalidateQueries({ queryKey: ['paymentOrders'] });
      await queryClient.invalidateQueries({ queryKey: ['pendingPurchaseInvoices'] });
      handleClose(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al crear orden de pago');
    }
  };

  // Validación contextual: el monto a pagar no puede superar el saldo pendiente
  const itemAmount = form.watch('items.0.amount');
  const itemAmountNum = parseFloat(itemAmount || '0');
  const exceedsPending = itemAmountNum > pendingAmount + 0.001;

  // NC no se pagan
  if (isCreditNote(voucherType)) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CreditCard className="mr-2 h-4 w-4" />
        Pagar Factura
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="md:min-w-[800px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pagar Factura {fullNumber}</DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              {/* ── Resumen de la Factura (read-only) ── */}
              <section className="rounded-md border bg-muted/30 p-4 space-y-2 text-sm">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-muted-foreground text-xs">Total</p>
                    <p className="font-mono font-semibold">{formatCurrency(total)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Pagado</p>
                    <p className="font-mono font-semibold text-green-600">
                      {formatCurrency(paidAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Pendiente</p>
                    <p className="font-mono font-semibold text-orange-600">
                      {formatCurrency(pendingAmount)}
                    </p>
                  </div>
                </div>
              </section>

              {/* ── Monto a Pagar ── */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Monto a Pagar
                </h3>
                <FormField
                  control={form.control}
                  name="items.0.amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Importe *</FormLabel>
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={pendingAmount}
                            placeholder="0.00"
                            className="max-w-xs"
                            {...field}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => form.setValue('items.0.amount', pendingAmount.toFixed(2))}
                        >
                          Usar saldo pendiente
                        </Button>
                        {exceedsPending && (
                          <span className="text-xs text-destructive">
                            Supera el saldo pendiente ({formatCurrency(pendingAmount)})
                          </span>
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </section>

              <Separator />

              {/* ── Datos de la Orden ── */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Datos de la Orden
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
                            onChange={(e) => field.onChange(new Date(e.target.value + 'T12:00:00'))}
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

              {/* ── Formas de Pago ── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Formas de Pago
                  </h3>
                  <Button type="button" variant="outline" size="sm" onClick={addPaymentMethod}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Agregar
                  </Button>
                </div>

                {paymentFields.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Sin formas de pago — la orden se creará en borrador y podrá vincular a un
                    movimiento bancario desde la conciliación.
                  </p>
                )}

                {paymentFields.map((field, index) => {
                  const paymentMethod = form.watch(`payments.${index}.paymentMethod`);
                  const checkOwnership = form.watch(`payments.${index}.checkOwnership`) || 'OWN';
                  const isCheckMethod = paymentMethod === 'CHECK' || paymentMethod === 'ECHEQ';
                  const isEcheq = paymentMethod === 'ECHEQ';
                  const carteraChecks = portfolioChecks.filter((c) => c.isElectronic === isEcheq);

                  return (
                    <div key={field.id} className="rounded-md border p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Pago {index + 1}</span>
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
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                      {label}
                                    </SelectItem>
                                  ))}
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
                                  <Input type="number" step="0.01" placeholder="0.00" {...field} />
                                </FormControl>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="px-2 text-xs shrink-0"
                                  onClick={() => {
                                    const remaining = getRemainingForPayment(index);
                                    form.setValue(`payments.${index}.amount`, remaining.toFixed(2));
                                  }}
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

                        {(paymentMethod === 'TRANSFER' || paymentMethod === 'DEBIT_CARD') && (
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

                        {(paymentMethod === 'DEBIT_CARD' || paymentMethod === 'CREDIT_CARD') && (
                          <FormField
                            control={form.control}
                            name={`payments.${index}.cardLast4`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Últimos 4 Dígitos</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="1234"
                                    maxLength={4}
                                    {...field}
                                    value={field.value || ''}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                      </div>

                      {isCheckMethod && (
                        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                          <FormField
                            control={form.control}
                            name={`payments.${index}.checkOwnership`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">
                                  {isEcheq ? 'E-cheq' : 'Cheque'}: propio o de terceros *
                                </FormLabel>
                                <Select
                                  onValueChange={(v) => {
                                    field.onChange(v);
                                    if (v === 'OWN') form.setValue(`payments.${index}.endorsedCheckId`, null);
                                  }}
                                  value={field.value || 'OWN'}
                                >
                                  <FormControl>
                                    <SelectTrigger className="sm:max-w-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="OWN">Propio (se emite)</SelectItem>
                                    <SelectItem value="THIRD_PARTY">
                                      De terceros (se endosa de cartera)
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          {checkOwnership === 'THIRD_PARTY' ? (
                            <FormField
                              control={form.control}
                              name={`payments.${index}.endorsedCheckId`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">
                                    {isEcheq ? 'E-cheq' : 'Cheque'} en cartera a endosar *
                                  </FormLabel>
                                  <Select
                                    onValueChange={(v) => {
                                      field.onChange(v);
                                      const selected = carteraChecks.find((c) => c.id === v);
                                      if (selected)
                                        form.setValue(`payments.${index}.amount`, selected.amount.toFixed(2));
                                    }}
                                    value={field.value || undefined}
                                  >
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue
                                          placeholder={
                                            carteraChecks.length
                                              ? 'Seleccionar cheque de cartera'
                                              : 'No hay cheques de terceros en cartera'
                                          }
                                        />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {carteraChecks.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                          N° {c.checkNumber} · {c.bankName} ·{' '}
                                          {formatCurrency(c.amount)} · vto{' '}
                                          {moment(c.dueDate).format('DD/MM/YYYY')}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          ) : (
                            <>
                              <p className="text-xs font-medium">
                                Datos del {isEcheq ? 'e-cheq' : 'cheque'} emitido
                              </p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <FormField
                                  control={form.control}
                                  name={`payments.${index}.checkNumber`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">N° *</FormLabel>
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
                                          value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                                          onChange={(e) =>
                                            field.onChange(
                                              e.target.value ? new Date(e.target.value + 'T12:00:00') : null
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
                                          value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                                          onChange={(e) =>
                                            field.onChange(
                                              e.target.value ? new Date(e.target.value + 'T12:00:00') : null
                                            )
                                          }
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                              {isEcheq && (
                                <FormField
                                  control={form.control}
                                  name={`payments.${index}.bankAccountId`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Cuenta de origen *</FormLabel>
                                      <Select
                                        onValueChange={field.onChange}
                                        value={field.value || undefined}
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue placeholder="Cuenta desde la que se emite" />
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
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>

              <Separator />

              {/* ── Retenciones ── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Retenciones
                  </h3>
                  <Button type="button" variant="outline" size="sm" onClick={addWithholding}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Agregar
                  </Button>
                </div>

                {withholdingFields.length === 0 && (
                  <p className="text-sm text-muted-foreground">Sin retenciones</p>
                )}

                {withholdingFields.map((field, index) => (
                  <div key={field.id} className="rounded-md border p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Retención {index + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => removeWithholding(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <FormField
                        control={form.control}
                        name={`withholdings.${index}.taxType`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Tipo *</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {Object.entries(WITHHOLDING_TAX_TYPE_LABELS).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`withholdings.${index}.rate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Alícuota %</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" placeholder="0.00" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`withholdings.${index}.amount`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Monto *</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" placeholder="0.00" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`withholdings.${index}.certificateNumber`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">N° Certificado</FormLabel>
                            <FormControl>
                              <Input placeholder="Opcional" {...field} value={field.value || ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </section>

              <Separator />

              {/* ── Resumen + Acciones ── */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1 text-sm">
                  <div className="flex gap-6">
                    <div>
                      <span className="text-muted-foreground">Total a pagar</span>
                      <p className="font-semibold text-base">{formatCurrency(totalItems)}</p>
                    </div>
                    {paymentFields.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Total Pagos</span>
                        <p className="font-semibold text-base">{formatCurrency(totalPayments)}</p>
                      </div>
                    )}
                    {withholdingFields.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Retenciones</span>
                        <p className="font-semibold text-base">
                          {formatCurrency(totalWithholdings)}
                        </p>
                      </div>
                    )}
                    {(paymentFields.length > 0 || withholdingFields.length > 0) && (
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
                    )}
                  </div>
                  {(paymentFields.length > 0 || withholdingFields.length > 0) &&
                    difference !== 0 && (
                      <p className="text-xs text-destructive">
                        El monto a pagar debe ser igual a pagos + retenciones
                      </p>
                    )}
                  {paymentFields.length === 0 && withholdingFields.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Sin pagos — la OP se creará en borrador para vincular después.
                    </p>
                  )}
                </div>

                <div className="flex gap-2 shrink-0">
                  <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      exceedsPending ||
                      ((paymentFields.length > 0 || withholdingFields.length > 0) &&
                        difference !== 0)
                    }
                  >
                    Crear Orden de Pago
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}