'use client';

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';

import { journalEntrySchema, type CreateJournalEntryInput } from '../../../shared/types';
import { createJournalEntry } from '../actions.server';
import { getImputableAccounts } from '../../accounts/actions.server';
import { useState, useEffect } from 'react';
import { formatAmount } from '../../../shared/utils';

interface CreateEntryModalProps {
  onClose: () => void;
}

export function _CreateEntryModal({ onClose }: CreateEntryModalProps) {
  const [companyId, setCompanyId] = useState<string>();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [accounts, setAccounts] = useState<Array<{ id: string; code: string; name: string }>>([]);

  type FormValues = {
    date: Date;
    description: string;
    lines: {
      accountId: string;
      debit: string;
      credit: string;
      description?: string;
    }[];
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(journalEntrySchema),
    defaultValues: {
      date: new Date(),
      description: '',
      lines: [
        { accountId: '', debit: '0.00', credit: '0.00', description: '' },
        { accountId: '', debit: '0.00', credit: '0.00', description: '' },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'lines',
  });

  useEffect(() => {
    const init = async () => {
      try {
        const response = await fetch('/api/active-company');
        const { companyId } = await response.json();
        setCompanyId(companyId);

        // Las líneas de asiento solo pueden imputar a cuentas imputables (hojas).
        const accounts = await getImputableAccounts(companyId);
        setAccounts(accounts);
      } catch (error) {
        toast.error('Error al cargar los datos');
      }
    };
    init();
  }, []);

  const handleSubmit = async (data: FormValues) => {
    if (!companyId) {
      toast.error('Error al obtener la empresa activa');
      return;
    }

    setIsLoading(true);
    try {
      await createJournalEntry(companyId, data);
      toast.success('Asiento creado correctamente');
      router.refresh();
      onClose();
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Error al crear el asiento');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Calcular totales
  const totalDebit = fields.reduce((sum, field, index) => {
    const value = form.watch(`lines.${index}.debit`) || '0.00';
    return sum + Number(value);
  }, 0);

  const totalCredit = fields.reduce((sum, field, index) => {
    const value = form.watch(`lines.${index}.credit`) || '0.00';
    return sum + Number(value);
  }, 0);

  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nuevo Asiento Contable</DialogTitle>
          <DialogDescription>
            Crea un nuevo asiento en el libro diario
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit as any)} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="date">
                Fecha <span className="text-destructive">*</span>
              </Label>
              <Input
                id="date"
                type="date"
                value={form.watch('date')?.toISOString().split('T')[0]}
                onChange={(e) => form.setValue('date', new Date(e.target.value))}
                disabled={isLoading}
              />
              {form.formState.errors.date && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.date.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              Descripción <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="description"
              {...form.register('description')}
              disabled={isLoading}
            />
            {form.formState.errors.description && (
              <p className="text-sm text-destructive">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Líneas del Asiento</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ accountId: '', debit: '0.00', credit: '0.00', description: '' })}
                disabled={isLoading}
              >
                <Plus className="mr-2 h-4 w-4" />
                Agregar Línea
              </Button>
            </div>

            <div className="rounded-md border">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="w-[50%] py-3 pl-4 text-left">Cuenta</th>
                    <th className="w-[20%] py-3 text-left">Debe</th>
                    <th className="w-[20%] py-3 text-left">Haber</th>
                    <th className="w-[10%] py-3 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, index) => (
                    <tr key={field.id} className="border-b last:border-0">
                      <td className="py-2 pl-4">
                        <Select
                          value={form.watch(`lines.${index}.accountId`)}
                          onValueChange={(value) =>
                            form.setValue(`lines.${index}.accountId`, value)
                          }
                          disabled={isLoading}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Seleccionar cuenta" />
                          </SelectTrigger>
                          <SelectContent>
                            {accounts.map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                {account.code} - {account.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {form.formState.errors.lines?.[index]?.accountId && (
                          <p className="mt-1 text-sm text-destructive">
                            {form.formState.errors.lines[index]?.accountId?.message}
                          </p>
                        )}
                      </td>
                      <td className="py-2">
                        <Input
                          type="text"
                          pattern="\d*\.?\d{0,2}"
                          placeholder="0.00"
                          {...form.register(`lines.${index}.debit`)}
                          disabled={isLoading}
                          className="w-full"
                        />
                        {form.formState.errors.lines?.[index]?.debit && (
                          <p className="mt-1 text-sm text-destructive">
                            {form.formState.errors.lines[index]?.debit?.message}
                          </p>
                        )}
                      </td>
                      <td className="py-2">
                        <Input
                          type="text"
                          pattern="\d*\.?\d{0,2}"
                          placeholder="0.00"
                          {...form.register(`lines.${index}.credit`)}
                          disabled={isLoading}
                          className="w-full"
                        />
                        {form.formState.errors.lines?.[index]?.credit && (
                          <p className="mt-1 text-sm text-destructive">
                            {form.formState.errors.lines[index]?.credit?.message}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(index)}
                          disabled={isLoading || fields.length <= 2}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t bg-muted/30">
                    <td className="py-2 pl-4 font-medium">Totales</td>
                    <td className="py-2 font-medium">{formatAmount(totalDebit)}</td>
                    <td className="py-2 font-medium">{formatAmount(totalCredit)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            {form.formState.errors.lines && (
              <p className="text-sm text-destructive">
                {form.formState.errors.lines.message}
              </p>
            )}

            {!isBalanced && (
              <p className="text-sm text-destructive">
                El asiento debe estar balanceado (Debe = Haber)
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || !isBalanced}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear Asiento
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
