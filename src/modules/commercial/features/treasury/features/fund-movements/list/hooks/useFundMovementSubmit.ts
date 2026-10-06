import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';

import type { FundMovementFormInput } from '../../shared/validators';
import type { FundMovementModalMode } from '../../shared/view-mode';
import {
  confirmFundMovement,
  createFundMovement,
  updateFundMovement,
  type FundMovementActionResult,
  type FundMovementListItem,
} from '../actions.server';

export interface UseFundMovementSubmitParams {
  form: UseFormReturn<FundMovementFormInput>;
  mode: FundMovementModalMode;
  movement: FundMovementListItem | null | undefined;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export interface UseFundMovementSubmitResult {
  isSubmitting: boolean;
  submit: (confirm: boolean) => Promise<void>;
}

/** Guardar / Guardar y Confirmar del modal de Movimientos de Fondos. */
export function useFundMovementSubmit({
  form,
  mode,
  movement,
  onOpenChange,
  onSuccess,
}: UseFundMovementSubmitParams): UseFundMovementSubmitResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEdit = mode === 'edit' && Boolean(movement);
  const queryClient = useQueryClient();

  const persist = async (data: FundMovementFormInput, confirm: boolean) => {
    // Defensivo: la vista no ofrece guardar (TSK-720a).
    if (mode === 'view') return;
    setIsSubmitting(true);
    try {
      let result: FundMovementActionResult;

      if (isEdit && movement) {
        result = await updateFundMovement(movement.id, data);
        if (result.success && confirm) {
          result = await confirmFundMovement(movement.id);
        }
      } else {
        result = await createFundMovement(data, confirm);
      }

      // Los errores esperables llegan como dato con su mensaje real: en producción
      // una excepción del server action se ve como un digest ilegible (TSK-481).
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      // La cache de `movementDetail` no se invalida sola: `onSuccess` hace
      // `router.refresh()` (ver `_FundMovementsTable`), que refresca el Server
      // Component pero no toca React Query. Sin esto, reabrir este mismo
      // movimiento poco después podía servir los conceptos previos a esta
      // edición (hallazgo de revisión final, TSK-585).
      if (isEdit && movement) {
        await queryClient.invalidateQueries({ queryKey: ['fund-movement-detail', movement.id] });
      }

      toast.success(
        confirm ? 'Movimiento confirmado' : isEdit ? 'Borrador actualizado' : 'Borrador guardado'
      );
      onOpenChange(false);
      onSuccess();
    } finally {
      setIsSubmitting(false);
    }
  };

  const submit = (confirm: boolean) => form.handleSubmit((data) => persist(data, confirm))();

  return { isSubmitting, submit };
}
