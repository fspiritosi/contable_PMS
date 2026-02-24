'use client';

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import moment from 'moment';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Card } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Separator } from '@/shared/components/ui/separator';
import { Label } from '@/shared/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/components/ui/radio-group';
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

import {
  receivingNoteFormSchema,
  type ReceivingNoteFormInput,
} from '../../shared/validators';
import {
  createReceivingNote,
  updateReceivingNote,
  getApprovedPurchaseOrdersForSupplier,
  getPurchaseOrderLinesForReceiving,
  getConfirmedPurchaseInvoicesForSupplier,
  getProductsForSelect,
} from '../../list/actions.server';

// ============================================
// TIPOS
// ============================================

type SourceType = 'purchaseOrder' | 'purchaseInvoice' | 'none';

interface ReceivingNoteFormProps {
  suppliers: Array<{ id: string; businessName: string; tradeName: string | null; taxId: string }>;
  warehouses: Array<{ id: string; name: string; type: string }>;
  mode?: 'create' | 'edit';
  noteId?: string;
  defaultValues?: Partial<ReceivingNoteFormInput>;
}

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

export function _ReceivingNoteForm({
  suppliers,
  warehouses,
  mode = 'create',
  noteId,
  defaultValues: initialValues,
}: ReceivingNoteFormProps) {
  const router = useRouter();

  const defaultWarehouse = warehouses.find((w) => w.type === 'MAIN') ?? warehouses[0];

  const form = useForm<ReceivingNoteFormInput>({
    resolver: zodResolver(receivingNoteFormSchema),
    defaultValues: initialValues ?? {
      supplierId: '',
      warehouseId: defaultWarehouse?.id ?? '',
      purchaseOrderId: '',
      purchaseInvoiceId: '',
      receptionDate: new Date(),
      notes: '',
      lines: [],
    },
  });

  // Local state via watched fields
  const watchedSupplierId = form.watch('supplierId');
  const watchedPurchaseOrderId = form.watch('purchaseOrderId');
  const watchedPurchaseInvoiceId = form.watch('purchaseInvoiceId');

  // Explicit source type state — avoids derived-value bug where radio snaps back
  const [sourceType, setSourceTypeState] = useState<SourceType>(() => {
    if (initialValues?.purchaseOrderId) return 'purchaseOrder';
    if (initialValues?.purchaseInvoiceId) return 'purchaseInvoice';
    return 'none';
  });

  const setSourceType = useCallback(
    (next: SourceType) => {
      setSourceTypeState(next);
      if (next !== 'purchaseOrder') form.setValue('purchaseOrderId', '');
      if (next !== 'purchaseInvoice') form.setValue('purchaseInvoiceId', '');
      form.setValue('lines', []);
    },
    [form]
  );

  const radioValue = sourceType;

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: 'lines',
  });

  // ============================================
  // REACT QUERY: OCs, FCs, Productos
  // ============================================

  const { data: purchaseOrders = [], isFetching: loadingPOs } = useQuery({
    queryKey: ['approvedPurchaseOrders', watchedSupplierId],
    queryFn: () => getApprovedPurchaseOrdersForSupplier(watchedSupplierId),
    enabled: Boolean(watchedSupplierId),
  });

  const { data: purchaseInvoices = [], isFetching: loadingPIs } = useQuery({
    queryKey: ['confirmedPurchaseInvoices', watchedSupplierId],
    queryFn: () => getConfirmedPurchaseInvoicesForSupplier(watchedSupplierId),
    enabled: Boolean(watchedSupplierId),
  });

  const { data: poLines = [], isFetching: loadingPOLines } = useQuery({
    queryKey: ['purchaseOrderLinesForReceiving', watchedPurchaseOrderId],
    queryFn: () => getPurchaseOrderLinesForReceiving(watchedPurchaseOrderId!),
    enabled: Boolean(watchedPurchaseOrderId),
  });

  const { data: availableProducts = [], isFetching: loadingProducts } = useQuery({
    queryKey: ['productsForSelect'],
    queryFn: getProductsForSelect,
    enabled: radioValue === 'none',
  });

  // ============================================
  // AUTO-POPULATE LINES FROM PO
  // ============================================

  useEffect(() => {
    if (radioValue !== 'purchaseOrder' || !watchedPurchaseOrderId || loadingPOLines) return;

    if (poLines.length > 0) {
      replace(
        poLines.map((line) => ({
          productId: line.productId,
          description: line.description,
          quantity: String(line.pendingQty),
          purchaseOrderLineId: line.id,
          notes: '',
        }))
      );
    }
  }, [poLines, loadingPOLines, watchedPurchaseOrderId, radioValue, replace]);

  // AUTO-POPULATE LINES FROM PURCHASE INVOICE
  useEffect(() => {
    if (radioValue !== 'purchaseInvoice' || !watchedPurchaseInvoiceId) return;

    const selectedInvoice = purchaseInvoices.find((inv) => inv.id === watchedPurchaseInvoiceId);
    if (!selectedInvoice) return;

    // Usar pendingQty (cantidad pendiente de recibir) en vez de quantity total
    // Filtrar líneas sin pendientes (ya recibidas completamente)
    const pendingLines = selectedInvoice.lines.filter(
      (line) => (line.pendingQty ?? line.quantity) > 0
    );

    replace(
      pendingLines.map((line) => ({
        productId: line.productId ?? '',
        description: line.description,
        quantity: String(line.pendingQty ?? line.quantity),
        purchaseOrderLineId: '',
        notes: '',
      }))
    );
  }, [watchedPurchaseInvoiceId, purchaseInvoices, radioValue, replace]);

  // ============================================
  // SUBMIT
  // ============================================

  const onSubmit = async (data: ReceivingNoteFormInput) => {
    // Validar cantidades contra líneas de OC pendientes
    if (radioValue === 'purchaseOrder' && poLines.length > 0) {
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
      if (mode === 'edit' && noteId) {
        await updateReceivingNote(noteId, data);
        toast.success('Remito de recepción actualizado correctamente');
        router.push(`/dashboard/commercial/receiving-notes/${noteId}`);
      } else {
        const result = await createReceivingNote(data);
        toast.success('Remito de recepción creado correctamente');
        router.push(`/dashboard/commercial/receiving-notes/${result.id}`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Error al ${mode === 'edit' ? 'actualizar' : 'crear'} el remito`
      );
    }
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
        {/* ─── SECCIÓN: Datos Generales ─── */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Datos Generales</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Proveedor */}
            <FormField
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proveedor *</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      // Clear document selection and lines when supplier changes
                      form.setValue('purchaseOrderId', '');
                      form.setValue('purchaseInvoiceId', '');
                      form.setValue('lines', []);
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un proveedor" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.tradeName ?? supplier.businessName} — {supplier.taxId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Almacén */}
            <FormField
              control={form.control}
              name="warehouseId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Almacén *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un almacén" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {warehouses.map((warehouse) => (
                        <SelectItem key={warehouse.id} value={warehouse.id}>
                          {warehouse.name}
                          {warehouse.type === 'MAIN' && (
                            <span className="ml-2 text-xs text-muted-foreground">(Principal)</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Fecha de Recepción */}
            <FormField
              control={form.control}
              name="receptionDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de Recepción *</FormLabel>
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
                      value={field.value ?? ''}
                      placeholder="Observaciones adicionales sobre la recepción..."
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Card>

        {/* ─── SECCIÓN: Documento de Origen ─── */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Documento de Origen</h3>

          {/* Radio de tipo de origen */}
          <div className="mb-6">
            <Label className="text-sm font-medium mb-3 block">Tipo de Origen</Label>
            <RadioGroup
              value={radioValue}
              onValueChange={(value) => setSourceType(value as SourceType)}
              className="flex flex-col sm:flex-row gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="purchaseOrder" id="source-po" />
                <Label htmlFor="source-po" className="cursor-pointer font-normal">
                  Orden de Compra
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="purchaseInvoice" id="source-pi" />
                <Label htmlFor="source-pi" className="cursor-pointer font-normal">
                  Factura de Compra
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="none" id="source-none" />
                <Label htmlFor="source-none" className="cursor-pointer font-normal">
                  Sin documento
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Select de Orden de Compra */}
          {radioValue === 'purchaseOrder' && (
            <FormField
              control={form.control}
              name="purchaseOrderId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Orden de Compra *</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue('lines', []);
                    }}
                    value={field.value ?? ''}
                    disabled={!watchedSupplierId || loadingPOs}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            !watchedSupplierId
                              ? 'Selecciona un proveedor primero'
                              : loadingPOs
                                ? 'Cargando órdenes...'
                                : purchaseOrders.length === 0
                                  ? 'Sin órdenes disponibles'
                                  : 'Selecciona una orden de compra'
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {purchaseOrders.map((order) => (
                        <SelectItem key={order.id} value={order.id}>
                          {order.fullNumber} — {moment(order.issueDate).format('DD/MM/YYYY')} — $
                          {order.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {/* Select de Factura de Compra */}
          {radioValue === 'purchaseInvoice' && (
            <FormField
              control={form.control}
              name="purchaseInvoiceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Factura de Compra *</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue('lines', []);
                    }}
                    value={field.value ?? ''}
                    disabled={!watchedSupplierId || loadingPIs}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            !watchedSupplierId
                              ? 'Selecciona un proveedor primero'
                              : loadingPIs
                                ? 'Cargando facturas...'
                                : purchaseInvoices.length === 0
                                  ? 'Sin facturas disponibles'
                                  : 'Selecciona una factura de compra'
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {purchaseInvoices.map((invoice) => (
                        <SelectItem key={invoice.id} value={invoice.id}>
                          {invoice.fullNumber} — {moment(invoice.issueDate).format('DD/MM/YYYY')} — $
                          {invoice.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </Card>

        {/* ─── SECCIÓN: Líneas ─── */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Líneas de Recepción</h3>
            {radioValue === 'none' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({
                    productId: '',
                    description: '',
                    quantity: '1',
                    purchaseOrderLineId: '',
                    notes: '',
                  })
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Agregar Línea
              </Button>
            )}
          </div>

          {/* Mensaje de estado vacío */}
          {fields.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {radioValue === 'purchaseOrder' && !watchedPurchaseOrderId &&
                'Selecciona una Orden de Compra para cargar las líneas automáticamente.'}
              {radioValue === 'purchaseOrder' && watchedPurchaseOrderId && loadingPOLines &&
                'Cargando líneas de la Orden de Compra...'}
              {radioValue === 'purchaseOrder' && watchedPurchaseOrderId && !loadingPOLines &&
                'La Orden de Compra no tiene líneas pendientes de recepción.'}
              {radioValue === 'purchaseInvoice' && !watchedPurchaseInvoiceId &&
                'Selecciona una Factura de Compra para cargar las líneas automáticamente.'}
              {radioValue === 'purchaseInvoice' && watchedPurchaseInvoiceId &&
                'La Factura de Compra no tiene líneas con productos con control de stock.'}
              {radioValue === 'none' &&
                'Haz clic en "Agregar Línea" para agregar productos manualmente.'}
            </div>
          )}

          <div className="space-y-4">
            {fields.map((field, index) => (
              <Card key={field.id} className="p-4 bg-muted/20">
                <div className="flex items-start justify-between mb-3">
                  <h4 className="font-medium text-sm">Línea {index + 1}</h4>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                    disabled={radioValue !== 'none'}
                    title={radioValue !== 'none' ? 'Las líneas se cargan desde el documento de origen' : undefined}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

                  {/* Producto — Editable solo en modo suelto */}
                  {radioValue === 'none' ? (
                    <FormField
                      control={form.control}
                      name={`lines.${index}.productId`}
                      render={({ field: f }) => (
                        <FormItem>
                          <FormLabel>Producto *</FormLabel>
                          <Select
                            onValueChange={(value) => {
                              f.onChange(value);
                              const product = availableProducts.find((p) => p.id === value);
                              if (product) {
                                form.setValue(`lines.${index}.description`, product.name);
                              }
                            }}
                            value={f.value}
                            disabled={loadingProducts}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={loadingProducts ? 'Cargando productos...' : 'Selecciona un producto'}
                                />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {availableProducts.map((product) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.code} — {product.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="flex flex-col gap-1">
                      <Label className="text-sm font-medium">Producto</Label>
                      <div className="h-10 flex items-center px-3 rounded-md border bg-muted text-sm text-muted-foreground truncate">
                        {(() => {
                          const line = form.getValues(`lines.${index}`);
                          if (radioValue === 'purchaseOrder') {
                            const poLine = poLines.find((pl) => pl.id === line.purchaseOrderLineId);
                            return poLine
                              ? `${poLine.product.code} — ${poLine.product.name}`
                              : line.description || 'Producto';
                          }
                          return line.description || 'Producto';
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Descripción */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.description`}
                    render={({ field: f }) => (
                      <FormItem className="lg:col-span-2">
                        <FormLabel>Descripción *</FormLabel>
                        <FormControl>
                          <Input {...f} placeholder="Descripción del ítem" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Cantidad */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.quantity`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel>
                          Cantidad *
                          {radioValue === 'purchaseOrder' && (() => {
                            const line = form.getValues(`lines.${index}`);
                            const poLine = poLines.find((pl) => pl.id === line.purchaseOrderLineId);
                            return poLine ? (
                              <span className="ml-1 text-xs text-muted-foreground font-normal">
                                (máx. {poLine.pendingQty})
                              </span>
                            ) : null;
                          })()}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...f}
                            type="number"
                            step="0.001"
                            min="0.001"
                            max={
                              radioValue === 'purchaseOrder'
                                ? (() => {
                                    const line = form.getValues(`lines.${index}`);
                                    const poLine = poLines.find((pl) => pl.id === line.purchaseOrderLineId);
                                    return poLine ? String(poLine.pendingQty) : undefined;
                                  })()
                                : undefined
                            }
                            placeholder="1"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Notas de línea */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.notes`}
                    render={({ field: f }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Notas de la línea</FormLabel>
                        <FormControl>
                          <Input
                            {...f}
                            value={f.value ?? ''}
                            placeholder="Opcional"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </Card>
            ))}
          </div>

          {/* Error de validación del array de líneas */}
          {form.formState.errors.lines?.root && (
            <p className="text-sm font-medium text-destructive mt-2">
              {form.formState.errors.lines.root.message}
            </p>
          )}
          {typeof form.formState.errors.lines?.message === 'string' && (
            <p className="text-sm font-medium text-destructive mt-2">
              {form.formState.errors.lines.message}
            </p>
          )}
        </Card>

        <Separator />

        {/* ─── ACCIONES ─── */}
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={form.formState.isSubmitting}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? mode === 'edit'
                ? 'Actualizando...'
                : 'Guardando...'
              : mode === 'edit'
                ? 'Actualizar Remito'
                : 'Crear Remito'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
