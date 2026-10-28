'use client';

import { useEffect } from 'react';
import type { Control, UseFormSetValue, UseFormGetValues } from 'react-hook-form';

import { _NoConceptsNotice } from '@/shared/components/common/_NoConceptsNotice';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { CONCEPT_USAGE_LABELS, bankMovementUsage } from '@/shared/lib/concepts';
import type { BankMovementType } from '@/generated/prisma/enums';

import type { BankMovementFormData } from '../../../../shared/validators';

interface ConceptOption {
  id: string;
  name: string;
}

interface Props {
  control: Control<BankMovementFormData>;
  getValues: UseFormGetValues<BankMovementFormData>;
  setValue: UseFormSetValue<BankMovementFormData>;
  type: BankMovementType;
  /** Conceptos activos por tipo; `undefined` mientras carga. */
  options: ConceptOption[] | undefined;
}

/**
 * Combo "Concepto" del movimiento bancario manual (TSK-791). Muestra solo los
 * conceptos del tipo elegido y limpia el elegido si deja de aplicar al cambiar
 * el tipo. Sin conceptos para el tipo, avisa (el botón Registrar lo bloquea el
 * diálogo).
 */
export function _BankMovementConceptField({ control, getValues, setValue, type, options }: Props) {
  useEffect(() => {
    if (!options) return;
    const current = getValues('conceptId');
    if (current && !options.some((o) => o.id === current)) {
      setValue('conceptId', '', { shouldValidate: false });
    }
  }, [options, getValues, setValue]);

  if (options && options.length === 0) {
    return <_NoConceptsNotice usageLabel={CONCEPT_USAGE_LABELS[bankMovementUsage(type)]} />;
  }

  return (
    <FormField
      control={control}
      name="conceptId"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Concepto *</FormLabel>
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar concepto" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {(options ?? []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
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
