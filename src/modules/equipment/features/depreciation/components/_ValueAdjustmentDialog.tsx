'use client';

import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { MoneyInput } from '@/shared/components/ui/money-input';

import { valueAdjustmentSchema, type ValueAdjustmentInput } from '../validators';
import { createValueAdjustment } from '../actions.server';

interface Props {
  vehicleId: string;
  currentBookValue: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatCurrency(value: number): string {
  return `$ ${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function _ValueAdjustmentDialog({
  vehicleId,
  currentBookValue,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ValueAdjustmentInput>({
    resolver: zodResolver(valueAdjustmentSchema),
    defaultValues: {
      date: new Date(),
      newValue: currentBookValue,
      reason: '',
    },
  });

  const newValue = form.watch('newValue');
  const difference = (newValue || 0) - currentBookValue;

  const handleSubmit = async (data: ValueAdjustmentInput) => {
    setIsSubmitting(true);
    try {
      await createValueAdjustment(vehicleId, data);
      toast.success('Ajuste de valor registrado correctamente');
      queryClient.invalidateQueries({ queryKey: ['vehicleDepreciation', vehicleId] });
      router.refresh();
      onOpenChange(false);
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al registrar el ajuste');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Ajustar Valor del Activo</DialogTitle>
          <DialogDescription>
            Registre una revaluación o deterioro del valor del equipo
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          {/* Valor actual (readonly) */}
          <div className="space-y-2">
            <Label>Valor Libro Actual</Label>
            <p className="text-lg font-semibold">{formatCurrency(currentBookValue)}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Fecha */}
            <div className="space-y-2">
              <Label htmlFor="adjustDate">Fecha del Ajuste</Label>
              <Input id="adjustDate" type="date" {...form.register('date')} />
              {form.formState.errors.date && (
                <p className="text-xs text-destructive">{form.formState.errors.date.message}</p>
              )}
            </div>

            {/* Nuevo valor */}
            <div className="space-y-2">
              <Label htmlFor="newValue">Nuevo Valor</Label>
              <Controller
                control={form.control}
                name="newValue"
                render={({ field }) => (
                  <MoneyInput
                    placeholder="0,00"
                    value={field.value ?? ''}
                    onChange={(raw) => field.onChange(raw === '' ? undefined : Number(raw))}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
              {form.formState.errors.newValue && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.newValue.message}
                </p>
              )}
            </div>
          </div>

          {/* Diferencia */}
          {difference !== 0 && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm">
                Diferencia:{' '}
                <span
                  className={`font-semibold ${difference > 0 ? 'text-green-600' : 'text-destructive'}`}
                >
                  {difference > 0 ? '+' : ''}
                  {formatCurrency(difference)}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  ({difference > 0 ? 'Revaluación' : 'Deterioro'})
                </span>
              </p>
            </div>
          )}

          {/* Motivo */}
          <div className="space-y-2">
            <Label htmlFor="reason">Motivo del Ajuste</Label>
            <Textarea
              id="reason"
              placeholder="Ingrese el motivo del ajuste de valor..."
              {...form.register('reason')}
            />
            {form.formState.errors.reason && (
              <p className="text-xs text-destructive">{form.formState.errors.reason.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || difference === 0}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar Ajuste
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
