'use client';

import { useQuery } from '@tanstack/react-query';

import { AccountCombobox } from '@/shared/components/common/AccountCombobox';

import { getExpenseCategoryAccounts } from '../actions.server';

interface CategoryAccountFieldProps {
  value: string | null | undefined;
  onChange: (accountId: string | null) => void;
  /** Cuenta ya guardada en la categoría: se ofrece aunque hoy no sea imputable. */
  savedAccountId?: string | null;
  disabled?: boolean;
  id?: string;
}

/**
 * Combo de la cuenta contable de una categoría de egreso (TSK-757): cuentas
 * EXPENSE imputables + la guardada (`includeIds`, patrón TSK-724c), para no
 * perderla de vista si dejó de ser imputable. Vacío = cuenta de egresos por defecto.
 */
export function _CategoryAccountField({
  value,
  onChange,
  savedAccountId,
  disabled,
  id,
}: CategoryAccountFieldProps) {
  const includeIds = savedAccountId ? [savedAccountId] : [];

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['expenseCategoryAccounts', includeIds],
    queryFn: () => getExpenseCategoryAccounts(includeIds.length > 0 ? includeIds : undefined),
  });

  return (
    <AccountCombobox
      id={id}
      accounts={accounts}
      value={value}
      onChange={onChange}
      clearLabel="Sin asignar (usar la cuenta de egresos por defecto)"
      placeholder="Por defecto"
      disabled={disabled || isLoading}
    />
  );
}
