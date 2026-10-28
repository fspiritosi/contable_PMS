'use client';

import { useFormContext } from 'react-hook-form';

import { Checkbox } from '@/shared/components/ui/checkbox';
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

interface Props {
  isSale: boolean;
}

/** Comisión opcional (gasto aparte) y, en la venta, la marca de venta total. */
export function _InvestmentCommissionFields({ isSale }: Props) {
  const { control, setValue } = useFormContext<FundMovementFormInput>();

  return (
    <>
      <FormField
        control={control}
        name="commission"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Comisión</FormLabel>
            <FormControl>
              <MoneyInput
                placeholder="0,00"
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            </FormControl>
            <FormDescription>
              {isSale
                ? 'Opcional. Se descuenta de lo que entra a la cuenta y va a gastos.'
                : 'Opcional. Sale de la cuenta además del importe y va a gastos.'}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      {isSale && (
        <FormField
          control={control}
          name="isFullSale"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-2 space-y-0">
              <FormControl>
                <Checkbox
                  checked={Boolean(field.value)}
                  onCheckedChange={(checked) => {
                    field.onChange(checked);
                    // La venta total vende todos los nominales: los cargados no se usan.
                    if (checked) setValue('nominals', '');
                  }}
                />
              </FormControl>
              <FormLabel className="font-normal">Venta total (cierra la tenencia)</FormLabel>
            </FormItem>
          )}
        />
      )}
    </>
  );
}
