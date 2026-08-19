'use client';

import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useEffect, useMemo, useState } from 'react';
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
import { Separator } from '@/shared/components/ui/separator';
import { Switch } from '@/shared/components/ui/switch';
import { Plus, Trash2 } from 'lucide-react';
import { _InstallmentManager } from './_InstallmentManager';
import {
  createPurchaseOrder,
  updatePurchaseOrder,
} from '../../list/actions.server';
import {
  purchaseOrderFormSchema,
  type PurchaseOrderFormInput,
} from '../../shared/validators';
import type { SupplierSelectItem, ProductSelectItem } from '../../list/actions.server';
import { formatCurrency } from '@/shared/utils/formatters';
import moment from 'moment';
import { MoneyInput } from '@/shared/components/ui/money-input';

function _LineTotals({
  form,
  index,
}: {
  form: ReturnType<typeof useForm<PurchaseOrderFormInput>>;
  index: number;
}) {
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

interface PurchaseOrderFormProps {
  suppliers: SupplierSelectItem[];
  products: ProductSelectItem[];
  mode?: 'create' | 'edit';
  orderId?: string;
  defaultValues?: Partial<PurchaseOrderFormInput>;
}

export function _PurchaseOrderForm({
  suppliers,
  products,
  mode = 'create',
  orderId,
  defaultValues: initialValues,
}: PurchaseOrderFormProps) {
  const router = useRouter();
  const [totals, setTotals] = useState({ subtotal: 0, vatAmount: 0, total: 0 });
  const watchedSupplierId = form.watch('supplierId');

  const sortedProducts = useMemo(() => {
    if (!watchedSupplierId) return products;
    const supplierProducts = products.filter((p: any) => p.supplierIds?.includes(watchedSupplierId));
    const otherProducts = products.filter((p: any) => !p.supplierIds?.includes(watchedSupplierId));
    return [...supplierProducts, ...otherProducts];
  }, [products, watchedSupplierId]);

  const form = useForm<PurchaseOrderFormInput>({
    resolver: zodResolver(purchaseOrderFormSchema),
    defaultValues: initialValues || {
      supplierId: '',
      issueDate: new Date(),
      expectedDeliveryDate: null,
      paymentConditions: '',
      deliveryAddress: '',
      deliveryNotes: '',
      notes: '',
      lines: [],
      hasInstallments: false,
      installments: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'lines',
  });

  const hasInstallments = form.watch('hasInstallments');

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

  const onSubmit = async (data: PurchaseOrderFormInput) => {
    try {
      if (mode === 'edit' && orderId) {
        await updatePurchaseOrder(orderId, data);
        toast.success('Orden de compra actualizada');
        router.push(`/dashboard/commercial/purchase-orders/${orderId}`);
      } else {
        const result = await createPurchaseOrder(data);
        toast.success(`Orden ${result.fullNumber} creada correctamente`);
        router.push('/dashboard/commercial/purchase-orders');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar la orden');
    }
  };

  const handleAddLine = () => {
    append({
      productId: '',
      description: '',
      quantity: '1',
      unitCost: '0',
      vatRate: '21',
    });
  };

  const handleProductChange = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (product) {
      form.setValue(`lines.${index}.description`, product.name);
      form.setValue(`lines.${index}.unitCost`, product.costPrice.toString());
      form.setValue(`lines.${index}.vatRate`, product.vatRate.toString());
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Datos Básicos */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Datos Básicos</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Proveedor</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un proveedor" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.tradeName || supplier.businessName} — {supplier.taxId}
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
              name="issueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de Emisión</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                      onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + 'T12:00:00') : null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {!hasInstallments && (
              <FormField
                control={form.control}
                name="expectedDeliveryDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de Entrega Esperada (opcional)</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                        onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + 'T12:00:00') : null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="deliveryAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dirección de Entrega (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Dirección de entrega"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <Separator />

        {/* Líneas de Ítems */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Ítems / Servicios</h2>
            <Button type="button" variant="outline" size="sm" onClick={handleAddLine}>
              <Plus className="mr-2 h-4 w-4" />
              Agregar Ítem
            </Button>
          </div>

          {fields.length === 0 && (
            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
              No hay ítems. Haz clic en &quot;Agregar Ítem&quot; para comenzar.
            </div>
          )}

          <div className="space-y-4">
            {fields.map((field, index) => (
              <div key={field.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Ítem {index + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name={`lines.${index}.productId`}
                    render={({ field: productField }) => (
                      <FormItem>
                        <FormLabel>Ítem (opcional)</FormLabel>
                        <Select
                          onValueChange={(value) => {
                            productField.onChange(value);
                            handleProductChange(index, value);
                          }}
                          value={productField.value || ''}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Sin ítem" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent position="popper" className="max-h-[250px]">
                            {sortedProducts.map((product: any) => {
                              const isSupplierProduct = watchedSupplierId && product.supplierIds?.includes(watchedSupplierId);
                              return (
                                <SelectItem key={product.id} value={product.id}>
                                  {isSupplierProduct && '★ '}[{product.code}] {product.name}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`lines.${index}.description`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Descripción</FormLabel>
                        <FormControl>
                          <Input placeholder="Descripción del item" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <FormField
                    control={form.control}
                    name={`lines.${index}.quantity`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cantidad</FormLabel>
                        <FormControl>
                          <Input placeholder="1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`lines.${index}.unitCost`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Valor Unitario</FormLabel>
                        <FormControl>
                          <MoneyInput placeholder="0,00" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`lines.${index}.vatRate`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>IVA %</FormLabel>
                        <FormControl>
                          <Input placeholder="21" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <_LineTotals form={form} index={index} />
              </div>
            ))}
          </div>

          {fields.length > 0 && (
            <div className="flex justify-end mt-4 p-4 bg-muted/50 rounded-lg">
              <div className="space-y-1 text-right font-mono text-sm">
                <div>Subtotal: {formatCurrency(totals.subtotal)}</div>
                <div>IVA: {formatCurrency(totals.vatAmount)}</div>
                <div className="text-lg font-bold">Total: {formatCurrency(totals.total)}</div>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Cuotas / Entregas */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Cuotas / Entregas</h2>
            <FormField
              control={form.control}
              name="hasInstallments"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormLabel className="text-sm text-muted-foreground mt-0">
                    Dividir en cuotas
                  </FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          {hasInstallments ? (
            <_InstallmentManager form={form} orderTotal={totals.total} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Activá &quot;Dividir en cuotas&quot; para distribuir el pago en múltiples entregas.
            </p>
          )}
        </div>

        <Separator />

        {/* Condiciones */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Condiciones</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="paymentConditions"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Condiciones de Pago (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Ej: 30 días, contado, etc."
                      className="resize-none"
                      rows={3}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="deliveryNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas de Entrega (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Instrucciones especiales de entrega"
                      className="resize-none"
                      rows={3}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="mt-4">
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observaciones (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Notas adicionales"
                      className="resize-none"
                      rows={3}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <Separator />

        {/* Acciones */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting
              ? mode === 'edit' ? 'Guardando...' : 'Creando...'
              : mode === 'edit' ? 'Guardar Cambios' : 'Crear Orden de Compra'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
