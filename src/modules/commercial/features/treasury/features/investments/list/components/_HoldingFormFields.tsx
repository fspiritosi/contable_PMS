'use client';

import type { UseFormReturn } from 'react-hook-form';

import { AccountCombobox } from '@/shared/components/common/AccountCombobox';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { INSTRUMENT_TYPE_LABELS } from '../../shared/types';
import type { HoldingFormInput } from '../../shared/validators';
import type { HoldingFormCatalogs } from '../actions.server';

interface Props {
  form: UseFormReturn<HoldingFormInput>;
  catalogs?: HoldingFormCatalogs;
  hasMaturity: boolean;
}

export function _HoldingFormFields({ form, catalogs, hasMaturity }: Props) {
  return (
    <>
      <FormField
        control={form.control}
        name="bankAccountId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Banco o broker *</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {catalogs?.banks.map((bank) => (
                  <SelectItem key={bank.id} value={bank.id}>
                    {bank.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="instrumentType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo de instrumento *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(INSTRUMENT_TYPE_LABELS).map(([value, label]) => (
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
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre *</FormLabel>
              <FormControl>
                <Input placeholder="Ej: AL30" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {hasMaturity && (
        <FormField
          control={form.control}
          name="maturityDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Vencimiento</FormLabel>
              <FormControl>
                <Input type="date" {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <FormField
        control={form.control}
        name="accountId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Cuenta contable *</FormLabel>
            <FormControl>
              <AccountCombobox
                accounts={catalogs?.accounts ?? []}
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? '')}
                placeholder="Cuenta de activo de la tenencia"
                clearLabel={null}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
