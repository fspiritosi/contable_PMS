'use client';

import { ArrowDownToLine, Trash2 } from 'lucide-react';
import { useWatch } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { MoneyInput } from '@/shared/components/ui/money-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { SELECTABLE_PAYMENT_METHOD_LABELS } from '../../../../shared/validators';
import { _ReceiptBankAccountField } from './_ReceiptBankAccountField';
import { _ReceiptCheckFields } from './_ReceiptCheckFields';
import {
  remainingForPayment,
  type AvailableBankAccount,
  type AvailableCashRegister,
  type ReceiptForm,
} from './receipt-form-utils';

interface Props {
  form: ReceiptForm;
  index: number;
  onRemove: () => void;
  cashRegisters: AvailableCashRegister[];
  bankAccounts: AvailableBankAccount[];
}

export function _ReceiptPaymentRow({ form, index, onRemove, cashRegisters, bankAccounts }: Props) {
  const paymentMethod = useWatch({
    control: form.control,
    name: `payments.${index}.paymentMethod`,
  });

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Pago {index + 1}</h4>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
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
                  {Object.entries(SELECTABLE_PAYMENT_METHOD_LABELS).map(([value, label]) => (
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
                  <MoneyInput
                    placeholder="0,00"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                </FormControl>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 px-2 text-xs"
                  onClick={() => {
                    const remaining = remainingForPayment(form.getValues(), index);
                    form.setValue(`payments.${index}.amount`, remaining.toFixed(2));
                  }}
                  title="Usar monto restante"
                >
                  <ArrowDownToLine className="mr-1 h-3 w-3" />
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
        <_ReceiptBankAccountField
          form={form}
          index={index}
          bankAccounts={bankAccounts}
          label="Cuenta Bancaria"
          placeholder="Seleccionar cuenta"
        />
      )}

      {(paymentMethod === 'CHECK' || paymentMethod === 'ECHEQ') && (
        <_ReceiptCheckFields
          form={form}
          index={index}
          isEcheq={paymentMethod === 'ECHEQ'}
          bankAccounts={bankAccounts}
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
}
