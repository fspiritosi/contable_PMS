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
import { withSnapshotOption } from '../../shared/view-mode';
import type { FundMovementPartnerOption } from '../actions.server';

interface PartnerSelectFieldProps {
  partners: FundMovementPartnerOption[];
  /** Pasado al Root de Radix `Select` (un `<fieldset disabled>` no alcanza para Radix). */
  disabled?: boolean;
  /** Solo en vista: `partnerName` guardado, por si el socio ya no está en el catálogo. */
  snapshotLabel?: string | null;
}

/** Selector del socio de un aporte o retiro. */
export function _PartnerSelectField({ partners, disabled, snapshotLabel }: PartnerSelectFieldProps) {
  const { control } = useFormContext<FundMovementFormInput>();

  return (
    <FormField
      control={control}
      name="partnerId"
      render={({ field }) => {
        const options = withSnapshotOption(
          partners.map((p) => ({ value: p.id, label: p.name })),
          field.value,
          snapshotLabel
        );

        return (
          <FormItem>
            <FormLabel>Socio *</FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value || undefined}
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar socio" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
