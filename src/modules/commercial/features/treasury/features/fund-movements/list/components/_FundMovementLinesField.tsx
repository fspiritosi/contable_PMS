'use client';

import { Plus, Trash2 } from 'lucide-react';
import { get, useFieldArray, useFormContext, useFormState, useWatch } from 'react-hook-form';

import { AccountCombobox, type AccountOption } from '@/shared/components/common/AccountCombobox';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { MoneyInput } from '@/shared/components/ui/money-input';
import { formatCurrency } from '@/shared/utils/formatters';

import {
  pickDefaultLineAccount,
  sumLines,
  type FundMovementLineInput,
} from '../../shared/lines-calc';
import type { FundMovementAccountRef } from '../actions.server';
import { _BankChargesDefaultNotice } from './_BankChargesDefaultNotice';

interface FundMovementLinesFieldProps {
  /** Cuentas imputables de tipo egreso o activo (ya filtradas por el servidor). */
  accounts: AccountOption[];
  /** "Gastos bancarios por defecto" de Ajustes contables; se preselecciona en cada concepto nuevo (TSK-718). */
  defaultAccount?: FundMovementAccountRef | null;
  /**
   * Modo vista (TSK-720a): sin "Agregar concepto", sin tachos, sin aviso de
   * cuenta por defecto y con el combobox deshabilitado; se mantiene el total.
   * Input y MoneyInput los deshabilita el `<fieldset disabled>` del modal.
   */
  readOnly?: boolean;
}

/**
 * Tabla de conceptos de un movimiento de gastos e impuestos bancarios
 * (TSK-585): comisión, IVA, Sircreb, impuesto al cheque, etc. Cada concepto
 * lleva su propia cuenta contable, así el asiento sale con un débito por
 * concepto y no un único gasto genérico.
 *
 * Sigue el patrón de `_CostCenterAllocationField` (TSK-583): `useFieldArray`
 * sobre el campo del formulario y el error de "el campo no cumple" leído a
 * mano, porque `validateLines` (Zod `superRefine`) adjunta el error a la raíz
 * de cada línea (`lines.<index>`), no a un subcampo puntual, así que el
 * `<FormMessage>` genérico no lo encuentra.
 */
export function _FundMovementLinesField({
  accounts,
  defaultAccount = null,
  readOnly = false,
}: FundMovementLinesFieldProps) {
  const { control, register, setValue } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  // '' si no hay cuenta por defecto o si ya no está entre las imputables
  // (riesgo 1.6-6). Solo aplica al `append`: el `reset` del modal en edición
  // sigue cargando las cuentas guardadas del borrador.
  const defaultAccountId = pickDefaultLineAccount(defaultAccount?.id, accounts);

  const lines = (useWatch({ control, name: 'lines' }) ?? []) as FundMovementLineInput[];
  const total = sumLines(lines);

  const { errors } = useFormState({ control, name: 'lines' });
  const lineErrors = get(errors, 'lines') as
    | (Record<number, { message?: string }> & { message?: string })
    | undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Conceptos{readOnly ? '' : ' *'}</span>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => append({ accountId: defaultAccountId, description: '', amount: '' })}
          >
            <Plus className="mr-1 h-4 w-4" />
            Agregar concepto
          </Button>
        )}
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {readOnly ? 'Sin conceptos cargados' : 'Agregá al menos un concepto'}
        </p>
      ) : (
        <>
          {fields.map((field, index) => {
            const lineError = lineErrors?.[index]?.message;

            return (
              <div key={field.id} className="space-y-1">
                <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                  <AccountCombobox
                    accounts={accounts}
                    value={lines[index]?.accountId || null}
                    onChange={(accountId) =>
                      setValue(`lines.${index}.accountId`, accountId ?? '', {
                        shouldValidate: true,
                      })
                    }
                    clearLabel={null}
                    disabled={readOnly}
                    placeholder="Cuenta contable"
                    className="min-w-0 basis-full sm:basis-auto sm:flex-1"
                    aria-invalid={Boolean(lineError)}
                  />

                  <Input
                    placeholder="Descripción"
                    className="min-w-0 flex-1"
                    aria-invalid={Boolean(lineError)}
                    {...register(`lines.${index}.description`)}
                  />

                  <MoneyInput
                    placeholder="0,00"
                    className="w-32 shrink-0 sm:w-36"
                    aria-invalid={Boolean(lineError)}
                    value={lines[index]?.amount ?? ''}
                    onChange={(value) =>
                      setValue(`lines.${index}.amount`, value, { shouldValidate: true })
                    }
                  />

                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {lineError && <p className="text-sm text-destructive">{lineError}</p>}
              </div>
            );
          })}

          <div className="flex items-center justify-between border-t pt-2">
            <span className="text-sm font-medium">Total {formatCurrency(total)}</span>
          </div>
        </>
      )}

      {/* Siempre visible en alta/edición (con y sin conceptos) para que se lea antes del primer
          "Agregar concepto". En vista se oculta: habla de conceptos nuevos (TSK-720a). */}
      {!readOnly && (
        <_BankChargesDefaultNotice
          defaultAccount={defaultAccount}
          available={defaultAccountId !== ''}
        />
      )}
    </div>
  );
}
