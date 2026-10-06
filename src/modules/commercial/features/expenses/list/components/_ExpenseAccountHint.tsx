'use client';

import { useQuery } from '@tanstack/react-query';

import { formatAccountLabel } from '@/modules/commercial/shared/line-accounts';

import { getDefaultExpenseAccount } from '../../actions.server';

interface ExpenseAccountHintProps {
  /** Categoría elegida en el alta; `undefined` = ninguna todavía. */
  category: { account: { code: string; name: string } | null } | undefined;
}

/**
 * Aviso bajo el combo de categoría del alta (TSK-757, D6): a qué cuenta va el
 * Debe al confirmar. Si la categoría no tiene cuenta, consulta la de egresos
 * por defecto para avisar también cuando no hay ninguna configurada.
 */
export function _ExpenseAccountHint({ category }: ExpenseAccountHintProps) {
  const needsDefault = Boolean(category && !category.account);

  const { data: defaultAccount, isLoading } = useQuery({
    queryKey: ['expenseDefaultAccount'],
    queryFn: getDefaultExpenseAccount,
    enabled: needsDefault,
  });

  if (!category) return null;

  if (category.account) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="expense-account-hint">
        Se imputa a: {formatAccountLabel(category.account)}
      </p>
    );
  }

  if (isLoading) return null;

  if (!defaultAccount) {
    return (
      <p className="text-xs text-amber-700 dark:text-amber-500" data-testid="expense-account-hint">
        La categoría no tiene cuenta y no hay cuenta de egresos por defecto: asignale una en
        Categorías o configurala en Contabilidad → Configuración antes de confirmar.
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground" data-testid="expense-account-hint">
      Se imputa a la cuenta de egresos por defecto: {formatAccountLabel(defaultAccount)}
    </p>
  );
}
