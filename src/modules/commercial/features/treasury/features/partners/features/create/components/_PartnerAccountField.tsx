'use client';

import { useQuery } from '@tanstack/react-query';
import type { Control } from 'react-hook-form';

import { AccountCombobox } from '@/shared/components/common/AccountCombobox';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import type { PartnerFormData, PartnerFormInput } from '../../../shared/validators';
import { getPartnerContributionAccounts } from '../../list/actions.server';

interface PartnerAccountFieldProps {
  control: Control<PartnerFormInput, unknown, PartnerFormData>;
  /** Cuenta ya guardada (edición): se preserva en el combo aunque hoy no sea imputable. */
  savedAccountId?: string | null;
}

/**
 * Selector de la cuenta contable de aportes del socio (TSK-717). Va separado
 * de `_PartnerForm` para que ese archivo no pase las 200 líneas.
 */
export function _PartnerAccountField({ control, savedAccountId }: PartnerAccountFieldProps) {
  // Patrón de `_BankAccountFormModal`. La key incluye `savedAccountId`
  // para que el `includeIds` no se comparta entre socios distintos.
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['partner-contribution-accounts', savedAccountId ?? null],
    queryFn: () => getPartnerContributionAccounts(savedAccountId ? [savedAccountId] : undefined),
  });

  return (
    <FormField
      control={control}
      name="contributionsAccountId"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Cuenta contable de aportes (opcional)</FormLabel>
          <FormControl>
            <AccountCombobox
              accounts={accounts}
              value={field.value ?? null}
              onChange={field.onChange}
              placeholder={isLoading ? 'Cargando cuentas...' : 'Sin asignar'}
              clearLabel="Sin asignar (usar la cuenta por defecto)"
              disabled={isLoading}
            />
          </FormControl>
          <FormDescription>
            Cuenta a la que se imputan los aportes y retiros de este socio. Puede ser de Activo,
            Pasivo o Patrimonio Neto, según el criterio de tu contador. Si no se asigna, se usa la
            cuenta de aportes por defecto de Ajustes contables. Cambiarla no modifica los asientos
            ya generados.
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
