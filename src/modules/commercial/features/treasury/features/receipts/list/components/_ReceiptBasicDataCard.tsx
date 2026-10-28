'use client';

import { _DateInput } from '@/shared/components/common/_DateInput';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
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
import { Textarea } from '@/shared/components/ui/textarea';

import type { ReceiptForm } from './receipt-form-utils';

interface Props {
  form: ReceiptForm;
  customers: { id: string; name: string }[];
  onCustomerChange: (customerId: string) => void;
  /** En edición el cliente no se cambia: las facturas imputadas son suyas. */
  customerLocked: boolean;
}

export function _ReceiptBasicDataCard({
  form,
  customers,
  onCustomerChange,
  customerLocked,
}: Props) {
  return (
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
              <Select
                onValueChange={onCustomerChange}
                value={field.value}
                disabled={customerLocked}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar cliente" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {customers.length === 0 && (
                    <div className="p-2 text-sm text-muted-foreground">
                      No hay clientes disponibles
                    </div>
                  )}
                  {customers.map((customer) => (
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
                <_DateInput {...field} />
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
  );
}
