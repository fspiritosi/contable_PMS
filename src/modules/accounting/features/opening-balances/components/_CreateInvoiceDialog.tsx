'use client';

import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { MoneyInput } from '@/shared/components/ui/money-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { VoucherType } from '@/generated/prisma/enums';
import {
  openingSalesInvoiceSchema,
  openingPurchaseInvoiceSchema,
  type OpeningSalesInvoiceInput,
  type OpeningPurchaseInvoiceInput,
} from '../validators';
import {
  createOpeningSalesInvoice,
  createOpeningPurchaseInvoice,
} from '../actions.server';

const VOUCHER_TYPE_LABELS: Record<string, string> = {
  FACTURA_A: 'Factura A',
  FACTURA_B: 'Factura B',
  FACTURA_C: 'Factura C',
  NOTA_CREDITO_A: 'Nota de Crédito A',
  NOTA_CREDITO_B: 'Nota de Crédito B',
  NOTA_CREDITO_C: 'Nota de Crédito C',
};

const ALLOWED_VOUCHER_TYPES = [
  VoucherType.FACTURA_A,
  VoucherType.FACTURA_B,
  VoucherType.FACTURA_C,
  VoucherType.NOTA_CREDITO_A,
  VoucherType.NOTA_CREDITO_B,
  VoucherType.NOTA_CREDITO_C,
];

interface SalesProps {
  type: 'sales';
  contractors: Array<{ id: string; name: string; taxId: string | null }>;
  pointsOfSale: Array<{ id: string; number: number; name: string | null }>;
  onCreated: () => void;
}

interface PurchaseProps {
  type: 'purchases';
  suppliers: Array<{
    id: string;
    businessName: string;
    tradeName: string | null;
    taxId: string | null;
  }>;
  onCreated: () => void;
}

type Props = SalesProps | PurchaseProps;

export function _CreateInvoiceDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSales = props.type === 'sales';

  const salesForm = useForm<OpeningSalesInvoiceInput>({
    resolver: isSales ? zodResolver(openingSalesInvoiceSchema) : undefined,
  });

  const purchaseForm = useForm<OpeningPurchaseInvoiceInput>({
    resolver: !isSales ? zodResolver(openingPurchaseInvoiceSchema) : undefined,
  });

  const form = isSales ? salesForm : purchaseForm;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      if (isSales) {
        const data = salesForm.getValues();
        await createOpeningSalesInvoice(data);
      } else {
        const data = purchaseForm.getValues();
        await createOpeningPurchaseInvoice(data);
      }

      toast.success('Factura de apertura creada');
      setOpen(false);
      form.reset();
      props.onCreated();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error desconocido';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Nueva Factura
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            Nueva Factura de {isSales ? 'Venta' : 'Compra'} - Apertura
          </DialogTitle>
          <DialogDescription>
            Cargá una factura pendiente de {isSales ? 'cobro' : 'pago'} del
            sistema anterior.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-4"
        >
          {/* Cliente / Proveedor */}
          <div className="space-y-2">
            <Label>{isSales ? 'Cliente' : 'Proveedor'}</Label>
            {isSales ? (
              <Select
                onValueChange={(v) => salesForm.setValue('customerId', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {(props as SalesProps).contractors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.taxId ? ` (${c.taxId})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select
                onValueChange={(v) => purchaseForm.setValue('supplierId', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {(props as PurchaseProps).suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.businessName}
                      {s.taxId ? ` (${s.taxId})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {form.formState.errors[isSales ? 'customerId' : 'supplierId'] && (
              <p className="text-sm text-destructive">
                {String(
                  form.formState.errors[
                    isSales ? 'customerId' : 'supplierId'
                  ]?.message
                )}
              </p>
            )}
          </div>

          {/* Tipo de Comprobante */}
          <div className="space-y-2">
            <Label>Tipo de Comprobante</Label>
            <Select
              onValueChange={(v) =>
                form.setValue(
                  'voucherType' as never,
                  v as never
                )
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {ALLOWED_VOUCHER_TYPES.map((vt) => (
                  <SelectItem key={vt} value={vt}>
                    {VOUCHER_TYPE_LABELS[vt] || vt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Punto de Venta y Número */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Punto de Venta</Label>
              {isSales ? (
                <Select
                  onValueChange={(v) =>
                    salesForm.setValue('pointOfSaleId', v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(props as SalesProps).pointsOfSale.map((pos) => (
                      <SelectItem key={pos.id} value={pos.id}>
                        {String(pos.number).padStart(4, '0')}
                        {pos.name ? ` - ${pos.name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="0001"
                  {...purchaseForm.register('pointOfSale')}
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>Número</Label>
              <Input
                placeholder="00000001"
                {...form.register('number' as never)}
              />
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fecha de Emisión</Label>
              <Input
                type="date"
                {...form.register('issueDate' as never)}
              />
            </div>
            <div className="space-y-2">
              <Label>Fecha de Vencimiento (opcional)</Label>
              <Input
                type="date"
                {...form.register('dueDate' as never)}
              />
            </div>
          </div>

          {/* Total */}
          <div className="space-y-2">
            <Label>Total</Label>
            <Controller
              control={form.control}
              name={'total' as never}
              render={({ field }) => (
                <MoneyInput
                  placeholder="0,00"
                  value={(field.value as string | number | null | undefined) ?? ''}
                  onChange={(raw) => field.onChange(raw === '' ? undefined : Number(raw))}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              )}
            />
            {form.formState.errors['total' as never] && (
              <p className="text-sm text-destructive">
                {String(
                  (form.formState.errors['total' as never] as { message: string })?.message
                )}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Crear Factura
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
