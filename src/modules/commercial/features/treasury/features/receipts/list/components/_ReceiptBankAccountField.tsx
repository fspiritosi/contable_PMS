'use client';

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

import type { AvailableBankAccount, ReceiptForm } from './receipt-form-utils';

interface Props {
  form: ReceiptForm;
  index: number;
  bankAccounts: AvailableBankAccount[];
  label: string;
  placeholder: string;
}

/** Cuenta bancaria del cobro: destino de la transferencia/débito o cuenta de depósito del e-cheq. */
export function _ReceiptBankAccountField({ form, index, bankAccounts, label, placeholder }: Props) {
  return (
    <FormField
      control={form.control}
      name={`payments.${index}.bankAccountId`}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select onValueChange={field.onChange} value={field.value || undefined}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={placeholder} />
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
  );
}
