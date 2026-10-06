'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { logger } from '@/shared/lib/logger';
import { UNEXPECTED_ERROR_MESSAGE, type ActionResult } from '@/shared/lib/action-result';

import {
  createExpenseCategory,
  toggleExpenseCategory,
  updateExpenseCategory,
} from '../actions.server';
import type { ExpenseCategoryFormInput } from '../validators';

export interface ExpenseCategoryMutations {
  /** true si se creó (el form se resetea solo en ese caso). */
  createCategory: (data: ExpenseCategoryFormInput) => Promise<boolean>;
  updateCategory: (id: string, data: ExpenseCategoryFormInput) => Promise<boolean>;
  toggleCategory: (category: { id: string; isActive: boolean }) => Promise<boolean>;
  isCreating: boolean;
  /** Categoría con un update/toggle en curso (deshabilita sus botones). */
  pendingId: string | null;
}

/** Listas que dependen de las categorías: el ABM, el combo del alta y el combo de cuentas. */
const CATEGORY_QUERY_KEYS = [
  ['allExpenseCategories'],
  ['expenseCategories'],
  ['expenseCategoryAccounts'],
] as const;

/**
 * Mutaciones del ABM de categorías de egreso (TSK-757). Las actions devuelven
 * `ActionResult`: el error de negocio llega como dato y se muestra tal cual;
 * un fallo técnico (red, excepción) cae en `onError` con el mensaje genérico.
 */
export function useExpenseCategoryMutations(): ExpenseCategoryMutations {
  const queryClient = useQueryClient();

  const handleResult = async (result: ActionResult, successMessage: string) => {
    if (!result.success) {
      toast.error(result.error);
      return false;
    }
    toast.success(successMessage);
    await Promise.all(
      CATEGORY_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
    );
    return true;
  };

  const handleError = (contexto: string) => (error: unknown) => {
    logger.error(contexto, { data: { error } });
    toast.error(UNEXPECTED_ERROR_MESSAGE);
  };

  const create = useMutation({
    mutationFn: createExpenseCategory,
    onError: handleError('Error al crear categoría de gasto'),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ExpenseCategoryFormInput }) =>
      updateExpenseCategory(id, data),
    onError: handleError('Error al actualizar categoría de gasto'),
  });

  const toggle = useMutation({
    mutationFn: (category: { id: string; isActive: boolean }) => toggleExpenseCategory(category.id),
    onError: handleError('Error al cambiar estado de categoría'),
  });

  /** `mutateAsync` relanza el error ya manejado por `onError`: acá solo se traduce a `false`. */
  const run = async (action: () => Promise<boolean>) => {
    try {
      return await action();
    } catch {
      return false;
    }
  };

  const pendingUpdateId = update.isPending ? (update.variables?.id ?? null) : null;
  const pendingToggleId = toggle.isPending ? (toggle.variables?.id ?? null) : null;

  return {
    createCategory: (data) =>
      run(async () => handleResult(await create.mutateAsync(data), 'Categoría creada correctamente')),
    updateCategory: (id, data) =>
      run(async () =>
        handleResult(await update.mutateAsync({ id, data }), 'Categoría actualizada correctamente')
      ),
    toggleCategory: (category) =>
      run(async () =>
        handleResult(
          await toggle.mutateAsync(category),
          category.isActive ? 'Categoría desactivada' : 'Categoría activada'
        )
      ),
    isCreating: create.isPending,
    pendingId: pendingUpdateId ?? pendingToggleId,
  };
}
