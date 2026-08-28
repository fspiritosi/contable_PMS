'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { MoneyInput } from '@/shared/components/ui/money-input';
import { formatCurrency } from '@/shared/utils/formatters';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { AccountCombobox } from '@/shared/components/common/AccountCombobox';
import { Controller, useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { recurringEntrySchema, type RecurringEntryFormValues } from '../validators';
import { createRecurringEntry } from '../actions.server';
import moment from 'moment';

interface CreateRecurringEntryDialogProps {
  companyId: string;
  accounts: { id: string; code: string; name: string; type: string; nature: string }[];
  onClose: () => void;
}

const FREQUENCY_OPTIONS = [
  { value: 'MONTHLY', label: 'Mensual' },
  { value: 'BIMONTHLY', label: 'Bimestral' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'SEMIANNUAL', label: 'Semestral' },
  { value: 'ANNUAL', label: 'Anual' },
];

export function _CreateRecurringEntryDialog({
  companyId,
  accounts,
  onClose,
}: CreateRecurringEntryDialogProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<RecurringEntryFormValues>({
    resolver: zodResolver(recurringEntrySchema),
    defaultValues: {
      name: '',
      description: '',
      frequency: 'MONTHLY',
      startDate: new Date(),
      endDate: null,
      lines: [
        { accountId: '', description: '', debit: 0, credit: 0 },
        { accountId: '', description: '', debit: 0, credit: 0 },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'lines',
  });

  const handleSubmit = async (data: RecurringEntryFormValues) => {
    setIsLoading(true);
    try {
      await createRecurringEntry(companyId, data);
      toast.success('Asiento recurrente creado');
      router.refresh();
      onClose();
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Error al crear asiento recurrente');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const watchLines = form.watch('lines');
  const totalDebit = watchLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = watchLines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Asiento Recurrente</DialogTitle>
          <DialogDescription>
            Crea una plantilla que se generará automáticamente según la frecuencia seleccionada
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                {...form.register('name')}
                placeholder="Ej: Alquiler oficina"
                disabled={isLoading}
              />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="frequency">Frecuencia *</Label>
              <Select
                value={form.watch('frequency')}
                onValueChange={(v) => form.setValue('frequency', v as RecurringEntryFormValues['frequency'])}
                disabled={isLoading}
              >
                <SelectTrigger id="frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripción del asiento *</Label>
            <Input
              id="description"
              {...form.register('description')}
              placeholder="Descripción que tendrá el asiento generado"
              disabled={isLoading}
            />
            {form.formState.errors.description && (
              <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startDate">Fecha de inicio *</Label>
              <Input
                id="startDate"
                type="date"
                value={form.watch('startDate') ? moment(form.watch('startDate')).format('YYYY-MM-DD') : ''}
                onChange={(e) => form.setValue('startDate', new Date(e.target.value))}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Fecha de fin (opcional)</Label>
              <Input
                id="endDate"
                type="date"
                value={form.watch('endDate') ? moment(form.watch('endDate')).format('YYYY-MM-DD') : ''}
                onChange={(e) => form.setValue('endDate', e.target.value ? new Date(e.target.value) : null)}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Líneas del asiento */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Líneas del asiento</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ accountId: '', description: '', debit: 0, credit: 0 })}
                disabled={isLoading}
              >
                <Plus className="mr-1 h-3 w-3" />
                Agregar línea
              </Button>
            </div>

            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="py-2 pl-3 text-left">Cuenta</th>
                    <th className="py-2 text-left">Descripción</th>
                    <th className="py-2 text-right w-28">Debe</th>
                    <th className="py-2 text-right w-28">Haber</th>
                    <th className="py-2 pr-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, index) => (
                    <tr key={field.id} className="border-b">
                      <td className="py-1 pl-3">
                        <AccountCombobox
                          accounts={accounts}
                          value={form.watch(`lines.${index}.accountId`)}
                          onChange={(accountId) =>
                            form.setValue(`lines.${index}.accountId`, accountId ?? '', {
                              shouldValidate: true,
                            })
                          }
                          placeholder="Seleccionar..."
                          clearLabel={null}
                          disabled={isLoading}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="py-1">
                        <Input
                          {...form.register(`lines.${index}.description`)}
                          className="h-8 text-xs"
                          placeholder="Opcional"
                          disabled={isLoading}
                        />
                      </td>
                      <td className="py-1 px-1">
                        <Controller
                          control={form.control}
                          name={`lines.${index}.debit`}
                          render={({ field }) => (
                            <MoneyInput
                              className="h-8 text-xs text-right"
                              disabled={isLoading}
                              value={field.value ?? ''}
                              onChange={(raw) => field.onChange(raw === '' ? undefined : Number(raw))}
                              onBlur={field.onBlur}
                              name={field.name}
                              ref={field.ref}
                            />
                          )}
                        />
                      </td>
                      <td className="py-1 px-1">
                        <Controller
                          control={form.control}
                          name={`lines.${index}.credit`}
                          render={({ field }) => (
                            <MoneyInput
                              className="h-8 text-xs text-right"
                              disabled={isLoading}
                              value={field.value ?? ''}
                              onChange={(raw) => field.onChange(raw === '' ? undefined : Number(raw))}
                              onBlur={field.onBlur}
                              name={field.name}
                              ref={field.ref}
                            />
                          )}
                        />
                      </td>
                      <td className="py-1 pr-3">
                        {fields.length > 2 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => remove(index)}
                            disabled={isLoading}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/30 font-medium">
                    <td colSpan={2} className="py-2 pl-3 text-sm">Total</td>
                    <td className="py-2 px-1 text-right text-sm font-mono">
                      {formatCurrency(totalDebit)}
                    </td>
                    <td className="py-2 px-1 text-right text-sm font-mono">
                      {formatCurrency(totalCredit)}
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {!isBalanced && totalDebit + totalCredit > 0 && (
              <p className="text-xs text-destructive">
                El asiento no está balanceado. Diferencia: {formatCurrency(Math.abs(totalDebit - totalCredit))}
              </p>
            )}

            {form.formState.errors.lines?.root && (
              <p className="text-xs text-destructive">{form.formState.errors.lines.root.message}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || !isBalanced}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear Asiento Recurrente
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
