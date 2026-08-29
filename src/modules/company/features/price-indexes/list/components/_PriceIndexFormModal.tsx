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
import { Textarea } from '@/shared/components/ui/textarea';

import {
  createPriceIndex,
  type PriceIndexListItem,
  updatePriceIndex,
} from '../actions.server';

// ============================================
// SCHEMA
// ============================================

const priceIndexFormSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

type PriceIndexFormData = z.infer<typeof priceIndexFormSchema>;

// ============================================
// PROPS
// ============================================

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  priceIndex?: PriceIndexListItem | null;
}

// ============================================
// COMPONENT
// ============================================

export function _PriceIndexFormModal({ open, onOpenChange, priceIndex }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!priceIndex;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PriceIndexFormData>({
    resolver: zodResolver(priceIndexFormSchema),
    defaultValues: { name: '', description: '', isActive: true },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: priceIndex?.name ?? '',
        description: priceIndex?.description ?? '',
        isActive: priceIndex?.isActive ?? true,
      });
    }
  }, [open, priceIndex, reset]);

  const createMutation = useMutation({
    mutationFn: createPriceIndex,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priceIndexes'] });
      toast.success('Índice de precios creado');
      onOpenChange(false);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al crear índice de precios');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: PriceIndexFormData) => updatePriceIndex(priceIndex!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priceIndexes'] });
      toast.success('Índice de precios actualizado');
      onOpenChange(false);
      router.refresh();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Error al actualizar índice de precios'
      );
    },
  });

  const onSubmit = (data: PriceIndexFormData) => {
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
      <DialogContent className="sm:max-w-[425px]" data-testid="price-index-form-modal">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? 'Editar Índice de Precios' : 'Nuevo Índice de Precios'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Modifica los datos del índice de precios'
                : 'Ingresa los datos del nuevo índice de precios'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                {...register('name')}
                placeholder="Ej: IPC"
                data-testid="price-index-name-input"
              />
              {errors.name && (
                <p className="text-sm text-destructive" data-testid="price-index-name-error">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea
                id="description"
                {...register('description')}
                placeholder="Ej: Índice de Precios al Consumidor (INDEC)"
                rows={3}
                data-testid="price-index-description-input"
              />
              {errors.description && (
                <p
                  className="text-sm text-destructive"
                  data-testid="price-index-description-error"
                >
                  {errors.description.message}
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
                  data-testid="price-index-active-switch"
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
              data-testid="price-index-cancel-button"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending || isSubmitting}
              data-testid="price-index-submit-button"
            >
              {isPending ? 'Guardando...' : isEditing ? 'Actualizar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
