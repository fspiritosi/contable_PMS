'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { DialogFooter } from '@/shared/components/ui/dialog';

import type { FundMovementModalMode } from '../../shared/view-mode';

interface FundMovementFormFooterProps {
  mode: FundMovementModalMode;
  /** Edición de un movimiento confirmado: un solo botón que abre la propuesta de corrección. */
  isCorrection?: boolean;
  isSubmitting: boolean;
  /** Deshabilita Guardar y Confirmar (ej.: sin conceptos configurados, TSK-791). */
  submitDisabled?: boolean;
  /** Cancelar (create/edit) o Cerrar (view). */
  onCancel: () => void;
  /** Solo create/edit: false = Guardar, true = Guardar y Confirmar. */
  onSubmit: (confirm: boolean) => void;
}

/** Botones del modal de Movimientos de Fondos según el modo. */
export function _FundMovementFormFooter({
  mode,
  isCorrection = false,
  isSubmitting,
  submitDisabled = false,
  onCancel,
  onSubmit,
}: FundMovementFormFooterProps) {
  if (mode === 'view') {
    return (
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cerrar
        </Button>
      </DialogFooter>
    );
  }

  if (isCorrection) {
    return (
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={() => onSubmit(false)}
          disabled={isSubmitting || submitDisabled}
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Revisar cambios
        </Button>
      </DialogFooter>
    );
  }

  return (
    <DialogFooter className="gap-2 sm:gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
        Cancelar
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => onSubmit(false)}
        disabled={isSubmitting || submitDisabled}
      >
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Guardar
      </Button>
      <Button
        type="button"
        onClick={() => onSubmit(true)}
        disabled={isSubmitting || submitDisabled}
      >
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Guardar y Confirmar
      </Button>
    </DialogFooter>
  );
}
