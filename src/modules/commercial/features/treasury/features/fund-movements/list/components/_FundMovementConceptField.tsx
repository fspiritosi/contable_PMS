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

import type { FundMovementFormInput } from '../../shared/validators';
import type { FundMovementConceptOption } from '../actions.server';

interface FundMovementConceptFieldProps {
  /** Conceptos activos del tipo (Aporte o Retiro). */
  concepts: FundMovementConceptOption[];
  /** Pasado al Root de Radix `Select` (un `<fieldset disabled>` no alcanza para Radix). */
  disabled?: boolean;
}

/**
 * Concepto único de un aporte o retiro de socio (TSK-791). El padre lo monta
 * solo si hay conceptos activos para el tipo. Un concepto guardado que ya no
 * está activo no se ofrece: el select queda vacío y obliga a elegir otro.
 */
export function _FundMovementConceptField({ concepts, disabled }: FundMovementConceptFieldProps) {
  const { control } = useFormContext<FundMovementFormInput>();

  return (
    <FormField
      control={control}
      name="conceptId"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Concepto *</FormLabel>
          <Select
            onValueChange={field.onChange}
            value={concepts.some((c) => c.id === field.value) ? field.value : undefined}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar concepto" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {concepts.map((concept) => (
                <SelectItem key={concept.id} value={concept.id}>
                  {concept.name}
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
