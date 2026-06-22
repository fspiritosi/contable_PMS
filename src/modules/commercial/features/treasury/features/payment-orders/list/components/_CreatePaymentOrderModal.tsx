'use client';

import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/components/ui/dialog';
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
import { Plus, Trash2, ArrowDownToLine } from 'lucide-react';
import { toast } from 'sonner';
import { createPaymentOrderSchema, type CreatePaymentOrderFormData, PAYMENT_METHOD_LABELS, WITHHOLDING_TAX_TYPE_LABELS } from '../../../../shared/validators';
import { createPaymentOrder, getPendingPurchaseInvoices, getPortfolioChecks, updatePaymentOrder } from '../../actions.server';
import { getAvailableCashRegisters, getAvailableBankAccounts } from '../../../receipts/actions.server';
import { getSuppliersForSelect } from '@/modules/commercial/features/purchases/features/invoices/list/actions.server';
import { getPendingExpenses } from '@/modules/commercial/features/expenses/actions.server';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Separator } from '@/shared/components/ui/separator';
import moment from 'moment';
import { formatCurrency } from '@/shared/utils/formatters';

interface CreatePaymentOrderModalProps {
  onSuccess: () => void;
  /**
   * Si se pasa, el modal se abre con el proveedor preseleccionado y no editable.
   * Útil cuando se llama desde una vista donde ya hay un proveedor en contexto
   * (ej: cuenta corriente del proveedor).
   */
  prefilledSupplierId?: string;
  /**
   * Si se pasa junto con `prefilledSupplierId`, el modal arranca con esas facturas
   * ya cargadas como items. El usuario puede seguir editando los montos pero no
   * puede agregar/quitar facturas (el selector de facturas se deshabilita y el
   * tab de Gastos se oculta).
   */
  prefilledInvoices?: { id: string; pendingAmount: number }[];
  /**
   * Si se pasa, el modal arranca con esos gastos ya cargados como items. Aplica
   * la misma lógica que `prefilledInvoices` pero para el tab de Gastos. Si se
   * pasan ambos, el modal muestra ambos tabs pre-poblados.
   */
  prefilledExpenses?: { id: string; amount: number }[];
  /**
   * Si se pasa, el modal se controla externamente. Útil cuando se quiere abrir
   * desde otra parte (ej: action bar de selección múltiple en cuenta corriente).
   * En este modo el DialogTrigger interno NO se renderiza.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // ─── Modo edición ───
  /**
   * Si se pasa, el modal entra en modo edición: en lugar de crear llama a
   * `updatePaymentOrder(editPaymentOrderId, data)`. El title muestra el número.
   */
  editPaymentOrderId?: string;
  /** Fecha inicial (modo edición) */
  initialDate?: Date;
  /** Notas iniciales (modo edición) */
  initialNotes?: string | null;
  /** Pagos iniciales (modo edición) */
  initialPayments?: CreatePaymentOrderFormData['payments'];
  /** Retenciones iniciales (modo edición) */
  initialWithholdings?: CreatePaymentOrderFormData['withholdings'];
}

export function CreatePaymentOrderModal({
  onSuccess,
  prefilledSupplierId,
  prefilledInvoices,
  prefilledExpenses,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  editPaymentOrderId,
  initialDate,
  initialNotes,
  initialPayments,
  initialWithholdings,
}: CreatePaymentOrderModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) {
      controlledOnOpenChange?.(next);
    } else {
      setInternalOpen(next);
    }
  };
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(
    prefilledSupplierId ?? null
  );
  const queryClient = useQueryClient();
  const isPrefilled = Boolean(
    (prefilledSupplierId && prefilledInvoices) || (prefilledExpenses && prefilledExpenses.length > 0)
  );
  const hideInvoiceSelector = Boolean(prefilledSupplierId && prefilledInvoices);
  const isEdit = Boolean(editPaymentOrderId);

  const form = useForm<CreatePaymentOrderFormData>({
    resolver: zodResolver(createPaymentOrderSchema),
    defaultValues: {
      supplierId: prefilledSupplierId ?? null,
      date: initialDate ?? new Date(),
      notes: initialNotes ?? null,
      items: [
        ...(prefilledInvoices?.map((inv) => ({
          invoiceId: inv.id,
          expenseId: null,
          amount: inv.pendingAmount.toFixed(2),
        })) ?? []),
        ...(prefilledExpenses?.map((exp) => ({
          invoiceId: null,
          expenseId: exp.id,
          amount: exp.amount.toFixed(2),
        })) ?? []),
      ],
      payments: initialPayments ?? [],
      withholdings: initialWithholdings ?? [],
    },
  });

  const { fields: itemFields, append: appendItem, remove: removeItem } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  const { fields: paymentFields, append: appendPayment, remove: removePayment } = useFieldArray({
    control: form.control,
    name: 'payments',
  });

  const { fields: withholdingFields, append: appendWithholding, remove: removeWithholding } = useFieldArray({
    control: form.control,
    name: 'withholdings',
  });

  const { data: suppliersData = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: getSuppliersForSelect,
    enabled: open,
  });

  const { data: pendingInvoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['pendingPurchaseInvoices', selectedSupplierId],
    queryFn: () => getPendingPurchaseInvoices(selectedSupplierId!),
    enabled: Boolean(selectedSupplierId) && open,
  });

  const { data: pendingExpenses = [], isLoading: loadingExpenses } = useQuery({
    queryKey: ['pendingExpenses', selectedSupplierId],
    queryFn: () => getPendingExpenses(selectedSupplierId || undefined),
    enabled: open && !isPrefilled && !(prefilledExpenses && prefilledExpenses.length > 0),
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

  // Cheques de terceros en cartera (para endosar como medio de pago)
  const { data: portfolioChecks = [] } = useQuery({
    queryKey: ['portfolioChecks'],
    queryFn: () => getPortfolioChecks(),
    enabled: open,
  });

  const handleSupplierChange = (supplierId: string) => {
    if (isPrefilled) return;
    setSelectedSupplierId(supplierId);
    form.setValue('supplierId', supplierId);
    form.setValue('items', []);
  };

  const addInvoiceItem = (invoiceId: string) => {
    const invoice = pendingInvoices.find((inv) => inv.id === invoiceId);
    if (!invoice) return;
    if (itemFields.some((field) => field.invoiceId === invoiceId)) {
      toast.error('Esta factura ya fue agregada');
      return;
    }
    appendItem({ invoiceId, expenseId: null, amount: invoice.pendingAmount.toString() });
  };

  const addExpenseItem = (expenseId: string) => {
    const expense = pendingExpenses.find((exp) => exp.id === expenseId);
    if (!expense) return;
    if (itemFields.some((field) => field.expenseId === expenseId)) {
      toast.error('Este gasto ya fue agregado');
      return;
    }
    appendItem({ invoiceId: null, expenseId, amount: expense.pendingAmount.toString() });
  };

  const addPaymentMethod = () => {
    appendPayment({
      paymentMethod: 'TRANSFER',
      amount: '',
      cashRegisterId: null,
      bankAccountId: null,
      checkNumber: null,
      cardLast4: null,
      reference: null,
      // Metadata de cheque/e-cheq: fecha de emisión por defecto = fecha de la OP
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
    return { totalItems, totalPayments, totalWithholdings, difference: Math.round((totalItems - totalPayments - totalWithholdings) * 100) / 100 };
  };

  const { totalItems, totalPayments, totalWithholdings, difference } = calculateTotals();

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

  const onSubmit = async (data: CreatePaymentOrderFormData) => {
    try {
      if (isEdit && editPaymentOrderId) {
        await updatePaymentOrder(editPaymentOrderId, data);
        toast.success('Orden de pago actualizada correctamente');
      } else {
        await createPaymentOrder(data);
        toast.success('Orden de pago creada correctamente');
      }
      await queryClient.invalidateQueries({ queryKey: ['paymentOrders'] });
      await queryClient.invalidateQueries({ queryKey: ['pendingPurchaseInvoices'] });
      await queryClient.invalidateQueries({ queryKey: ['pendingExpenses'] });
      setOpen(false);
      form.reset({
        supplierId: prefilledSupplierId ?? null,
        date: initialDate ?? new Date(),
        notes: initialNotes ?? null,
        items: [
          ...(prefilledInvoices?.map((inv) => ({
            invoiceId: inv.id,
            expenseId: null,
            amount: inv.pendingAmount.toFixed(2),
          })) ?? []),
          ...(prefilledExpenses?.map((exp) => ({
            invoiceId: null,
            expenseId: exp.id,
            amount: exp.amount.toFixed(2),
          })) ?? []),
        ],
        payments: initialPayments ?? [],
        withholdings: initialWithholdings ?? [],
      });
      if (!isPrefilled) setSelectedSupplierId(null);
    } catch (error) {
      const fallback = isEdit ? 'Error al actualizar orden de pago' : 'Error al crear orden de pago';
      toast.error(error instanceof Error ? error.message : fallback);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nueva Orden de Pago
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="md:min-w-[800px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar Orden de Pago' : 'Crear Orden de Pago'}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {/* ── Items a Pagar ── */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Items a Pagar</h3>

              {(() => {
                const hasInvoicesPrefilled = Boolean(prefilledInvoices && prefilledInvoices.length > 0);
                const hasExpensesPrefilled = Boolean(prefilledExpenses && prefilledExpenses.length > 0);
                const showBothTabs = !isPrefilled || (hasInvoicesPrefilled && hasExpensesPrefilled);
                const defaultTab = hasInvoicesPrefilled ? 'invoices' : 'expenses';
                return (
              <Tabs defaultValue={defaultTab}>
                {showBothTabs && (
                  <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-grid">
                    <TabsTrigger value="invoices">Facturas</TabsTrigger>
                    <TabsTrigger value="expenses">Gastos</TabsTrigger>
                  </TabsList>
                )}

                <TabsContent value="invoices" className="mt-3 space-y-3">
                  {!prefilledSupplierId && (
                    <FormField
                      control={form.control}
                      name="supplierId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Proveedor *</FormLabel>
                          <Select onValueChange={handleSupplierChange} value={field.value || ''}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Seleccionar proveedor" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {suppliersData.length === 0 && (
                                <div className="p-2 text-sm text-muted-foreground">No hay proveedores</div>
                              )}
                              {suppliersData.map((supplier) => (
                                <SelectItem key={supplier.id} value={supplier.id}>
                                  {supplier.tradeName || supplier.businessName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {!selectedSupplierId && !prefilledSupplierId && (
                    <p className="text-sm text-muted-foreground">Seleccione un proveedor para ver facturas pendientes</p>
                  )}
                  {selectedSupplierId && loadingInvoices && <Skeleton className="h-9 w-full" />}
                  {selectedSupplierId && !loadingInvoices && pendingInvoices.length === 0 && !hasInvoicesPrefilled && (
                    <p className="text-sm text-muted-foreground">Sin facturas pendientes</p>
                  )}
                  {selectedSupplierId && !loadingInvoices && pendingInvoices.length > 0 && !hasInvoicesPrefilled && (
                    <Select onValueChange={addInvoiceItem}>
                      <SelectTrigger>
                        <SelectValue placeholder="Agregar factura..." />
                      </SelectTrigger>
                      <SelectContent>
                        {pendingInvoices.map((invoice) => (
                          <SelectItem key={invoice.id} value={invoice.id}>
                            {invoice.fullNumber} — Pend: {formatCurrency(invoice.pendingAmount)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TabsContent>

                <TabsContent value="expenses" className="mt-3">
                  {loadingExpenses && <Skeleton className="h-9 w-full" />}
                  {!loadingExpenses && pendingExpenses.length === 0 && (
                    <p className="text-sm text-muted-foreground">Sin gastos pendientes</p>
                  )}
                  {!loadingExpenses && pendingExpenses.length > 0 && (
                    <Select onValueChange={addExpenseItem}>
                      <SelectTrigger>
                        <SelectValue placeholder="Agregar gasto..." />
                      </SelectTrigger>
                      <SelectContent>
                        {pendingExpenses.map((expense) => (
                          <SelectItem key={expense.id} value={expense.id}>
                            {expense.fullNumber} — {expense.description} — Pend: {formatCurrency(expense.pendingAmount)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TabsContent>
              </Tabs>
                );
              })()}

              {/* Items agregados */}
              {itemFields.length > 0 && (
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-2 text-left font-medium">Documento</th>
                        <th className="px-3 py-2 text-right font-medium">Pendiente</th>
                        <th className="px-3 py-2 text-right font-medium">Monto a pagar</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {itemFields.map((field, index) => {
                        const invoice = field.invoiceId ? pendingInvoices.find((inv) => inv.id === field.invoiceId) : null;
                        const expense = field.expenseId ? pendingExpenses.find((exp) => exp.id === field.expenseId) : null;
                        const pendingAmount = invoice?.pendingAmount ?? expense?.pendingAmount ?? 0;

                        return (
                          <tr key={field.id} className="border-b last:border-0">
                            <td className="px-3 py-2">
                              <p className="font-medium">{invoice?.fullNumber || expense?.fullNumber}</p>
                              <p className="text-xs text-muted-foreground">
                                {invoice ? 'Factura de Compra' : `Gasto · ${expense?.description ?? ''}`}
                              </p>
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                              {formatCurrency(pendingAmount)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <FormField
                                control={form.control}
                                name={`items.${index}.amount`}
                                render={({ field: amountField }) => (
                                  <FormItem className="mb-0">
                                    <div className="flex items-center justify-end gap-1">
                                      <FormControl>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          placeholder="0.00"
                                          className="w-28 text-right"
                                          {...amountField}
                                        />
                                      </FormControl>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-1.5 text-xs text-muted-foreground"
                                        onClick={() => form.setValue(`items.${index}.amount`, pendingAmount.toFixed(2))}
                                        title="Usar total pendiente"
                                      >
                                        Max
                                      </Button>
                                    </div>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="px-1 py-2">
                              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeItem(index)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <Separator />

            {/* ── Datos de la Orden ── */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Datos de la Orden</h3>
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
                        <Textarea placeholder="Observaciones" className="resize-none" rows={2} {...field} value={field.value || ''} />
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
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Formas de Pago</h3>
                <Button type="button" variant="outline" size="sm" onClick={addPaymentMethod}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Agregar
                </Button>
              </div>

              {paymentFields.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Sin formas de pago — podrá vincular a movimiento bancario desde la conciliación
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
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removePayment(index)}>
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
                                  <SelectItem key={value} value={value}>{label}</SelectItem>
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

                      {/* Campo condicional en la 3ra columna */}
                      {paymentMethod === 'CASH' && (
                        <FormField
                          control={form.control}
                          name={`payments.${index}.cashRegisterId`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Caja</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value || undefined}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar caja" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {cashRegisters.map((cr) => (
                                    <SelectItem key={cr.id} value={cr.id}>{cr.code} - {cr.name}</SelectItem>
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
                              <Select onValueChange={field.onChange} value={field.value || undefined}>
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
                                <Input placeholder="1234" maxLength={4} {...field} value={field.value || ''} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </div>

                    {/* Datos del cheque / e-cheq — a ancho completo */}
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
                                  <SelectItem value="THIRD_PARTY">De terceros (se endosa de cartera)</SelectItem>
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
                                    if (selected) form.setValue(`payments.${index}.amount`, selected.amount.toFixed(2));
                                  }}
                                  value={field.value || undefined}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue
                                        placeholder={carteraChecks.length ? 'Seleccionar cheque de cartera' : 'No hay cheques de terceros en cartera'}
                                      />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {carteraChecks.map((c) => (
                                      <SelectItem key={c.id} value={c.id}>
                                        N° {c.checkNumber} · {c.bankName} · {formatCurrency(c.amount)} · vto {moment(c.dueDate).format('DD/MM/YYYY')}
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
                            <p className="text-xs font-medium">Datos del {isEcheq ? 'e-cheq' : 'cheque'} emitido</p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <FormField
                                control={form.control}
                                name={`payments.${index}.checkNumber`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">N° *</FormLabel>
                                    <FormControl>
                                      <Input placeholder="123456" {...field} value={field.value || ''} />
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
                                      <Input placeholder="Banco Nación" {...field} value={field.value || ''} />
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
                                          field.onChange(e.target.value ? new Date(e.target.value + 'T12:00:00') : null)
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
                                          field.onChange(e.target.value ? new Date(e.target.value + 'T12:00:00') : null)
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
                                    <Select onValueChange={field.onChange} value={field.value || undefined}>
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
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Retenciones</h3>
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
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeWithholding(index)}>
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
                                <SelectItem key={value} value={value}>{label}</SelectItem>
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
                    <span className="text-muted-foreground">Total Items</span>
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
                      <p className="font-semibold text-base">{formatCurrency(totalWithholdings)}</p>
                    </div>
                  )}
                  {(paymentFields.length > 0 || withholdingFields.length > 0) && (
                    <div>
                      <span className="text-muted-foreground">Diferencia</span>
                      <p className={`font-bold text-base ${difference === 0 ? 'text-green-600' : 'text-destructive'}`}>
                        {formatCurrency(Math.abs(difference))}
                      </p>
                    </div>
                  )}
                </div>
                {(paymentFields.length > 0 || withholdingFields.length > 0) && difference !== 0 && (
                  <p className="text-xs text-destructive">Items debe ser igual a pagos + retenciones</p>
                )}
                {paymentFields.length === 0 && withholdingFields.length === 0 && (
                  <p className="text-xs text-muted-foreground">Sin pagos — podrá vincular desde conciliación bancaria</p>
                )}
              </div>

              <div className="flex gap-2 shrink-0">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={(paymentFields.length > 0 || withholdingFields.length > 0) && difference !== 0}>
                  Crear Orden de Pago
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
