'use client';

import { useFormContext } from 'react-hook-form';

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { MoneyInput } from '@/shared/components/ui/money-input';

import type { FundMovementFormInput } from '../../shared/validators';

/** Importe bruto de una compra: nominales × precio, redondeado a centavos. */
export function grossAmount(nominals: string | undefined, unitPrice: string | undefined): string {
  const n = Number(nominals);
  const p = Number(unitPrice);
  if (!(n > 0) || !(p > 0)) return '';
  return String(Math.round((n * p + Number.EPSILON) * 100) / 100);
}

interface Props {
  isSale: boolean;
}

/**
 * Nominales y precio de una compra, o nominales vendidos en una venta. En la
 * compra el importe se calcula (queda solo lectura); en la venta se carga el bruto.
 */
export function _InvestmentAmountFields({ isSale }: Props) {
  const { control, getValues, setValue } = useFormContext<FundMovementFormInput>();

  const recalc = () => {
    if (isSale) return;
    const amount = grossAmount(getValues('nominals'), getValues('unitPrice'));
    if (amount) setValue('amount', amount, { shouldValidate: true });
  };

  const quantity = (name: 'nominals' | 'unitPrice', label: string) => (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <MoneyInput
              placeholder="0"
              maxDecimals={6}
              value={field.value ?? ''}
              onChange={(v) => {
                field.onChange(v);
                recalc();
              }}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {quantity('nominals', isSale ? 'Nominales vendidos' : 'Nominales')}
      {!isSale && quantity('unitPrice', 'Precio unitario')}
    </div>
  );
}
