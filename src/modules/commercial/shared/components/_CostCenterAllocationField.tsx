'use client';

import { Plus, Trash2 } from 'lucide-react';
import { get, useFieldArray, useFormContext, useFormState, useWatch } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { cn } from '@/shared/lib/utils';
import { formatCurrency } from '@/shared/utils/formatters';

import { prorateAmount, totalPercentage, type CostCenterAllocation } from '../cost-center';

export interface CostCenterOption {
  id: string;
  name: string;
}

interface CostCenterAllocationFieldProps {
  /** Ruta del array dentro del formulario, ej: `lines.0.costCenterAllocations`. */
  name: string;
  /** Neto de la línea, para mostrar cuánto se lleva cada centro. */
  lineAmount: number;
  costCenters: CostCenterOption[];
  /** Copia este reparto al resto de las líneas. Si no viene, no se ofrece. */
  onApplyToAll?: () => void;
}

/**
 * Reparto de una línea entre varios centros de costo (TSK-583).
 *
 * Con un solo centro al 100% se ve casi igual que el selector anterior: el caso
 * simple no se complica por soportar el repartido.
 */
export function _CostCenterAllocationField({
  name,
  lineAmount,
  costCenters,
  onApplyToAll,
}: CostCenterAllocationFieldProps) {
  const { control, register, setValue } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name });

  const allocations = (useWatch({ control, name }) ?? []) as CostCenterAllocation[];

  // Un porcentaje vacío registra `NaN` (por `valueAsNumber: true`), y `NaN`
  // se propaga a la suma y al prorrateo pintando "$ NaN" / "Total NaN%" en
  // pantalla (TSK-583, hallazgo de revisión final). Solo se sanea para estos
  // cálculos de pantalla: el valor real del formulario sigue siendo `NaN`,
  // así que la validación de Zod lo sigue rechazando igual.
  const safeAllocations = allocations.map((a) => ({
    ...a,
    percentage: Number.isFinite(a.percentage) ? a.percentage : 0,
  }));
  const total = totalPercentage(safeAllocations);
  const amounts = prorateAmount(lineAmount, safeAllocations);
  const isComplete = total === 100;

  // Errores del reparto (TSK-583, hallazgo de revisión final).
  //
  // `allocationFieldSchema.superRefine` adjunta el error de "no suma 100" a
  // la raíz del array (`errors...costCenterAllocations.root`), no a un
  // índice puntual, así que el `<FormMessage>` genérico de shadcn no lo
  // encuentra (busca `error.message` en la raíz, no en `.root.message`).
  // Sin leer esto a mano, el usuario hacía clic en Guardar y no pasaba
  // nada: ni el campo en rojo, ni ningún aviso.
  const { errors } = useFormState({ control, name });
  const fieldErrors = get(errors, name) as
    | (Record<number, { costCenterId?: { message?: string } }> & {
        root?: { message?: string };
      })
    | undefined;
  const rootError = fieldErrors?.root?.message;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Centros de costo</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => append({ costCenterId: '', percentage: fields.length === 0 ? 100 : 0 })}
        >
          <Plus className="mr-1 h-4 w-4" />
          Agregar centro
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin reparto — se usa el centro predeterminado del ítem
        </p>
      ) : (
        <>
          {fields.map((field, index) => {
            const costCenterError = fieldErrors?.[index]?.costCenterId?.message;

            return (
              <div key={field.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Select
                    value={allocations[index]?.costCenterId ?? ''}
                    onValueChange={(value) =>
                      setValue(`${name}.${index}.costCenterId`, value, {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger className={cn('flex-1', costCenterError && 'border-destructive')}>
                      <SelectValue placeholder="Elegí un centro de costo" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-[250px]">
                      {costCenters.map((costCenter) => (
                        <SelectItem key={costCenter.id} value={costCenter.id}>
                          {costCenter.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className="w-24 text-right"
                    {...register(`${name}.${index}.percentage`, { valueAsNumber: true })}
                  />
                  <span className="text-sm text-muted-foreground">%</span>

                  <span className="w-32 text-right text-sm tabular-nums">
                    {formatCurrency(amounts[index]?.amount ?? 0)}
                  </span>

                  <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {costCenterError && <p className="text-sm text-destructive">{costCenterError}</p>}
              </div>
            );
          })}

          <div className="flex items-center justify-between border-t pt-2">
            <span
              className={cn(
                'text-sm font-medium',
                isComplete ? 'text-green-600' : 'text-destructive'
              )}
            >
              Total {total.toFixed(2).replace('.', ',')}% · {formatCurrency(lineAmount)}
            </span>

            {onApplyToAll && isComplete && (
              <Button type="button" variant="outline" size="sm" onClick={onApplyToAll}>
                Aplicar a todas las líneas
              </Button>
            )}
          </div>
          {rootError && <p className="text-sm text-destructive">{rootError}</p>}
        </>
      )}
    </div>
  );
}
