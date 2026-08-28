'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';

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
  const total = totalPercentage(allocations);
  const amounts = prorateAmount(lineAmount, allocations);
  const isComplete = total === 100;

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
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2">
              <Select
                value={allocations[index]?.costCenterId ?? ''}
                onValueChange={(value) =>
                  setValue(`${name}.${index}.costCenterId`, value, {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger className="flex-1">
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
          ))}

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
        </>
      )}
    </div>
  );
}
