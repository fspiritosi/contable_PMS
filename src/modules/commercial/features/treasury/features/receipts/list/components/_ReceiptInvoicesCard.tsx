'use client';

import { AlertCircle, Trash2 } from 'lucide-react';
import { useFieldArray } from 'react-hook-form';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { MoneyInput } from '@/shared/components/ui/money-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { formatCurrency } from '@/shared/utils/formatters';

import type { PendingInvoice } from '../../../../shared/types';
import type { ReceiptForm } from './receipt-form-utils';

interface Props {
  form: ReceiptForm;
  customerId: string | null;
  pendingInvoices: PendingInvoice[];
  loading: boolean;
  /**
   * Edición: lo que este borrador ya imputa a cada factura. El pendiente que
   * informa `getPendingInvoices` lo descuenta, así que se le vuelve a sumar.
   */
  ownAmounts: Record<string, number>;
  /** Edición: número de las facturas ya imputadas, por si dejaron de estar pendientes. */
  invoiceLabels: Record<string, string>;
}

export function _ReceiptInvoicesCard({
  form,
  customerId,
  pendingInvoices,
  loading,
  ownAmounts,
  invoiceLabels,
}: Props) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });

  const pendingFor = (invoiceId: string) =>
    (pendingInvoices.find((inv) => inv.id === invoiceId)?.pendingAmount ?? 0) +
    (ownAmounts[invoiceId] ?? 0);

  const addInvoiceItem = (invoiceId: string) => {
    if (!pendingInvoices.some((inv) => inv.id === invoiceId)) return;
    if (fields.some((field) => field.invoiceId === invoiceId)) {
      toast.error('Esta factura ya fue agregada');
      return;
    }
    append({ invoiceId, amount: pendingFor(invoiceId).toString() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Facturas a Cobrar</CardTitle>
        <CardDescription>Seleccione las facturas pendientes del cliente</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!customerId && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Seleccione un cliente para ver sus facturas pendientes
            </AlertDescription>
          </Alert>
        )}

        {customerId && loading && <Skeleton className="h-20 w-full" />}

        {customerId && !loading && pendingInvoices.length === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>El cliente no tiene facturas pendientes de cobro</AlertDescription>
          </Alert>
        )}

        {customerId && !loading && pendingInvoices.length > 0 && (
          <Select onValueChange={addInvoiceItem}>
            <SelectTrigger>
              <SelectValue placeholder="Agregar factura" />
            </SelectTrigger>
            <SelectContent>
              {pendingInvoices.map((invoice) => (
                <SelectItem key={invoice.id} value={invoice.id}>
                  {invoice.fullNumber} - Pendiente: {formatCurrency(pendingFor(invoice.id))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {fields.map((field, index) => {
          const invoice = pendingInvoices.find((inv) => inv.id === field.invoiceId);
          const pending = pendingFor(field.invoiceId);
          return (
            <div
              key={field.id}
              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-end"
            >
              <div className="flex-1">
                <div className="text-sm font-medium">
                  {invoice?.fullNumber ?? invoiceLabels[field.invoiceId]}
                </div>
                <div className="text-xs text-muted-foreground">
                  Pendiente: {formatCurrency(pending)}
                </div>
              </div>
              <FormField
                control={form.control}
                name={`items.${index}.amount`}
                render={({ field: amountField }) => (
                  <FormItem className="sm:w-64">
                    <FormLabel className="text-xs">Monto</FormLabel>
                    <div className="flex gap-1">
                      <FormControl>
                        <MoneyInput
                          placeholder="0,00"
                          value={amountField.value}
                          onChange={amountField.onChange}
                          onBlur={amountField.onBlur}
                          name={amountField.name}
                          ref={amountField.ref}
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="px-2 text-xs"
                        onClick={() => form.setValue(`items.${index}.amount`, pending.toFixed(2))}
                        title="Usar monto pendiente completo"
                      >
                        Total
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
