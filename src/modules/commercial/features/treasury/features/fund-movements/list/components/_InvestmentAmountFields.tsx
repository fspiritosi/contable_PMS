'use client';

import { useFormContext } from 'react-hook-form';

import {
  FormControl,
  FormDescription,
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
 * Se muestra solo en tenencias con unidades: ahí la venta parcial exige los
 * nominales vendidos (ruling R8) y la venta total los vende todos, así que el
 * campo queda deshabilitado (y vacío) mientras esté marcada.
 */
export function _InvestmentAmountFields({ isSale }: Props) {
  const { control, getValues, setValue, watch } = useFormContext<FundMovementFormInput>();
  const allSold = isSale && Boolean(watch('isFullSale'));

  const recalc = () => {
    if (isSale) return;
    const amount = grossAmount(getValues('nominals'), getValues('unitPrice'));
    // Si falta nominales o precio, el importe calculado ya no vale: se limpia.
    setValue('amount', amount, { shouldValidate: Boolean(amount) });
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
              disabled={allSold}
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
          {allSold && (
            <FormDescription>Con venta total se venden todos los nominales.</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {quantity('nominals', isSale ? `Nominales vendidos${allSold ? '' : ' *'}` : 'Nominales')}
      {!isSale && quantity('unitPrice', 'Precio unitario')}
    </div>
  );
}
