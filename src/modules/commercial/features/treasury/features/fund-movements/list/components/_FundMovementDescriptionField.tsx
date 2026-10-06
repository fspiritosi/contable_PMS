'use client';

import { useFormContext } from 'react-hook-form';

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Textarea } from '@/shared/components/ui/textarea';

import type { FundMovementFormInput } from '../../shared/validators';

/**
 * Descripción del movimiento. Sin `disabled`: el `<textarea>` es nativo y en
 * vista lo deshabilita el `<fieldset>` del modal.
 */
export function _FundMovementDescriptionField() {
  const { control } = useFormContext<FundMovementFormInput>();

  return (
    <FormField
      control={control}
      name="description"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Descripción *</FormLabel>
          <FormControl>
            <Textarea placeholder="Concepto del movimiento" rows={2} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
