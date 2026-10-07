'use client';

import { useFormContext } from 'react-hook-form';

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

import {
  FUND_MOVEMENT_TYPE_LABELS,
  FUND_MOVEMENT_TYPES,
  type FundMovementFormInput,
} from '../../shared/validators';

interface FundMovementTypeFieldProps {
  /** Pasado al Root de Radix `Select` (un `<fieldset disabled>` no alcanza para Radix). */
  disabled?: boolean;
}

/** Selector del tipo de movimiento de fondos. */
export function _FundMovementTypeField({ disabled }: FundMovementTypeFieldProps) {
  const { control } = useFormContext<FundMovementFormInput>();

  return (
    <FormField
      control={control}
      name="type"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Tipo de movimiento *</FormLabel>
          <Select onValueChange={field.onChange} value={field.value} disabled={disabled}>
            <FormControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {FUND_MOVEMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {FUND_MOVEMENT_TYPE_LABELS[t]}
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
