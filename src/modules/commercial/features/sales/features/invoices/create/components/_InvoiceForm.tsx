'use client';

import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover';
import { Plus, Trash2, BadgePercent } from 'lucide-react';
import { getDiscountPresetsForSelect } from '@/modules/company/features/discount-presets/list/actions.server';
import { createInvoice, updateInvoice, getAllowedVoucherTypesForCustomer, getCustomerInvoicesForSelect } from '../../list/actions.server';
import { updateQuoteAfterInvoice } from '@/modules/commercial/features/quotes/list/actions.server';
import { isCreditNote, isDebitNote } from '@/modules/commercial/shared/voucher-utils';
import { invoiceFormSchema, VOUCHER_TYPE_LABELS } from '../../shared/validators';
import { z } from 'zod';
import moment from 'moment';
import { useEffect, useRef, useState } from 'react';
import { Card } from '@/shared/components/ui/card';
import { logger } from '@/shared/lib/logger';
import { Separator } from '@/shared/components/ui/separator';
import type { VoucherType } from '@/generated/prisma/enums';

type FormInput = z.infer<typeof invoiceFormSchema>;

const formatCurrency = (value: number) =>
  `$${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// _LineTotals removido — cálculos integrados en _InvoiceLineRow

interface InvoiceLineRowProps {
  form: ReturnType<typeof useForm<FormInput>>;
  index: number;
  products: InvoiceFormProps['products'];
  discountPresets: Array<{ id: string; name: string; percentage: number }>;
  onProductSelect: (index: number, productId: string) => void;
  onRemove: () => void;
}

function _InvoiceLineRow({
  form,
  index,
  products,
  discountPresets,
  onProductSelect,
  onRemove,
}: InvoiceLineRowProps) {
  const line = useWatch({ control: form.control, name: `lines.${index}` });

  const qty = parseFloat(line?.quantity ?? '0');
  const price = parseFloat(line?.unitPrice ?? '0');
  const dtoPercent = parseFloat(line?.discountPercent ?? '0');
  const dtoAmount = parseFloat(line?.discountAmount ?? '0');
  const vat = parseFloat(line?.vatRate ?? '0');

  const baseAmount = isNaN(qty) || isNaN(price) ? 0 : Math.round(qty * price * 100) / 100;

  let discountValue = 0;
  if (!isNaN(dtoPercent) && dtoPercent > 0) {
    discountValue = Math.round(baseAmount * (dtoPercent / 100) * 100) / 100;
  } else if (!isNaN(dtoAmount) && dtoAmount > 0) {
    discountValue = Math.round(Math.min(dtoAmount, baseAmount) * 100) / 100;
  }

  const neto = Math.round((baseAmount - discountValue) * 100) / 100;
  const iva = isNaN(vat) ? 0 : Math.round(neto * (vat / 100) * 100) / 100;
  const total = Math.round((neto + iva) * 100) / 100;

  const selectedProduct = products.find((p) => p.id === line?.productId);

  return (
    <div className="py-3 px-2">
      {/* Desktop: fila tipo tabla */}
      <div className="hidden lg:block space-y-1.5">
        {/* Fila principal: datos numéricos alineados con headers */}
        <div className="grid grid-cols-[minmax(240px,2fr)_90px_110px_100px_90px_110px_110px_110px_36px] gap-3 items-center">
          {/* Producto select */}
          <FormField
            control={form.control}
            name={`lines.${index}.productId`}
            render={({ field }) => (
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  onProductSelect(index, value);
                }}
                value={field.value}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Seleccionar producto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.code} - {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />

          {/* Cantidad */}
          <FormField
            control={form.control}
            name={`lines.${index}.quantity`}
            render={({ field }) => (
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  inputMode="decimal"
                  placeholder="1"
                  className="h-9 text-sm text-right font-mono"
                />
              </FormControl>
            )}
          />

          {/* Precio Unit. */}
          <FormField
            control={form.control}
            name={`lines.${index}.unitPrice`}
            render={({ field }) => (
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-9 text-sm text-right font-mono"
                />
              </FormControl>
            )}
          />

          {/* Dto. (% o $) */}
          <div className="flex items-center gap-0.5">
            <FormField
              control={form.control}
              name={`lines.${index}.discountPercent`}
              render={({ field }) => (
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    type="text"
                    inputMode="decimal"
                    placeholder="%"
                    className="h-9 text-sm text-right font-mono flex-1 min-w-0"
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
                        field.onChange(val);
                        if (val) form.setValue(`lines.${index}.discountAmount`, '');
                      }
                    }}
                  />
                </FormControl>
              )}
            />
            {discountPresets.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <BadgePercent className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-1.5" align="start">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Presets</p>
                  {discountPresets.map((preset) => (
                    <Button
                      key={preset.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between text-xs h-7"
                      onClick={() => {
                        form.setValue(`lines.${index}.discountPercent`, preset.percentage.toString());
                        form.setValue(`lines.${index}.discountAmount`, '');
                      }}
                    >
                      <span>{preset.name}</span>
                      <span className="text-muted-foreground">{preset.percentage}%</span>
                    </Button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* IVA % */}
          <FormField
            control={form.control}
            name={`lines.${index}.vatRate`}
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value} disabled={isTypeC}>
                <SelectTrigger className="h-9 text-sm font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0%</SelectItem>
                  <SelectItem value="10.5">10.5%</SelectItem>
                  <SelectItem value="21">21%</SelectItem>
                  <SelectItem value="27">27%</SelectItem>
                </SelectContent>
              </Select>
            )}
          />

          {/* Subtotal (calculado) */}
          <span className="text-sm font-mono text-right tabular-nums">{formatCurrency(neto)}</span>

          {/* IVA (calculado) */}
          <span className="text-sm font-mono text-right tabular-nums">{formatCurrency(iva)}</span>

          {/* Total (calculado) */}
          <span className="text-sm font-mono text-right font-semibold tabular-nums">{formatCurrency(total)}</span>

          {/* Eliminar */}
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onRemove}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>

        {/* Segunda fila: descripción editable */}
        <div className="grid grid-cols-[minmax(240px,2fr)_1fr] gap-3">
          <FormField
            control={form.control}
            name={`lines.${index}.description`}
            render={({ field }) => (
              <FormControl>
                <Input
                  {...field}
                  placeholder="Descripción del producto o servicio"
                  className="h-7 text-xs text-muted-foreground border-dashed"
                />
              </FormControl>
            )}
          />
          {discountValue > 0 && (
            <span className="text-xs font-mono text-orange-600 self-center text-right">
              Dto: -{formatCurrency(discountValue)}
            </span>
          )}
        </div>
      </div>

      {/* Mobile: layout apilado */}
      <div className="lg:hidden space-y-3">
        <div className="flex items-start justify-between">
          <span className="text-sm font-medium text-muted-foreground">Línea {index + 1}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>

        <FormField
          control={form.control}
          name={`lines.${index}.productId`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Producto</FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  onProductSelect(index, value);
                }}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar producto" />
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
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name={`lines.${index}.description`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Descripción</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Descripción del producto o servicio" />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name={`lines.${index}.quantity`}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Cantidad</FormLabel>
                <FormControl>
                  <Input {...field} type="text" inputMode="decimal" placeholder="1" />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`lines.${index}.unitPrice`}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Precio Unit.</FormLabel>
                <FormControl>
                  <Input {...field} type="text" inputMode="decimal" placeholder="0.00" />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`lines.${index}.discountPercent`}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Dto %</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
                        field.onChange(val);
                        if (val) form.setValue(`lines.${index}.discountAmount`, '');
                      }
                    }}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={`lines.${index}.vatRate`}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">IVA %</FormLabel>
                <Select onValueChange={field.onChange} value={field.value} disabled={isTypeC}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="0">0%</SelectItem>
                    <SelectItem value="10.5">10.5%</SelectItem>
                    <SelectItem value="21">21%</SelectItem>
                    <SelectItem value="27">27%</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
        </div>

        <div className="flex flex-wrap justify-end gap-3 text-sm font-mono pt-1">
          {discountValue > 0 && <span className="text-orange-600">Dto: -{formatCurrency(discountValue)}</span>}
          <span className="text-muted-foreground">Neto: {formatCurrency(neto)}</span>
          <span className="text-muted-foreground">IVA: {formatCurrency(iva)}</span>
          <span className="font-semibold">Total: {formatCurrency(total)}</span>
        </div>
      </div>
    </div>
  );
}

interface InvoiceFormProps {
  customers: Array<{ id: string; name: string; taxId: string | null; email: string | null }>;
  pointsOfSale: Array<{
    id: string;
    number: number;
    name: string;
    afipEnabled: boolean;
  }>;
  products: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    unitOfMeasure: string;
    salePrice: any;
    salePriceWithTax: any;
    vatRate: any;
    trackStock: boolean;
  }>;
  mode?: 'create' | 'edit';
  invoiceId?: string;
  initialData?: FormInput;
  fromQuoteId?: string;
}

export function InvoiceForm({ customers, pointsOfSale, products, mode = 'create', invoiceId, initialData, fromQuoteId }: InvoiceFormProps) {
  const router = useRouter();
  const isEdit = mode === 'edit';
  const [totals, setTotals] = useState({
    subtotalBeforeDiscount: 0,
    lineDiscounts: 0,
    globalDiscount: 0,
    subtotal: 0,
    vatAmount: 0,
    total: 0,
  });

  const { data: discountPresets = [] } = useQuery({
    queryKey: ['discount-presets-select'],
    queryFn: getDiscountPresetsForSelect,
  });
  const [allowedVoucherTypes, setAllowedVoucherTypes] = useState<VoucherType[] | null>(null);
  const [loadingVoucherTypes, setLoadingVoucherTypes] = useState(false);
  const [originalInvoices, setOriginalInvoices] = useState<Awaited<ReturnType<typeof getCustomerInvoicesForSelect>>>([]);
  const [loadingOriginalInvoices, setLoadingOriginalInvoices] = useState(false);

  const form = useForm<FormInput>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: initialData || {
      customerId: '',
      pointOfSaleId: '',
      voucherType: 'FACTURA_B',
      originalInvoiceId: '',
      issueDate: new Date(),
      dueDate: undefined,
      notes: '',
      internalNotes: '',
      lines: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'lines',
  });

  // Quote conversion data stored in ref for post-creation update
  const quoteConversionRef = useRef<{
    fromQuoteId: string;
    quoteLineQuantities: Array<{ lineId: string; quantity: number }>;
  } | null>(null);

  // Load pre-filled data from sessionStorage when coming from a quote conversion
  useEffect(() => {
    if (!fromQuoteId) return;

    const storageKey = `quote-conversion-${fromQuoteId}`;
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as {
        fromQuoteId: string;
        customerId: string;
        lines: Array<{
          productId: string;
          description: string;
          quantity: string;
          unitPrice: string;
          vatRate: string;
          discountPercent: string;
          discountAmount: string;
        }>;
        quoteLineQuantities: Array<{ lineId: string; quantity: number }>;
      };

      // Store quote data for post-creation
      quoteConversionRef.current = {
        fromQuoteId: data.fromQuoteId,
        quoteLineQuantities: data.quoteLineQuantities,
      };

      // Set customer
      if (data.customerId) {
        form.setValue('customerId', data.customerId);
      }

      // Set lines
      if (data.lines.length > 0) {
        // Clear existing lines first
        const currentFields = form.getValues('lines');
        for (let i = currentFields.length - 1; i >= 0; i--) {
          remove(i);
        }

        // Add quote lines
        for (const line of data.lines) {
          append({
            productId: line.productId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            vatRate: line.vatRate,
            discountPercent: line.discountPercent || undefined,
            discountAmount: line.discountAmount || undefined,
          });
        }
      }

      // Clean up sessionStorage
      sessionStorage.removeItem(storageKey);
    } catch (err) {
      logger.error('Error al cargar datos de conversión de presupuesto', { data: { fromQuoteId, error: err } });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromQuoteId]);

  // Recalcular totales cuando cambien las líneas o descuentos globales
  useEffect(() => {
    const subscription = form.watch((value) => {
      if (value.lines) {
        let subtotalBeforeDiscount = 0;
        let totalLineDiscounts = 0;
        let vatAmount = 0;

        // Calcular subtotales por línea con descuentos
        const lineDetails = value.lines.map((line) => {
          const qty = parseFloat(line?.quantity ?? '0');
          const price = parseFloat(line?.unitPrice ?? '0');
          const vat = parseFloat(line?.vatRate ?? '0');
          const dtoPercent = parseFloat(line?.discountPercent ?? '0');
          const dtoAmount = parseFloat(line?.discountAmount ?? '0');

          const baseAmount = isNaN(qty) || isNaN(price) ? 0 : Math.round(qty * price * 100) / 100;

          let discountValue = 0;
          if (!isNaN(dtoPercent) && dtoPercent > 0) {
            discountValue = Math.round(baseAmount * (dtoPercent / 100) * 100) / 100;
          } else if (!isNaN(dtoAmount) && dtoAmount > 0) {
            discountValue = Math.round(Math.min(dtoAmount, baseAmount) * 100) / 100;
          }

          const lineSubtotal = Math.round((baseAmount - discountValue) * 100) / 100;

          subtotalBeforeDiscount += baseAmount;
          totalLineDiscounts += discountValue;

          return { lineSubtotal, vat: isNaN(vat) ? 0 : vat };
        });

        const sumLineSubtotals = Math.round(lineDetails.reduce((s, l) => s + l.lineSubtotal, 0) * 100) / 100;

        // Descuento global
        const globalDtoPercent = parseFloat(value.globalDiscountPercent ?? '0');
        const globalDtoAmount = parseFloat(value.globalDiscountAmount ?? '0');
        let globalDiscount = 0;
        if (!isNaN(globalDtoPercent) && globalDtoPercent > 0) {
          globalDiscount = Math.round(sumLineSubtotals * (globalDtoPercent / 100) * 100) / 100;
        } else if (!isNaN(globalDtoAmount) && globalDtoAmount > 0) {
          globalDiscount = Math.round(Math.min(globalDtoAmount, sumLineSubtotals) * 100) / 100;
        }

        // Distribuir descuento global proporcionalmente para calcular IVA
        lineDetails.forEach((line) => {
          const weight = sumLineSubtotals > 0 ? line.lineSubtotal / sumLineSubtotals : 0;
          const lineGlobalDiscount = globalDiscount * weight;
          const adjustedSubtotal = Math.max(line.lineSubtotal - lineGlobalDiscount, 0);
          vatAmount += adjustedSubtotal * (line.vat / 100);
        });

        const subtotal = Math.round((sumLineSubtotals - globalDiscount) * 100) / 100;

        setTotals({
          subtotalBeforeDiscount: Math.round(subtotalBeforeDiscount * 100) / 100,
          lineDiscounts: Math.round(totalLineDiscounts * 100) / 100,
          globalDiscount: Math.round(globalDiscount * 100) / 100,
          subtotal: Math.round(subtotal * 100) / 100,
          vatAmount: Math.round(vatAmount * 100) / 100,
          total: Math.round((subtotal + vatAmount) * 100) / 100,
        });
      }
    });

    return () => subscription.unsubscribe();
  }, [form]);

  // Cargar tipos de comprobante permitidos cuando se selecciona cliente
  useEffect(() => {
    const customerId = form.watch('customerId');

    if (!customerId) {
      setAllowedVoucherTypes(null);
      return;
    }

    const fetchAllowedTypes = async () => {
      try {
        setLoadingVoucherTypes(true);
        const types = await getAllowedVoucherTypesForCustomer(customerId);
        setAllowedVoucherTypes(types);

        // Si el tipo actual no está permitido, resetear
        const currentType = form.getValues('voucherType');
        if (currentType && !types.includes(currentType as VoucherType)) {
          form.setValue('voucherType', types[0] as any);
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Error al cargar tipos de comprobante'
        );
      } finally {
        setLoadingVoucherTypes(false);
      }
    };

    fetchAllowedTypes();
  }, [form.watch('customerId')]);

  // Cargar facturas originales cuando se selecciona NC/ND
  const watchedVoucherType = form.watch('voucherType');
  const watchedCustomerId = form.watch('customerId');
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
    if (!showOriginalInvoice || !watchedCustomerId) {
      setOriginalInvoices([]);
      form.setValue('originalInvoiceId', '');
      return;
    }

    const fetchInvoices = async () => {
      setLoadingOriginalInvoices(true);
      try {
        const invoices = await getCustomerInvoicesForSelect(watchedCustomerId);
        setOriginalInvoices(invoices);
      } catch {
        setOriginalInvoices([]);
      } finally {
        setLoadingOriginalInvoices(false);
      }
    };

    fetchInvoices();
  }, [showOriginalInvoice, watchedCustomerId]);

  const handleAddLine = () => {
    append({
      productId: '',
      description: '',
      quantity: '1',
      unitPrice: '0',
      vatRate: isTypeC ? '0' : '21',
      discountPercent: '',
      discountAmount: '',
    });
  };

  const handleProductSelect = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (product) {
      form.setValue(`lines.${index}.description`, product.name);
      form.setValue(`lines.${index}.unitPrice`, product.salePrice.toString());
      form.setValue(`lines.${index}.vatRate`, isTypeC ? '0' : product.vatRate.toString());
    }
  };

  const onSubmit = async (data: FormInput) => {
    try {
      if (data.lines.length === 0) {
        toast.error('Debe agregar al menos una línea a la factura');
        return;
      }

      if (isEdit && invoiceId) {
        await updateInvoice(invoiceId, data);
        toast.success('Factura actualizada correctamente');
        router.push(`/dashboard/commercial/invoices/${invoiceId}`);
      } else {
        await createInvoice(data);

        // Si viene de un presupuesto, actualizar las cantidades facturadas
        if (quoteConversionRef.current) {
          try {
            await updateQuoteAfterInvoice(
              quoteConversionRef.current.fromQuoteId,
              quoteConversionRef.current.quoteLineQuantities.map((lq) => ({
                lineId: lq.lineId,
                invoicedQty: lq.quantity,
              })),
            );
          } catch (quoteError) {
            logger.error('Error al actualizar presupuesto después de facturar', {
              data: { error: quoteError },
            });
            toast.warning('La factura se creó pero no se pudo actualizar el presupuesto');
          }
        }

        toast.success('Factura creada correctamente');
        router.push('/dashboard/commercial/invoices');
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ocurrió un error');
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Encabezado de Factura */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Datos de la Factura</h3>
          <div className="grid gap-6 md:grid-cols-2">
            <FormField
              control={form.control}
              name="customerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar cliente" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                          {customer.taxId && ` - ${customer.taxId}`}
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
              name="pointOfSaleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Punto de Venta</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={isEdit}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar punto de venta" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {pointsOfSale.map((pos) => (
                        <SelectItem key={pos.id} value={pos.id}>
                          {pos.number.toString().padStart(4, '0')} - {pos.name}
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
              name="voucherType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de Comprobante</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={loadingVoucherTypes || !form.watch('customerId')}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            loadingVoucherTypes
                              ? 'Cargando tipos...'
                              : !form.watch('customerId')
                              ? 'Primero seleccione un cliente'
                              : 'Seleccionar tipo'
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(VOUCHER_TYPE_LABELS)
                        .filter(([value]) =>
                          !allowedVoucherTypes ||
                          allowedVoucherTypes.includes(value as VoucherType)
                        )
                        .map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {allowedVoucherTypes && allowedVoucherTypes.length < 10 && (
                    <p className="text-sm text-muted-foreground">
                      Tipos permitidos según condición fiscal del cliente
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

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

            <FormField
              control={form.control}
              name="issueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de Emisión</FormLabel>
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
              name="dueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de Vencimiento (Opcional)</FormLabel>
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
          </div>
        </Card>

        {/* Detalle de Productos/Servicios */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Detalle de Productos/Servicios</h3>
            <Button type="button" variant="outline" size="sm" onClick={handleAddLine}>
              <Plus className="h-4 w-4 mr-2" />
              Agregar Línea
            </Button>
          </div>

          {fields.length > 0 && (
            <div className="overflow-x-auto">
              {/* Header de tabla */}
              <div className="hidden lg:grid lg:grid-cols-[minmax(240px,2fr)_90px_110px_100px_90px_110px_110px_110px_36px] gap-3 px-2 pb-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <span>Producto / Descripción</span>
                <span className="text-right">Cant.</span>
                <span className="text-right">P. Unit.</span>
                <span className="text-right">Dto.</span>
                <span className="text-right">IVA %</span>
                <span className="text-right">Subtotal</span>
                <span className="text-right">IVA</span>
                <span className="text-right">Total</span>
                <span></span>
              </div>

              <div className="divide-y">
                {fields.map((field, index) => (
                  <_InvoiceLineRow
                    key={field.id}
                    form={form}
                    index={index}
                    products={products}
                    discountPresets={discountPresets}
                    onProductSelect={handleProductSelect}
                    onRemove={() => remove(index)}
                  />
                ))}
              </div>
            </div>
          )}

          {fields.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No hay líneas agregadas. Hacé clic en &quot;Agregar Línea&quot; para comenzar.
            </div>
          )}
        </Card>

        {/* Descuento Global */}
        {fields.length > 0 && (
          <Card className="p-4">
            <h4 className="text-sm font-semibold mb-3">Descuento Global</h4>
            <div className="flex flex-wrap items-end gap-4">
              <FormField
                control={form.control}
                name="globalDiscountPercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dto %</FormLabel>
                    <div className="flex items-center gap-1">
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          placeholder="0"
                          className="w-20"
                          onChange={(e) => {
                            field.onChange(e.target.value);
                            if (e.target.value) {
                              form.setValue('globalDiscountAmount', '');
                            }
                          }}
                        />
                      </FormControl>
                      {discountPresets.length > 0 && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                              <BadgePercent className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-48 p-2" align="start">
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground mb-2">Presets</p>
                              {discountPresets.map((preset) => (
                                <Button
                                  key={preset.id}
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="w-full justify-between text-sm"
                                  onClick={() => {
                                    form.setValue('globalDiscountPercent', preset.percentage.toString());
                                    form.setValue('globalDiscountAmount', '');
                                  }}
                                >
                                  <span>{preset.name}</span>
                                  <span className="text-muted-foreground">{preset.percentage}%</span>
                                </Button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="globalDiscountAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dto $</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        className="w-24"
                        onChange={(e) => {
                          field.onChange(e.target.value);
                          if (e.target.value) {
                            form.setValue('globalDiscountPercent', '');
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </Card>
        )}

        {/* Totales */}
        {fields.length > 0 && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Totales</h3>
            <div className="space-y-2 max-w-sm ml-auto">
              {(totals.lineDiscounts > 0 || totals.globalDiscount > 0) && (
                <>
                  <div className="flex justify-between">
                    <span>Subtotal (antes dto):</span>
                    <span className="font-mono">{formatCurrency(totals.subtotalBeforeDiscount)}</span>
                  </div>
                  {totals.lineDiscounts > 0 && (
                    <div className="flex justify-between text-orange-600">
                      <span>Descuento líneas:</span>
                      <span className="font-mono">-{formatCurrency(totals.lineDiscounts)}</span>
                    </div>
                  )}
                  {totals.globalDiscount > 0 && (
                    <div className="flex justify-between text-orange-600">
                      <span>Descuento global:</span>
                      <span className="font-mono">-{formatCurrency(totals.globalDiscount)}</span>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between">
                <span>Base Imponible:</span>
                <span className="font-mono">{formatCurrency(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>IVA:</span>
                <span className="font-mono">{formatCurrency(totals.vatAmount)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <span>Total:</span>
                <span className="font-mono">{formatCurrency(totals.total)}</span>
              </div>
            </div>
          </Card>
        )}

        {/* Notas */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Observaciones</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (visibles en la factura)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Condiciones de pago, agradecimientos, etc."
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="internalNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas Internas (no visibles)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Notas para uso interno" rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Card>

        {/* Acciones */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/dashboard/commercial/invoices')}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? (isEdit ? 'Guardando...' : 'Creando...')
              : (isEdit ? 'Guardar Cambios' : 'Crear Factura')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
