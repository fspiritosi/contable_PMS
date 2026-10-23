'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { MoneyInput } from '@/shared/components/ui/money-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { WITHHOLDING_TAX_TYPE_LABELS } from '../../../../shared/validators';
import type { ReceiptForm } from './receipt-form-utils';

export function _ReceiptWithholdingsCard({ form }: { form: ReceiptForm }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'withholdings' });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Retenciones Sufridas</CardTitle>
            <CardDescription>Retenciones aplicadas por el cliente</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              append({ taxType: 'IVA', rate: '', amount: '', certificateNumber: null })
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Agregar Retención
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.length === 0 && (
          <p className="py-2 text-center text-sm text-muted-foreground">Sin retenciones</p>
        )}

        {fields.map((field, index) => (
          <div key={field.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Retención {index + 1}</h4>
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <FormField
                control={form.control}
                name={`withholdings.${index}.taxType`}
                render={({ field: taxField }) => (
                  <FormItem>
                    <FormLabel>Tipo *</FormLabel>
                    <Select onValueChange={taxField.onChange} value={taxField.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(WITHHOLDING_TAX_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`withholdings.${index}.rate`}
                render={({ field: rateField }) => (
                  <FormItem>
                    <FormLabel>Alícuota %</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...rateField} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`withholdings.${index}.amount`}
                render={({ field: amountField }) => (
                  <FormItem>
                    <FormLabel>Monto *</FormLabel>
                    <FormControl>
                      <MoneyInput
                        placeholder="0,00"
                        value={amountField.value}
                        onChange={amountField.onChange}
                        onBlur={amountField.onBlur}
                        name={amountField.name}
                        ref={amountField.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`withholdings.${index}.certificateNumber`}
                render={({ field: certField }) => (
                  <FormItem>
                    <FormLabel>N° Certificado</FormLabel>
                    <FormControl>
                      <Input placeholder="Opcional" {...certField} value={certField.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
