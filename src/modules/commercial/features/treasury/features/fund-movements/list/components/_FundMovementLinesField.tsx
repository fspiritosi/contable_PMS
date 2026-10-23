'use client';

import { Plus, Trash2 } from 'lucide-react';
import { get, useFieldArray, useFormContext, useFormState, useWatch } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { MoneyInput } from '@/shared/components/ui/money-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { formatCurrency } from '@/shared/utils/formatters';

import { sumLines, type FundMovementLineInput } from '../../shared/lines-calc';
import { withSnapshotOption } from '../../shared/view-mode';
import type { FundMovementConceptOption } from '../actions.server';

interface FundMovementLinesFieldProps {
  /** Conceptos activos de "Gastos e impuestos bancarios" (nunca traen datos de cuenta). */
  concepts: FundMovementConceptOption[];
  /**
   * Solo en vista: nombre guardado de cada concepto (`conceptName`), por si
   * Contabilidad lo desactivó después de confirmar el movimiento.
   */
  conceptNames?: Record<string, string>;
  /**
   * Modo vista (TSK-720a): sin "Agregar concepto", sin tachos y con el select
   * deshabilitado; se mantiene el total. Input y MoneyInput los deshabilita el
   * `<fieldset disabled>` del modal.
   */
  readOnly?: boolean;
}

/**
 * Tabla de conceptos de un movimiento de gastos e impuestos bancarios
 * (TSK-585): comisión, IVA, Sircreb, impuesto al cheque, etc. Cada línea
 * elige un concepto (la cuenta contable la resuelve el servidor, Gestión no la
 * ve), así el asiento sale con un débito por concepto (TSK-791).
 *
 * Sigue el patrón de `_CostCenterAllocationField` (TSK-583): `useFieldArray`
 * sobre el campo del formulario y el error de "el campo no cumple" leído a
 * mano, porque `validateLines` (Zod `superRefine`) adjunta el error a la raíz
 * de cada línea (`lines.<index>`), no a un subcampo puntual, así que el
 * `<FormMessage>` genérico no lo encuentra.
 */
export function _FundMovementLinesField({
  concepts,
  conceptNames,
  readOnly = false,
}: FundMovementLinesFieldProps) {
  const { control, register, setValue } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

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
            onClick={() => append({ conceptId: '', description: '', amount: '' })}
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
            const conceptId = lines[index]?.conceptId ?? '';
            // En vista, un concepto ya desactivado se muestra con su nombre guardado.
            const options = withSnapshotOption(
              concepts.map((c) => ({ value: c.id, label: c.name })),
              conceptId,
              conceptNames?.[conceptId]
            );

            return (
              <div key={field.id} className="space-y-1">
                <div className="flex flex-wrap items-start gap-2">
                  <Select
                    value={options.some((o) => o.value === conceptId) ? conceptId : undefined}
                    onValueChange={(value) =>
                      setValue(`lines.${index}.conceptId`, value, { shouldValidate: true })
                    }
                    disabled={readOnly}
                  >
                    <SelectTrigger
                      className="w-full min-w-0 basis-full"
                      aria-invalid={Boolean(lineError)}
                    >
                      <SelectValue placeholder="Concepto" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    placeholder="Detalle (opcional)"
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
    </div>
  );
}
