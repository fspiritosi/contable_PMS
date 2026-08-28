'use client';

import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import moment from 'moment';

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
import { MoneyInput } from '@/shared/components/ui/money-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { depreciationConfigSchema, type DepreciationConfigInput } from '../validators';
import { createVehicleDepreciation } from '../actions.server';
import { generateDepreciationSchedule } from '../lib/calculations';

interface Props {
  vehicleId: string;
  vehiclePrice?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function _DepreciationConfigDialog({ vehicleId, vehiclePrice, open, onOpenChange }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<DepreciationConfigInput>({
    resolver: zodResolver(depreciationConfigSchema),
    defaultValues: {
      method: 'STRAIGHT_LINE',
      grossValue: vehiclePrice ?? 0,
      salvageValue: 0,
      usefulLifeMonths: 60, // 5 años por defecto
      startDate: new Date(),
      depreciationRate: null,
    },
  });

  const method = form.watch('method');
  const grossValue = form.watch('grossValue');
  const salvageValue = form.watch('salvageValue');
  const usefulLifeMonths = form.watch('usefulLifeMonths');

  // Preview del monto mensual
  const monthlyAmount =
    method === 'STRAIGHT_LINE' && grossValue > 0 && usefulLifeMonths > 0
      ? Math.round(((grossValue - (salvageValue || 0)) / usefulLifeMonths) * 100) / 100
      : null;

  const handleSubmit = async (data: DepreciationConfigInput) => {
    setIsSubmitting(true);
    try {
      await createVehicleDepreciation(vehicleId, data);
      toast.success('Depreciación configurada correctamente');
      queryClient.invalidateQueries({ queryKey: ['vehicleDepreciation', vehicleId] });
      router.refresh();
      onOpenChange(false);
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al configurar la depreciación');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Configurar Depreciación</DialogTitle>
          <DialogDescription>
            Configure los parámetros de depreciación para este equipo
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Método */}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="method">Método de Depreciación</Label>
              <Select
                value={method}
                onValueChange={(value) =>
                  form.setValue('method', value as 'STRAIGHT_LINE' | 'DECLINING_BALANCE')
                }
              >
                <SelectTrigger id="method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STRAIGHT_LINE">Línea Recta</SelectItem>
                  <SelectItem value="DECLINING_BALANCE">Saldo Decreciente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Valor de Origen */}
            <div className="space-y-2">
              <Label htmlFor="grossValue">Valor de Origen</Label>
              <Controller
                control={form.control}
                name="grossValue"
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
              {form.formState.errors.grossValue && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.grossValue.message}
                </p>
              )}
            </div>

            {/* Valor Residual */}
            <div className="space-y-2">
              <Label htmlFor="salvageValue">Valor Residual</Label>
              <Controller
                control={form.control}
                name="salvageValue"
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
              {form.formState.errors.salvageValue && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.salvageValue.message}
                </p>
              )}
            </div>

            {/* Vida Útil */}
            <div className="space-y-2">
              <Label htmlFor="usefulLifeMonths">Vida Útil (meses)</Label>
              <Input
                id="usefulLifeMonths"
                type="number"
                min="1"
                max="600"
                {...form.register('usefulLifeMonths', { valueAsNumber: true })}
              />
              {usefulLifeMonths > 0 && (
                <p className="text-xs text-muted-foreground">
                  {Math.floor(usefulLifeMonths / 12)} años y {usefulLifeMonths % 12} meses
                </p>
              )}
              {form.formState.errors.usefulLifeMonths && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.usefulLifeMonths.message}
                </p>
              )}
            </div>

            {/* Fecha de Inicio */}
            <div className="space-y-2">
              <Label htmlFor="startDate">Fecha de Inicio</Label>
              <Input
                id="startDate"
                type="date"
                {...form.register('startDate')}
              />
              {form.formState.errors.startDate && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.startDate.message}
                </p>
              )}
            </div>

            {/* Tasa de Depreciación (solo Saldo Decreciente) */}
            {method === 'DECLINING_BALANCE' && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="depreciationRate">Tasa Anual de Depreciación (%)</Label>
                <Input
                  id="depreciationRate"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="100"
                  {...form.register('depreciationRate', { valueAsNumber: true })}
                />
                {form.formState.errors.depreciationRate && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.depreciationRate.message}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Preview */}
          {monthlyAmount != null && monthlyAmount > 0 && (
            <div className="rounded-lg bg-muted p-4 space-y-1">
              <p className="text-sm font-medium">Vista previa</p>
              <p className="text-sm text-muted-foreground">
                Depreciación mensual estimada:{' '}
                <span className="font-semibold text-foreground">
                  $ {monthlyAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Monto depreciable:{' '}
                <span className="font-semibold text-foreground">
                  $ {(grossValue - (salvageValue || 0)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </span>
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Configurar Depreciación
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
