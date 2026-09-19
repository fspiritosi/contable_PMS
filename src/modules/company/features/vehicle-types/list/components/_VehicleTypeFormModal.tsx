'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
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
import { Separator } from '@/shared/components/ui/separator';

import { createVehicleType, updateVehicleType, type VehicleTypeListItem } from '../actions.server';
import { type VehicleTypeFormData, vehicleTypeSchema } from '../validators';
import { _VehicleTypeAccountsFields } from './_VehicleTypeAccountsFields';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleType?: VehicleTypeListItem | null;
}

/** Valores del form a partir del tipo guardado (o vacíos para crear). */
const toFormValues = (vehicleType?: VehicleTypeListItem | null): VehicleTypeFormData => ({
  name: vehicleType?.name ?? '',
  hasHitch: vehicleType?.hasHitch ?? false,
  isTractorUnit: vehicleType?.isTractorUnit ?? false,
  fixedAssetAccountId: vehicleType?.fixedAssetAccountId ?? null,
  accumulatedDepreciationAccountId: vehicleType?.accumulatedDepreciationAccountId ?? null,
  depreciationExpenseAccountId: vehicleType?.depreciationExpenseAccountId ?? null,
});

export function _VehicleTypeFormModal({ open, onOpenChange, vehicleType }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!vehicleType;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<VehicleTypeFormData>({
    resolver: zodResolver(vehicleTypeSchema),
    defaultValues: toFormValues(null),
  });

  // Watch checkbox values (las cuentas las lee `_VehicleTypeAccountsFields` con `watch()`)
  const hasHitch = watch('hasHitch');
  const isTractorUnit = watch('isTractorUnit');

  // Reset form cuando cambia vehicleType o se abre el modal
  useEffect(() => {
    if (open) reset(toFormValues(vehicleType));
  }, [open, vehicleType, reset]);

  const createMutation = useMutation({
    mutationFn: createVehicleType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleTypes'] });
      toast.success('Tipo de Equipo creado');
      onOpenChange(false);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al crear tipo de equipo');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: VehicleTypeFormData) => updateVehicleType(vehicleType!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleTypes'] });
      toast.success('Tipo de Equipo actualizado');
      onOpenChange(false);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al actualizar tipo de equipo');
    },
  });

  const onSubmit = (data: VehicleTypeFormData) => {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]"
        data-testid="vehicle-type-form-modal"
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? 'Editar Tipo de Equipo' : 'Nuevo Tipo de Equipo'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Modifica los datos del tipo de equipo'
                : 'Ingresa los datos del nuevo tipo de equipo'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                {...register('name')}
                placeholder="Nombre del tipo de equipo"
                data-testid="vehicle-type-name-input"
              />
              {errors.name && (
                <p className="text-sm text-destructive" data-testid="vehicle-type-name-error">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="hasHitch"
                checked={hasHitch}
                onCheckedChange={(checked) => setValue('hasHitch', checked === true)}
                data-testid="vehicle-type-has-hitch-checkbox"
              />
              <Label htmlFor="hasHitch" className="cursor-pointer">
                Tiene enganche
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="isTractorUnit"
                checked={isTractorUnit}
                onCheckedChange={(checked) => setValue('isTractorUnit', checked === true)}
                data-testid="vehicle-type-is-tractor-unit-checkbox"
              />
              <Label htmlFor="isTractorUnit" className="cursor-pointer">
                Es unidad tractora
              </Label>
            </div>

            <Separator />
            <h3 className="text-sm font-medium">Cuentas contables (Bienes de Uso)</h3>
            <_VehicleTypeAccountsFields
              values={watch()}
              onChange={(field, accountId) => setValue(field, accountId, { shouldDirty: true })}
              saved={vehicleType ?? null}
              enabled={open}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              data-testid="vehicle-type-cancel-button"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending || isSubmitting}
              data-testid="vehicle-type-submit-button"
            >
              {isPending ? 'Guardando...' : isEditing ? 'Actualizar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
