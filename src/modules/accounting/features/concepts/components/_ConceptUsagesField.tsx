'use client';

import type { Control } from 'react-hook-form';

import type { ConceptUsage } from '@/generated/prisma/enums';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { CONCEPT_USAGE_GROUPS, CONCEPT_USAGE_LABELS } from '@/shared/lib/concepts/usages';
import type { ConceptFormData, ConceptFormInput } from '../shared/validators';

interface Props {
  control: Control<ConceptFormInput, unknown, ConceptFormData>;
}

/** Checkboxes de usos agrupados por familia (movimientos de fondo / bancarios). */
export function _ConceptUsagesField({ control }: Props) {
  return (
    <FormField
      control={control}
      name="usages"
      render={({ field }) => {
        const toggle = (usage: ConceptUsage, checked: boolean) =>
          field.onChange(
            checked ? [...field.value, usage] : field.value.filter((u) => u !== usage)
          );
        return (
          <FormItem>
            <FormLabel>¿Dónde se puede elegir este concepto?</FormLabel>
            <div className="space-y-3">
              {CONCEPT_USAGE_GROUPS.map((group) => (
                <fieldset key={group.label} className="space-y-2">
                  <legend className="text-sm font-medium text-muted-foreground">
                    {group.label}
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.usages.map((usage) => (
                      <label key={usage} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={field.value.includes(usage)}
                          onCheckedChange={(checked) => toggle(usage, checked === true)}
                        />
                        {CONCEPT_USAGE_LABELS[usage]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <FormDescription>
              Un concepto con varios usos solo admite cuentas de un tipo válido para todos ellos.
            </FormDescription>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
