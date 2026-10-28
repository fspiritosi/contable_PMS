'use client';

import moment from 'moment';

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';

import { _ReceiptBankAccountField } from './_ReceiptBankAccountField';
import type { AvailableBankAccount, ReceiptForm } from './receipt-form-utils';

const TEXT_FIELDS = [
  { key: 'checkNumber', label: 'Número *', placeholder: '123456' },
  { key: 'checkBankName', label: 'Banco emisor *', placeholder: 'Banco Nación' },
  { key: 'checkDrawerName', label: 'Emisor / Librador *', placeholder: 'Nombre del emisor' },
  { key: 'checkDrawerTaxId', label: 'CUIT del emisor (opcional)', placeholder: '30-12345678-9' },
] as const;

const DATE_FIELDS = [
  { key: 'checkIssueDate', label: 'Fecha de emisión' },
  { key: 'checkDueDate', label: 'Fecha de vencimiento *' },
] as const;

interface Props {
  form: ReceiptForm;
  index: number;
  isEcheq: boolean;
  bankAccounts: AvailableBankAccount[];
}

/** Datos del cheque o e-cheq recibido; el e-cheq además pide la cuenta donde ingresó. */
export function _ReceiptCheckFields({ form, index, isEcheq, bankAccounts }: Props) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <p className="text-sm font-medium">Datos del {isEcheq ? 'e-cheq' : 'cheque'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {TEXT_FIELDS.map(({ key, label, placeholder }) => (
          <FormField
            key={key}
            control={form.control}
            name={`payments.${index}.${key}`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{label}</FormLabel>
                <FormControl>
                  <Input placeholder={placeholder} {...field} value={field.value || ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
        {DATE_FIELDS.map(({ key, label }) => (
          <FormField
            key={key}
            control={form.control}
            name={`payments.${index}.${key}`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{label}</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                    onChange={(e) =>
                      field.onChange(e.target.value ? new Date(e.target.value + 'T12:00:00') : null)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
      {isEcheq && (
        <_ReceiptBankAccountField
          form={form}
          index={index}
          bankAccounts={bankAccounts}
          label="Cuenta de depósito *"
          placeholder="Cuenta donde ingresó el e-cheq"
        />
      )}
    </div>
  );
}
