'use client';

import { Trash2 } from 'lucide-react';
import { useWatch, type Control } from 'react-hook-form';

import { CONVENIO_MULTILATERAL_CODES, jurisdictionLabel } from '@/modules/commercial/shared/convenio-multilateral';
import { Button } from '@/shared/components/ui/button';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { MoneyInput } from '@/shared/components/ui/money-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';

import { type CreatePaymentOrderFormData, WITHHOLDING_TAX_TYPE_LABELS } from '../../../../shared/validators';

interface PaymentOrderWithholdingFieldsProps {
  control: Control<CreatePaymentOrderFormData>;
  index: number;
  onRemove: () => void;
}

/**
 * Una retención practicada en la orden de pago. Régimen, base imponible y jurisdicción (TSK-813)
 * son los datos que piden SIRE, SICORE y SIRCAR en Contabilidad → Archivos ARCA.
 */
export function _PaymentOrderWithholdingFields({ control, index, onRemove }: PaymentOrderWithholdingFieldsProps) {
  const taxType = useWatch({ control, name: `withholdings.${index}.taxType` });
  const name = <K extends keyof CreatePaymentOrderFormData['withholdings'][number]>(key: K) =>
    `withholdings.${index}.${key}` as const;

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Retención {index + 1}</span>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FormField
          control={control}
          name={name('taxType')}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Tipo *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(WITHHOLDING_TAX_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={name('rate')}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Alícuota %</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" placeholder="0.00" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={name('amount')}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Monto *</FormLabel>
              <FormControl>
                <MoneyInput
                  placeholder="0,00"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={name('certificateNumber')}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">N° Certificado</FormLabel>
              <FormControl>
                <Input placeholder="Opcional" {...field} value={field.value || ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={name('regimeCode')}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Régimen</FormLabel>
              <FormControl>
                <Input inputMode="numeric" maxLength={3} placeholder="Ej: 078" {...field} value={field.value || ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={name('taxableBase')}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Base imponible</FormLabel>
              <FormControl>
                <MoneyInput
                  placeholder="0,00"
                  value={field.value || ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {taxType === 'IIBB' && (
          <FormField
            control={control}
            name={name('jurisdiction')}
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel className="text-xs">Jurisdicción</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || undefined}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccioná la provincia" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {CONVENIO_MULTILATERAL_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code} · {jurisdictionLabel(code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Régimen y base imponible los piden los archivos de SIRE, SICORE y SIRCAR
        {taxType === 'IIBB' ? '; para SIRCAR también la jurisdicción' : ''}.
      </p>
    </div>
  );
}
