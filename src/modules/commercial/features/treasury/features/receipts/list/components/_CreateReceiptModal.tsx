'use client';

import { useState, useEffect } from 'react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Plus, Trash2, AlertCircle, ArrowDownToLine } from 'lucide-react';
import { toast } from 'sonner';
import { createReceiptSchema, type CreateReceiptFormData, PAYMENT_METHOD_LABELS, WITHHOLDING_TAX_TYPE_LABELS } from '../../../../shared/validators';
import { createReceipt, getPendingInvoices, getAvailableCashRegisters, getAvailableBankAccounts } from '../../actions.server';
import { getContractorsForSelect } from '@/modules/company/features/contractors/list/actions.server';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Badge } from '@/shared/components/ui/badge';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import moment from 'moment';

interface CreateReceiptModalProps {
  onSuccess: () => void;
}

export function CreateReceiptModal({ onSuccess }: CreateReceiptModalProps) {
  const [open, setOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const form = useForm<CreateReceiptFormData>({
    resolver: zodResolver(createReceiptSchema),
    defaultValues: {
      customerId: '',
      date: new Date(),
      notes: null,
      items: [],
      payments: [],
      withholdings: [],
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

  // Query para clientes
  const { data: customersData = [] } = useQuery({
    queryKey: ['contractors'],
    queryFn: getContractorsForSelect,
    enabled: open,
  });

  // Query para facturas pendientes
  const { data: pendingInvoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['pendingInvoices', selectedCustomerId],
    queryFn: () => getPendingInvoices(selectedCustomerId!),
    enabled: Boolean(selectedCustomerId),
  });

  // Query para cajas disponibles
  const { data: cashRegisters = [] } = useQuery({
    queryKey: ['availableCashRegisters'],
    queryFn: getAvailableCashRegisters,
    enabled: open,
  });

  // Query para cuentas bancarias
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['availableBankAccounts'],
    queryFn: getAvailableBankAccounts,
    enabled: open,
  });


  const handleCustomerChange = (customerId: string) => {
    setSelectedCustomerId(customerId);
    form.setValue('customerId', customerId);
    // Limpiar items cuando cambia el cliente
    form.setValue('items', []);
  };

  const addInvoiceItem = (invoiceId: string) => {
    const invoice = pendingInvoices.find((inv) => inv.id === invoiceId);
    if (!invoice) return;

    // Verificar que no esté ya agregada
    const exists = itemFields.some((field) => field.invoiceId === invoiceId);
    if (exists) {
      toast.error('Esta factura ya fue agregada');
      return;
    }

    appendItem({
      invoiceId,
      amount: invoice.pendingAmount.toString(),
    });
  };

  const addPaymentMethod = () => {
    appendPayment({
      paymentMethod: 'CASH',
      amount: '',
      cashRegisterId: null,
      bankAccountId: null,
      checkNumber: null,
      cardLast4: null,
      reference: null,
    });
  };

  const addWithholding = () => {
    appendWithholding({
      taxType: 'IVA',
      rate: '',
      amount: '',
      certificateNumber: null,
    });
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

  const onSubmit = async (data: CreateReceiptFormData) => {
    try {
      await createReceipt(data);
      toast.success('Recibo creado correctamente');

      // Invalidar cache de React Query para actualizar la tabla
      await queryClient.invalidateQueries({ queryKey: ['receipts'] });
      await queryClient.invalidateQueries({ queryKey: ['pendingInvoices'] });

      setOpen(false);
      form.reset();
      setSelectedCustomerId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al crear recibo');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Recibo
        </Button>
      </DialogTrigger>
      <DialogContent className="md:min-w-[800px]">
        <DialogHeader>
          <DialogTitle>Crear Recibo de Cobro</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Datos Básicos */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Datos Básicos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cliente *</FormLabel>
                      <Select onValueChange={handleCustomerChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar cliente" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {customersData.length === 0 && (
                            <div className="p-2 text-sm text-muted-foreground">No hay clientes disponibles</div>
                          )}
                          {customersData.map((customer) => (
                            <SelectItem key={customer.id} value={customer.id}>
                              {customer.name}
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
                      <FormLabel>Notas</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Observaciones opcionales"
                          {...field}
                          value={field.value || ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Facturas a Cobrar */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Facturas a Cobrar</CardTitle>
                <CardDescription>Seleccione las facturas pendientes del cliente</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!selectedCustomerId && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>Seleccione un cliente para ver sus facturas pendientes</AlertDescription>
                  </Alert>
                )}

                {selectedCustomerId && loadingInvoices && <Skeleton className="h-20 w-full" />}

                {selectedCustomerId && !loadingInvoices && pendingInvoices.length === 0 && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>El cliente no tiene facturas pendientes de cobro</AlertDescription>
                  </Alert>
                )}

                {selectedCustomerId && !loadingInvoices && pendingInvoices.length > 0 && (
                  <div className="space-y-2">
                    <Select onValueChange={addInvoiceItem}>
                      <SelectTrigger>
                        <SelectValue placeholder="Agregar factura" />
                      </SelectTrigger>
                      <SelectContent>
                        {pendingInvoices.map((invoice) => (
                          <SelectItem key={invoice.id} value={invoice.id}>
                            {invoice.fullNumber} - Pendiente: ${invoice.pendingAmount.toFixed(2)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {itemFields.map((field, index) => {
                  const invoice = pendingInvoices.find((inv) => inv.id === field.invoiceId);
                  return (
                    <div key={field.id} className="flex items-end gap-2 p-3 border rounded-lg">
                      <div className="flex-1">
                        <div className="text-sm font-medium">{invoice?.fullNumber}</div>
                        <div className="text-xs text-muted-foreground">
                          Pendiente: ${invoice?.pendingAmount.toFixed(2)}
                        </div>
                      </div>
                      <FormField
                        control={form.control}
                        name={`items.${index}.amount`}
                        render={({ field }) => (
                          <FormItem className="w-64">
                            <FormLabel className="text-xs">Monto</FormLabel>
                            <div className="flex gap-1">
                              <FormControl>
                                <Input type="number" step="0.01" placeholder="0.00" {...field} />
                              </FormControl>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="px-2 text-xs"
                                onClick={() => {
                                  if (invoice) {
                                    form.setValue(`items.${index}.amount`, invoice.pendingAmount.toFixed(2));
                                  }
                                }}
                                title="Usar monto pendiente completo"
                              >
                                Total
                              </Button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Formas de Pago */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Formas de Pago</CardTitle>
                    <CardDescription>Agregue las formas de pago utilizadas</CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addPaymentMethod}>
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar Pago
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {paymentFields.length === 0 && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Sin formas de pago — el recibo podrá vincularse a un movimiento bancario existente
                    </AlertDescription>
                  </Alert>
                )}

                {paymentFields.map((field, index) => {
                  const paymentMethod = form.watch(`payments.${index}.paymentMethod`);

                  return (
                    <div key={field.id} className="space-y-3 p-4 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium">Pago {index + 1}</h4>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removePayment(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          control={form.control}
                          name={`payments.${index}.paymentMethod`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Forma de Pago *</FormLabel>
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
                              <FormLabel>Monto *</FormLabel>
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
                      </div>

                      {/* Campos condicionales según forma de pago */}
                      {paymentMethod === 'CASH' && (
                        <FormField
                          control={form.control}
                          name={`payments.${index}.cashRegisterId`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Caja</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value || undefined}>
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
                              <FormLabel>Cuenta Bancaria</FormLabel>
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

                      {paymentMethod === 'CHECK' && (
                        <FormField
                          control={form.control}
                          name={`payments.${index}.checkNumber`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Número de Cheque</FormLabel>
                              <FormControl>
                                <Input placeholder="123456" {...field} value={field.value || ''} />
                              </FormControl>
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
                              <FormLabel>Últimos 4 Dígitos</FormLabel>
                              <FormControl>
                                <Input placeholder="1234" maxLength={4} {...field} value={field.value || ''} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Retenciones Sufridas */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Retenciones Sufridas</CardTitle>
                    <CardDescription>Retenciones aplicadas por el cliente</CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addWithholding}>
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar Retención
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {withholdingFields.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    Sin retenciones
                  </p>
                )}

                {withholdingFields.map((field, index) => (
                  <div key={field.id} className="space-y-3 p-4 border rounded-lg">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">Retención {index + 1}</h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeWithholding(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-4">
                      <FormField
                        control={form.control}
                        name={`withholdings.${index}.taxType`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tipo *</FormLabel>
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
                            <FormLabel>Alícuota %</FormLabel>
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
                            <FormLabel>Monto *</FormLabel>
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
                            <FormLabel>N° Certificado</FormLabel>
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
              </CardContent>
            </Card>

            {/* Resumen */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Resumen</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Total Facturas:</span>
                    <span className="font-medium">
                      ${totalItems.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  {(paymentFields.length > 0 || withholdingFields.length > 0) && (
                    <>
                      {paymentFields.length > 0 && (
                        <div className="flex justify-between">
                          <span>Total Pagos:</span>
                          <span className="font-medium">
                            ${totalPayments.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      {withholdingFields.length > 0 && (
                        <div className="flex justify-between">
                          <span>Total Retenciones:</span>
                          <span className="font-medium">
                            ${totalWithholdings.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between border-t pt-2">
                        <span>Diferencia:</span>
                        <span className={`font-bold ${difference === 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ${Math.abs(difference).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      {difference !== 0 && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            El total de facturas debe ser igual al total de pagos + retenciones
                          </AlertDescription>
                        </Alert>
                      )}
                    </>
                  )}
                  {paymentFields.length === 0 && withholdingFields.length === 0 && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Este recibo se creará sin formas de pago. Podrá vincularlo a un movimiento bancario desde la conciliación.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={(paymentFields.length > 0 || withholdingFields.length > 0) && difference !== 0}>
                Crear Recibo
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
