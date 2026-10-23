'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useWatch, type Control, type UseFormSetValue } from 'react-hook-form';

import { AccountCombobox } from '@/shared/components/common/AccountCombobox';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Label } from '@/shared/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/components/ui/radio-group';
import { PARTNER_USAGES } from '@/shared/lib/concepts/usages';
import { getConceptAccountOptions } from '../actions.server';
import type { ConceptFormData, ConceptFormInput } from '../shared/validators';

interface Props {
  control: Control<ConceptFormInput, unknown, ConceptFormData>;
  setValue: UseFormSetValue<ConceptFormInput>;
  /** Cuenta ya guardada (edición): se preserva en el combo aunque hoy no sea imputable. */
  savedAccountId?: string | null;
}

/** Modo de cuenta (solo si todos los usos son de socio) y combo de cuenta propia. */
export function _ConceptAccountField({ control, setValue, savedAccountId }: Props) {
  const usages = useWatch({ control, name: 'usages' });
  const accountMode = useWatch({ control, name: 'accountMode' });
  const accountId = useWatch({ control, name: 'accountId' });

  const partnerAllowed = usages.length > 0 && usages.every((u) => PARTNER_USAGES.includes(u));
  const isOwn = accountMode === 'OWN_ACCOUNT' || !partnerAllowed;

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['concept-accounts', [...usages].sort(), savedAccountId ?? null],
    queryFn: () => getConceptAccountOptions(usages, savedAccountId ? [savedAccountId] : undefined),
    enabled: usages.length > 0 && isOwn,
  });

  // Si el modo socio deja de estar permitido, vuelve a cuenta propia.
  useEffect(() => {
    if (!partnerAllowed && accountMode === 'PARTNER_ACCOUNT') {
      setValue('accountMode', 'OWN_ACCOUNT');
    }
  }, [partnerAllowed, accountMode, setValue]);

  // Si la cuenta elegida ya no está entre las opciones (cambiaron los usos), se limpia.
  useEffect(() => {
    if (isLoading || !accountId || !isOwn) return;
    if (!accounts.some((a) => a.id === accountId)) setValue('accountId', null);
  }, [accounts, accountId, isLoading, isOwn, setValue]);

  return (
    <div className="space-y-4">
      {partnerAllowed && (
        <FormField
          control={control}
          name="accountMode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>¿Qué cuenta usa?</FormLabel>
              <FormControl>
                <RadioGroup value={field.value} onValueChange={field.onChange}>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="PARTNER_ACCOUNT" id="concept-mode-partner" />
                    <Label htmlFor="concept-mode-partner">Mantener la cuenta del socio</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="OWN_ACCOUNT" id="concept-mode-own" />
                    <Label htmlFor="concept-mode-own">Usar otra cuenta</Label>
                  </div>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {isOwn && (
        <FormField
          control={control}
          name="accountId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cuenta contable</FormLabel>
              <FormControl>
                <AccountCombobox
                  accounts={accounts}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  placeholder={
                    usages.length === 0
                      ? 'Primero elegí los usos'
                      : isLoading
                        ? 'Cargando cuentas...'
                        : 'Seleccionar cuenta...'
                  }
                  clearLabel={null}
                  disabled={usages.length === 0 || isLoading}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
