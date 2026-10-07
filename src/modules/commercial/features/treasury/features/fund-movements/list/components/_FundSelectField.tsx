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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { FundMovementFormInput } from '../../shared/validators';
import {
  buildFundOptions,
  isSnapshotOption,
  withSnapshotOption,
  type FundSelectOption,
  type SnapshotOption,
} from '../../shared/view-mode';
import type { FundOption } from '../actions.server';

interface FundSelectFieldProps {
  name: 'sourceFund' | 'destinationFund';
  label: string;
  banks: FundOption[];
  cashRegisters: FundOption[];
  /** Pasado al Root de Radix `Select` (un `<fieldset disabled>` no alcanza para Radix). */
  disabled?: boolean;
  /** Solo en vista: `fundOutLabel` / `fundInLabel` guardado, por si el fondo ya no está en el catálogo. */
  snapshotLabel?: string | null;
}

type Option = FundSelectOption | SnapshotOption;

function renderItems(options: readonly Option[]) {
  return options.map((option) => (
    <SelectItem key={option.value} value={option.value}>
      {option.label}
    </SelectItem>
  ));
}

/** Selector de banco o caja (origen o destino del movimiento). */
export function _FundSelectField({
  name,
  label,
  banks,
  cashRegisters,
  disabled,
  snapshotLabel,
}: FundSelectFieldProps) {
  const { control } = useFormContext<FundMovementFormInput>();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const options = withSnapshotOption(
          buildFundOptions(banks, cashRegisters),
          field.value,
          snapshotLabel
        );
        const bankOptions = options.filter((o) => !isSnapshotOption(o) && o.group === 'BANK');
        const cashOptions = options.filter((o) => !isSnapshotOption(o) && o.group === 'CASH');
        const snapshotOptions = options.filter(isSnapshotOption);

        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value || undefined}
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar banco o caja" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {bankOptions.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Bancos</SelectLabel>
                    {renderItems(bankOptions)}
                  </SelectGroup>
                )}
                {cashOptions.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Cajas</SelectLabel>
                    {renderItems(cashOptions)}
                  </SelectGroup>
                )}
                {snapshotOptions.length > 0 && (
                  <SelectGroup>{renderItems(snapshotOptions)}</SelectGroup>
                )}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
