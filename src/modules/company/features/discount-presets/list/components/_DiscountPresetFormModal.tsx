'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Switch } from '@/shared/components/ui/switch';

import {
  createDiscountPreset,
  type DiscountPresetListItem,
  updateDiscountPreset,
} from '../actions.server';

// ============================================
// SCHEMA
// ============================================

const discountPresetFormSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  percentage: z
    .number()
    .min(0.01, 'El porcentaje debe ser mayor a 0')
    .max(100, 'El porcentaje no puede superar 100'),
  isActive: z.boolean().optional(),
});

type DiscountPresetFormData = z.infer<typeof discountPresetFormSchema>;

// ============================================
// PROPS
// ============================================

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: DiscountPresetListItem | null;
}

// ============================================
// COMPONENT
// ============================================

export function _DiscountPresetFormModal({ open, onOpenChange, preset }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!preset;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DiscountPresetFormData>({
    resolver: zodResolver(discountPresetFormSchema),
    defaultValues: { name: '', percentage: 0, isActive: true },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: preset?.name ?? '',
        percentage: preset?.percentage ?? 0,
        isActive: preset?.isActive ?? true,
      });
    }
  }, [open, preset, reset]);

  const createMutation = useMutation({
    mutationFn: createDiscountPreset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discountPresets'] });
      toast.success('Descuento predefinido creado');
      onOpenChange(false);
      router.refresh();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Error al crear descuento predefinido'
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: DiscountPresetFormData) => updateDiscountPreset(preset!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discountPresets'] });
      toast.success('Descuento predefinido actualizado');
      onOpenChange(false);
      router.refresh();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Error al actualizar descuento predefinido'
      );
    },
  });

  const onSubmit = (data: DiscountPresetFormData) => {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isActiveValue = watch('isActive');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid="discount-preset-form-modal">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? 'Editar Descuento Predefinido' : 'Nuevo Descuento Predefinido'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Modifica los datos del descuento predefinido'
                : 'Ingresa los datos del nuevo descuento predefinido'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                {...register('name')}
                placeholder="Ej: Descuento por volumen"
                data-testid="discount-preset-name-input"
              />
              {errors.name && (
                <p className="text-sm text-destructive" data-testid="discount-preset-name-error">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="percentage">Porcentaje (%) *</Label>
              <Input
                id="percentage"
                type="number"
                step="0.01"
                min="0.01"
                max="100"
                {...register('percentage', { valueAsNumber: true })}
                placeholder="Ej: 10.00"
                data-testid="discount-preset-percentage-input"
              />
              {errors.percentage && (
                <p
                  className="text-sm text-destructive"
                  data-testid="discount-preset-percentage-error"
                >
                  {errors.percentage.message}
                </p>
              )}
            </div>

            {isEditing && (
              <div className="flex items-center justify-between space-x-2">
                <Label htmlFor="isActive">Activo</Label>
                <Switch
                  id="isActive"
                  checked={isActiveValue ?? true}
                  onCheckedChange={(checked) => setValue('isActive', checked)}
                  data-testid="discount-preset-active-switch"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              data-testid="discount-preset-cancel-button"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending || isSubmitting}
              data-testid="discount-preset-submit-button"
            >
              {isPending ? 'Guardando...' : isEditing ? 'Actualizar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
