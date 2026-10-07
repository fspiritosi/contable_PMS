'use client';

import { useFormContext } from 'react-hook-form';

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { MoneyInput } from '@/shared/components/ui/money-input';

import type { FundMovementFormInput } from '../../shared/validators';

interface FundMovementAmountDateFieldsProps {
  /** false en BANK_CHARGES: solo Fecha (el importe sale de la suma de los conceptos). */
  showAmount: boolean;
}

/**
 * Monto + Fecha del movimiento. No recibe `disabled`: `Input` y `MoneyInput`
 * son `<input>` nativos y en vista los deshabilita el `<fieldset>` del modal.
 */
export function _FundMovementAmountDateFields({ showAmount }: FundMovementAmountDateFieldsProps) {
  const { control } = useFormContext<FundMovementFormInput>();

  const dateField = (
    <FormField
      control={control}
      name="date"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Fecha *</FormLabel>
          <FormControl>
            <Input type="date" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  if (!showAmount) return dateField;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        control={control}
        name="amount"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Monto *</FormLabel>
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
            <FormMessage />
          </FormItem>
        )}
      />
      {dateField}
    </div>
  );
}
