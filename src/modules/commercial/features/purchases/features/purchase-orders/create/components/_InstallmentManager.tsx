'use client';

import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { Button } from '@/shared/components/ui/button';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Input } from '@/shared/components/ui/input';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatCurrency } from '@/shared/utils/formatters';
import { businessToday } from '@/shared/utils/date-input';
import {
  INSTALLMENT_FREQUENCIES,
  type InstallmentFrequency,
  type PurchaseOrderFormInput,
} from '../../shared/validators';
import { useState } from 'react';
import moment from 'moment';

interface InstallmentManagerProps {
  form: UseFormReturn<PurchaseOrderFormInput>;
  orderTotal: number;
}

export function _InstallmentManager({ form, orderTotal }: InstallmentManagerProps) {
  const [genCount, setGenCount] = useState(3);
  const [genStartDate, setGenStartDate] = useState('');
  const [genFrequency, setGenFrequency] = useState<InstallmentFrequency>('monthly');

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: 'installments',
  });

  const installments = useWatch({ control: form.control, name: 'installments' });

  const installmentSum = (installments || []).reduce((acc, inst) => {
    const amount = parseFloat(inst?.amount ?? '0');
    return acc + (isNaN(amount) ? 0 : amount);
  }, 0);

  const roundedSum = Math.round(installmentSum * 100) / 100;
  const roundedTotal = Math.round(orderTotal * 100) / 100;
  const isBalanced = roundedSum === roundedTotal;

  const handleGenerate = () => {
    if (!genStartDate || genCount < 2 || orderTotal <= 0) return;

    const baseAmount = Math.floor((orderTotal / genCount) * 100) / 100;
    const lastAmount = Math.round((orderTotal - baseAmount * (genCount - 1)) * 100) / 100;

    const newInstallments = Array.from({ length: genCount }, (_, i) => {
      const date = moment(genStartDate);
      if (genFrequency === 'monthly') date.add(i, 'months');
      else if (genFrequency === 'biweekly') date.add(i * 2, 'weeks');
      else date.add(i, 'weeks');

      return {
        dueDate: date.toDate(),
        amount: (i === genCount - 1 ? lastAmount : baseAmount).toString(),
        notes: null as string | null,
      };
    });

    replace(newInstallments);
  };

  return (
    <div className="space-y-4">
      {/* Generador automático */}
      <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
        <h3 className="text-sm font-medium">Generar cuotas automáticamente</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-sm text-muted-foreground">Cantidad</label>
            <Input
              type="number"
              min={2}
              max={36}
              value={genCount}
              onChange={(e) => setGenCount(parseInt(e.target.value) || 2)}
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Fecha primera cuota</label>
            <Input
              type="date"
              value={genStartDate}
              onChange={(e) => setGenStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Frecuencia</label>
            <Select value={genFrequency} onValueChange={(v) => setGenFrequency(v as InstallmentFrequency)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INSTALLMENT_FREQUENCIES).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleGenerate}
            disabled={!genStartDate || genCount < 2 || orderTotal <= 0}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            Generar
          </Button>
        </div>
      </div>

      {/* Lista de cuotas */}
      {fields.length > 0 && (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-[40px_1fr_1fr_32px] gap-2 items-end">
              <div className="text-sm font-mono text-muted-foreground pt-6 text-center">
                #{index + 1}
              </div>

              <FormField
                control={form.control}
                name={`installments.${index}.dueDate`}
                render={({ field: dateField }) => (
                  <FormItem>
                    {index === 0 && <FormLabel>Fecha Vencimiento</FormLabel>}
                    <FormControl>
                      <Input
                        type="date"
                        value={dateField.value ? moment(dateField.value).format('YYYY-MM-DD') : ''}
                        onChange={(e) => dateField.onChange(e.target.value ? new Date(e.target.value + 'T12:00:00') : null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`installments.${index}.amount`}
                render={({ field: amountField }) => (
                  <FormItem>
                    {index === 0 && <FormLabel>Monto</FormLabel>}
                    <FormControl>
                      <Input placeholder="0.00" {...amountField} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(index)}
                className="text-destructive hover:text-destructive h-9 w-8"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Agregar cuota manual */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ dueDate: businessToday(), amount: '0', notes: null })}
      >
        <Plus className="mr-2 h-4 w-4" />
        Agregar cuota
      </Button>

      {/* Resumen */}
      {fields.length > 0 && (
        <div className={cn(
          'flex justify-between items-center p-3 rounded-lg text-sm font-mono',
          isBalanced ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400' : 'bg-destructive/10 text-destructive'
        )}>
          <span>Total cuotas: {formatCurrency(roundedSum)}</span>
          <span>Total orden: {formatCurrency(roundedTotal)}</span>
          <span>{isBalanced ? 'Balanceado' : `Diferencia: ${formatCurrency(roundedSum - roundedTotal)}`}</span>
        </div>
      )}

      {form.formState.errors.installments?.message && (
        <p className="text-sm text-destructive">{form.formState.errors.installments.message}</p>
      )}
    </div>
  );
}
