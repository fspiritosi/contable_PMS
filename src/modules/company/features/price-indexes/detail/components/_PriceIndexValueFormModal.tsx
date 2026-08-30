'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import moment from 'moment';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

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

import {
  createPriceIndexValue,
  type PriceIndexValueItem,
  updatePriceIndexValue,
} from '../actions.server';

// ============================================
// SCHEMA
// ============================================

const priceIndexValueFormSchema = z.object({
  period: z.string().min(1, 'El período es obligatorio'),
  percentage: z.number('El porcentaje debe ser un número'),
});

type PriceIndexValueFormData = z.infer<typeof priceIndexValueFormSchema>;

// ============================================
// PROPS
// ============================================

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  indexId: string;
  value?: PriceIndexValueItem | null;
}

// ============================================
// COMPONENT
// ============================================

export function _PriceIndexValueFormModal({ open, onOpenChange, indexId, value }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!value;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PriceIndexValueFormData>({
    resolver: zodResolver(priceIndexValueFormSchema),
    defaultValues: { period: '', percentage: 0 },
  });

  useEffect(() => {
    if (open) {
      reset({
        period: value ? moment.utc(value.period).format('YYYY-MM') : '',
        percentage: value?.percentage ?? 0,
      });
    }
  }, [open, value, reset]);

  const createMutation = useMutation({
    mutationFn: (data: PriceIndexValueFormData) =>
      createPriceIndexValue(indexId, {
        // Se parsea en UTC para que el mes elegido no dependa de la zona
        // horaria del navegador (un offset positivo podría hacerlo retroceder
        // al mes anterior si se interpretara en hora local).
        period: moment.utc(data.period, 'YYYY-MM').toDate(),
        percentage: data.percentage,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priceIndexValues', indexId] });
      toast.success('Valor de índice creado');
      onOpenChange(false);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al crear valor de índice');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: PriceIndexValueFormData) =>
      updatePriceIndexValue(value!.id, { percentage: data.percentage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priceIndexValues', indexId] });
      toast.success('Valor de índice actualizado');
      onOpenChange(false);
      router.refresh();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Error al actualizar valor de índice'
      );
    },
  });

  const onSubmit = (data: PriceIndexValueFormData) => {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid="price-index-value-form-modal">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Editar Valor' : 'Nuevo Valor de Índice'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Modifica el porcentaje del período'
                : 'Ingresa el período y el porcentaje del índice'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="period">Período *</Label>
              <Input
                id="period"
                type="month"
                {...register('period')}
                disabled={isEditing}
                data-testid="price-index-value-period-input"
              />
              {errors.period && (
                <p className="text-sm text-destructive" data-testid="price-index-value-period-error">
                  {errors.period.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="percentage">Porcentaje (%) *</Label>
              <Input
                id="percentage"
                type="number"
                step="0.001"
                {...register('percentage', { valueAsNumber: true })}
                placeholder="Ej: 4.2 o -1.5"
                data-testid="price-index-value-percentage-input"
              />
              {errors.percentage && (
                <p
                  className="text-sm text-destructive"
                  data-testid="price-index-value-percentage-error"
                >
                  {errors.percentage.message}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              data-testid="price-index-value-cancel-button"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending || isSubmitting}
              data-testid="price-index-value-submit-button"
            >
              {isPending ? 'Guardando...' : isEditing ? 'Actualizar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
