'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Controller, get, useFieldArray, useFormContext, useFormState, useWatch } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { MoneyInput } from '@/shared/components/ui/money-input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { cn } from '@/shared/lib/utils';
import { formatCurrency } from '@/shared/utils/formatters';

import {
  PERCEPTION_TYPES,
  PERCEPTION_TYPE_LABELS,
  calculateOtherTaxes,
  derivePerceptionRate,
  type PerceptionInput,
} from '../perceptions';

interface PerceptionsFieldProps {
  /** Ruta del array dentro del formulario, normalmente `perceptions`. */
  name: string;
  /** Ruta del monto de impuestos internos, normalmente `internalTaxes`. */
  internalTaxesName: string;
  /**
   * Neto gravado del comprobante. Se ofrece como base sugerida al agregar una
   * percepción; el usuario la edita si su régimen calcula sobre otra base.
   */
  suggestedBase: number;
  /** Solo lectura: la factura ya no admite cambios (confirmada, anulada). */
  disabled?: boolean;
}

/** Una fila de percepción. Extraída para que el campo entre en el límite de
 *  200 líneas por componente que fija el CLAUDE.md. */
function _PerceptionRow({
  name,
  index,
  perception,
  errors,
  disabled,
  onRemove,
}: {
  name: string;
  index: number;
  perception: PerceptionInput | undefined;
  errors?: {
    baseAmount?: { message?: string };
    amount?: { message?: string };
  };
  disabled: boolean;
  onRemove: () => void;
}) {
  const { register, setValue } = useFormContext();

  const rate = derivePerceptionRate(
    parseFloat(perception?.baseAmount ?? ''),
    parseFloat(perception?.amount ?? '')
  );

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_5rem_2.5rem] md:items-center">
            <div className="space-y-1">
              <Label className="md:hidden">Tipo</Label>
              <Select
                value={perception?.type ?? 'IIBB'}
                disabled={disabled}
                onValueChange={(value) =>
                  setValue(`${name}.${index}.type`, value, {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {PERCEPTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {PERCEPTION_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="md:hidden">Jurisdicción</Label>
              <Input
                placeholder="Ej: NQN"
                disabled={disabled}
                {...register(`${name}.${index}.jurisdiction`)}
              />
            </div>

            <div className="space-y-1">
              <Label className="md:hidden">Base imponible</Label>
              <Controller
                name={`${name}.${index}.baseAmount`}
                render={({ field }) => (
                  <MoneyInput
                    {...field}
                    placeholder="0,00"
                    className={cn(
                      'text-right',
                      errors?.baseAmount && 'border-destructive'
                    )}
                    disabled={disabled}
                  />
                )}
              />
            </div>

            <div className="space-y-1">
              <Label className="md:hidden">Monto</Label>
              <Controller
                name={`${name}.${index}.amount`}
                render={({ field }) => (
                  <MoneyInput
                    {...field}
                    placeholder="0,00"
                    className={cn(
                      'text-right',
                      errors?.amount && 'border-destructive'
                    )}
                    disabled={disabled}
                  />
                )}
              />
            </div>

            <span className="text-right text-sm tabular-nums text-muted-foreground">
              {rate.toFixed(3).replace('.', ',')}%
            </span>

            {!disabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Eliminar percepción"
                onClick={() => onRemove()}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

      {(errors?.baseAmount || errors?.amount) && (
        <p className="text-sm text-destructive">
          {errors?.baseAmount?.message ?? errors?.amount?.message}
        </p>
      )}
    </div>
  );
}

/**
 * Percepciones e impuestos internos del comprobante (TSK-644).
 *
 * La alícuota no se pide: se deriva de base y monto. La factura del proveedor
 * trae el importe, y pedir además la tasa invita a que los dos datos se
 * contradigan. Se muestra calculada para que el usuario pueda contrastarla
 * contra el comprobante.
 */
export function _PerceptionsField({
  name,
  internalTaxesName,
  suggestedBase,
  disabled = false,
}: PerceptionsFieldProps) {
  const { control } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name });

  const perceptions = (useWatch({ control, name }) ?? []) as PerceptionInput[];
  const internalTaxes = useWatch({ control, name: internalTaxesName }) as
    | string
    | undefined;

  const otherTaxes = calculateOtherTaxes(perceptions, internalTaxes);

  const { errors } = useFormState({ control });
  const fieldErrors = get(errors, name) as
    | Record<
        number,
        {
          type?: { message?: string };
          baseAmount?: { message?: string };
          amount?: { message?: string };
        }
      >
    | undefined;
  const internalTaxesError = (get(errors, internalTaxesName) as
    | { message?: string }
    | undefined)?.message;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Percepciones e impuestos internos</h3>
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              append({
                type: 'IIBB',
                jurisdiction: '',
                baseAmount: suggestedBase > 0 ? suggestedBase.toFixed(2) : '',
                amount: '',
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            Agregar percepción
          </Button>
        )}
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin percepciones. Agregá una si el comprobante del proveedor las discrimina.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Encabezados solo en pantallas anchas: en móvil cada campo lleva su label. */}
          <div className="hidden gap-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_5rem_2.5rem]">
            <span>Tipo</span>
            <span>Jurisdicción</span>
            <span className="text-right">Base imponible</span>
            <span className="text-right">Monto</span>
            <span className="text-right">Alícuota</span>
            <span />
          </div>

          {fields.map((field, index) => (
            <_PerceptionRow
              key={field.id}
              name={name}
              index={index}
              perception={perceptions[index]}
              errors={fieldErrors?.[index]}
              disabled={disabled}
              onRemove={() => remove(index)}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 border-t pt-4 md:grid-cols-2 md:items-center">
        <Label htmlFor="internal-taxes">Impuestos internos</Label>
        <Controller
          name={internalTaxesName}
          render={({ field }) => (
            <MoneyInput
              {...field}
              id="internal-taxes"
              placeholder="0,00"
              className={cn('text-right', internalTaxesError && 'border-destructive')}
              disabled={disabled}
            />
          )}
        />
        {internalTaxesError && (
          <p className="text-sm text-destructive md:col-span-2">{internalTaxesError}</p>
        )}
      </div>

      {otherTaxes > 0 && (
        <div className="flex justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">Total otros tributos</span>
          <span className="font-mono">{formatCurrency(otherTaxes)}</span>
        </div>
      )}
    </div>
  );
}
