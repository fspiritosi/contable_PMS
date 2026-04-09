'use client';

import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/shared/components/ui/button';
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
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import {
  createPurchaseInvoice,
  updatePurchaseInvoice,
  getSupplierInvoicesForSelect,
  getApprovedPurchaseOrdersForInvoicing,
  getPurchaseOrderLinesForInvoicing,
} from '../../list/actions.server';
import { isCreditNote, isDebitNote } from '@/modules/commercial/shared/voucher-utils';
import {
  purchaseInvoiceFormSchema,
  VOUCHER_TYPE_LABELS,
  type PurchaseInvoiceFormInput,
} from '../../shared/validators';
import moment from 'moment';
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/shared/components/ui/card';
import { Separator } from '@/shared/components/ui/separator';
import type { SupplierSelectItem, ProductSelectItem } from '../../list/actions.server';

const formatCurrency = (value: number) =>
  `$${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function _PurchaseLineTotals({ form, index }: { form: ReturnType<typeof useForm<PurchaseInvoiceFormInput>>; index: number }) {
  const line = useWatch({ control: form.control, name: `lines.${index}` });

  const qty = parseFloat(line?.quantity ?? '0');
  const price = parseFloat(line?.unitCost ?? '0');
  const vat = parseFloat(line?.vatRate ?? '0');

  const neto = isNaN(qty) || isNaN(price) ? 0 : Math.round(qty * price * 100) / 100;
  const iva = isNaN(vat) ? 0 : Math.round(neto * (vat / 100) * 100) / 100;
  const total = Math.round((neto + iva) * 100) / 100;

  return (
    <div className="flex justify-end gap-4 text-sm text-muted-foreground font-mono pt-1">
      <span>Neto: {formatCurrency(neto)}</span>
      <span>IVA: {formatCurrency(iva)}</span>
      <span className="font-semibold text-foreground">Total: {formatCurrency(total)}</span>
    </div>
  );
}

interface PurchaseInvoiceFormProps {
  suppliers: SupplierSelectItem[];
  products: ProductSelectItem[];
  mode?: 'create' | 'edit';
  invoiceId?: string;
  defaultValues?: Partial<PurchaseInvoiceFormInput>;
}

export function _PurchaseInvoiceForm({
  suppliers,
  products,
  mode = 'create',
  invoiceId,
  defaultValues: initialValues,
}: PurchaseInvoiceFormProps) {
  const router = useRouter();
  const [totals, setTotals] = useState({ subtotal: 0, vatAmount: 0, total: 0 });
  const [originalInvoices, setOriginalInvoices] = useState<Awaited<ReturnType<typeof getSupplierInvoicesForSelect>>>([]);
  const [loadingOriginalInvoices, setLoadingOriginalInvoices] = useState(false);

  const form = useForm<PurchaseInvoiceFormInput>({
    resolver: zodResolver(purchaseInvoiceFormSchema),
    defaultValues: initialValues || {
      supplierId: '',
      voucherType: 'FACTURA_A',
      originalInvoiceId: '',
      purchaseOrderId: '',
      pointOfSale: '',
      number: '',
      issueDate: new Date(),
      dueDate: undefined,
      cae: '',
      notes: '',
      lines: [],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: 'lines',
  });

  // Recalcular totales cuando cambien las líneas
  useEffect(() => {
    const subscription = form.watch((value) => {
      if (value.lines) {
        let subtotal = 0;
        let vatAmount = 0;

        value.lines.forEach((line) => {
          if (line?.quantity && line?.unitCost && line?.vatRate) {
            const qty = parseFloat(line.quantity);
            const cost = parseFloat(line.unitCost);
            const vat = parseFloat(line.vatRate);

            const lineSubtotal = qty * cost;
            const lineVat = lineSubtotal * (vat / 100);

            subtotal += lineSubtotal;
            vatAmount += lineVat;
          }
        });

        setTotals({
          subtotal: Math.round(subtotal * 100) / 100,
          vatAmount: Math.round(vatAmount * 100) / 100,
          total: Math.round((subtotal + vatAmount) * 100) / 100,
        });
      }
    });

    return () => subscription.unsubscribe();
  }, [form]);

  // Cargar facturas originales cuando se selecciona NC/ND
  const watchedVoucherType = form.watch('voucherType');
  const watchedSupplierId = form.watch('supplierId');
  const showOriginalInvoice = watchedVoucherType && (isCreditNote(watchedVoucherType) || isDebitNote(watchedVoucherType));

  // Facturas tipo C no llevan IVA — forzar 0% en todas las líneas
  const isTypeC = watchedVoucherType?.endsWith('_C') || false;

  useEffect(() => {
    if (!isTypeC) return;
    const lines = form.getValues('lines');
    lines.forEach((line, idx) => {
      if (line.vatRate !== '0') {
        form.setValue(`lines.${idx}.vatRate`, '0');
      }
    });
  }, [isTypeC]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showOriginalInvoice || !watchedSupplierId) {
      setOriginalInvoices([]);
      form.setValue('originalInvoiceId', '');
      return;
    }

    const fetchInvoices = async () => {
      setLoadingOriginalInvoices(true);
      try {
        const invoices = await getSupplierInvoicesForSelect(watchedSupplierId);
        setOriginalInvoices(invoices);
      } catch {
        setOriginalInvoices([]);
      } finally {
        setLoadingOriginalInvoices(false);
      }
    };

    fetchInvoices();
  }, [showOriginalInvoice, watchedSupplierId]);

  // ============================================
  // VINCULACIÓN CON ORDEN DE COMPRA
  // ============================================

  const isRegularInvoice = watchedVoucherType && !isCreditNote(watchedVoucherType) && !isDebitNote(watchedVoucherType);
  const watchedPurchaseOrderId = form.watch('purchaseOrderId');

  // OCs aprobadas del proveedor
  const { data: purchaseOrders = [], isFetching: loadingPOs } = useQuery({
    queryKey: ['approvedPOsForInvoicing', watchedSupplierId],
    queryFn: () => getApprovedPurchaseOrdersForInvoicing(watchedSupplierId),
    enabled: Boolean(watchedSupplierId) && !!isRegularInvoice,
  });

  // Líneas de la OC seleccionada
  const { data: poLines = [], isFetching: loadingPOLines } = useQuery({
    queryKey: ['poLinesForInvoicing', watchedPurchaseOrderId],
    queryFn: () => getPurchaseOrderLinesForInvoicing(watchedPurchaseOrderId!),
    enabled: Boolean(watchedPurchaseOrderId) && watchedPurchaseOrderId !== '',
  });

  // Auto-poblar líneas cuando se selecciona una OC
  useEffect(() => {
    if (!watchedPurchaseOrderId || watchedPurchaseOrderId === '' || loadingPOLines) return;

    if (poLines.length > 0) {
      replace(
        poLines.map((line) => ({
          productId: line.productId ?? undefined,
          description: line.description,
          quantity: String(line.pendingQty),
          unitCost: String(line.unitCost),
          vatRate: String(line.vatRate),
          purchaseOrderLineId: line.id,
        }))
      );
    }
  }, [poLines, loadingPOLines, watchedPurchaseOrderId, replace]);

  // Limpiar OC al cambiar proveedor
  useEffect(() => {
    if (watchedPurchaseOrderId) {
      form.setValue('purchaseOrderId', '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedSupplierId]);

  // Limpiar OC al cambiar a NC/ND
  useEffect(() => {
    if (!isRegularInvoice && watchedPurchaseOrderId) {
      form.setValue('purchaseOrderId', '');
      replace([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRegularInvoice]);

  const onSubmit = async (data: PurchaseInvoiceFormInput) => {
    // Validar cantidades contra líneas de OC pendientes
    if (watchedPurchaseOrderId && watchedPurchaseOrderId !== '' && poLines.length > 0) {
      let hasError = false;
      data.lines.forEach((line, index) => {
        const poLine = poLines.find((pl) => pl.id === line.purchaseOrderLineId);
        if (poLine && parseFloat(line.quantity) > poLine.pendingQty) {
          form.setError(`lines.${index}.quantity`, {
            type: 'manual',
            message: `Máximo permitido: ${poLine.pendingQty}`,
          });
          hasError = true;
        }
      });
      if (hasError) return;
    }

    try {
      if (mode === 'edit' && invoiceId) {
        // Modo edición
        const result = await updatePurchaseInvoice(invoiceId, data);
        toast.success('Factura de compra actualizada correctamente');
        router.push(`/dashboard/commercial/purchases/${result.id}`);
      } else {
        // Modo creación
        const result = await createPurchaseInvoice(data);
        toast.success('Factura de compra creada correctamente');
        router.push(`/dashboard/commercial/purchases/${result.id}`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Error al ${mode === 'edit' ? 'actualizar' : 'crear'} la factura`
      );
    }
  };

  const addLine = () => {
    append({
      productId: undefined,
      description: '',
      quantity: '1',
      unitCost: '0',
      vatRate: isTypeC ? '0' : '21',
      purchaseOrderLineId: '',
    });
  };

  const fillProductData = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    form.setValue(`lines.${index}.description`, product.name);
    form.setValue(`lines.${index}.unitCost`, product.costPrice.toString());
    form.setValue(`lines.${index}.vatRate`, isTypeC ? '0' : product.vatRate.toString());
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
        {/* Datos del Comprobante */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Datos del Comprobante</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Proveedor */}
            <FormField
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proveedor *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un proveedor" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.tradeName || supplier.businessName} - {supplier.taxId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Tipo de Comprobante */}
            <FormField
              control={form.control}
              name="voucherType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de Comprobante *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(VOUCHER_TYPE_LABELS).map(([value, label]) => (
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

            {/* Factura Original (solo para NC/ND) */}
            {showOriginalInvoice && (
              <FormField
                control={form.control}
                name="originalInvoiceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Factura Original (opcional)</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ''}
                      disabled={loadingOriginalInvoices}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              loadingOriginalInvoices
                                ? 'Cargando facturas...'
                                : 'Seleccionar factura original'
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {originalInvoices.map((inv) => (
                          <SelectItem key={inv.id} value={inv.id}>
                            {inv.fullNumber} - ${inv.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })} - {moment(inv.issueDate).format('DD/MM/YYYY')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      Vincula esta {isCreditNote(watchedVoucherType) ? 'nota de crédito' : 'nota de débito'} a una factura existente
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Orden de Compra (solo facturas regulares, si hay OCs disponibles) */}
            {isRegularInvoice && watchedSupplierId && (
              <FormField
                control={form.control}
                name="purchaseOrderId"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Orden de Compra (opcional)</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        const actualValue = value === '__none__' ? '' : value;
                        field.onChange(actualValue);
                        if (!actualValue) {
                          replace([]);
                        }
                      }}
                      value={field.value || '__none__'}
                      disabled={loadingPOs}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              loadingPOs
                                ? 'Cargando órdenes...'
                                : purchaseOrders.length === 0
                                  ? 'No hay OC pendientes de facturar'
                                  : 'Seleccionar orden de compra'
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Sin orden de compra</SelectItem>
                        {purchaseOrders.map((po) => (
                          <SelectItem key={po.id} value={po.id}>
                            {po.fullNumber} - {moment.utc(po.issueDate).format('DD/MM/YYYY')} - ${po.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {loadingPOLines && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Cargando líneas de la OC...
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Punto de Venta */}
            <FormField
              control={form.control}
              name="pointOfSale"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Punto de Venta *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="0001"
                      maxLength={4}
                      className="font-mono"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Número */}
            <FormField
              control={form.control}
              name="number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Número *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="00000123"
                      maxLength={8}
                      className="font-mono"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Fecha de Emisión */}
            <FormField
              control={form.control}
              name="issueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de Emisión *</FormLabel>
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

            {/* Fecha de Vencimiento */}
            <FormField
              control={form.control}
              name="dueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de Vencimiento</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                      onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + 'T12:00:00') : undefined)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* CAE */}
            <FormField
              control={form.control}
              name="cae"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>CAE (Código de Autorización Electrónica)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Opcional"
                      className="font-mono"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Observaciones */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Observaciones</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Observaciones adicionales..."
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Card>

        {/* Líneas de la Factura */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Líneas de la Factura</h3>
            <Button type="button" onClick={addLine} variant="outline" size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Agregar Línea
            </Button>
          </div>

          {fields.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No hay líneas agregadas. Haz clic en "Agregar Línea" para empezar.
            </div>
          )}

          <div className="space-y-4">
            {fields.map((field, index) => (
              <Card key={field.id} className="p-4">
                <div className="flex items-start justify-between mb-4">
                  <h4 className="font-medium">Línea {index + 1}</h4>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Producto (opcional) */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.productId`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Producto</FormLabel>
                        <Select
                          onValueChange={(value) => {
                            field.onChange(value);
                            fillProductData(index, value);
                          }}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Opcional" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {products.map((product) => (
                              <SelectItem key={product.id} value={product.id}>
                                {product.code} - {product.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Descripción */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.description`}
                    render={({ field }) => (
                      <FormItem className="lg:col-span-2">
                        <FormLabel>Descripción *</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Descripción del ítem" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Cantidad */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.quantity`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cantidad *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="0.001"
                            min="0"
                            placeholder="1"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Costo Unitario */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.unitCost`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Costo Unitario *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Alícuota IVA */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.vatRate`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>IVA % *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={isTypeC}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecciona" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="0">0%</SelectItem>
                            <SelectItem value="10.5">10.5%</SelectItem>
                            <SelectItem value="21">21%</SelectItem>
                            <SelectItem value="27">27%</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <_PurchaseLineTotals form={form} index={index} />
              </Card>
            ))}
          </div>
        </Card>

        {/* Totales */}
        {fields.length > 0 && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Totales</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-mono">${totals.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">IVA:</span>
                <span className="font-mono">${totals.vatAmount.toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <span>Total:</span>
                <span className="font-mono">${totals.total.toFixed(2)}</span>
              </div>
            </div>
          </Card>
        )}

        {/* Botones de Acción */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Guardando...' : 'Guardar Factura'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
