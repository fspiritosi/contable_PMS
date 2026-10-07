'use client';

import {
  describeExpenseDebitSource,
  type ExpenseDebitAccountView,
} from '@/modules/commercial/shared/expense-accounts';

interface ExpenseDebitAccountInfoProps {
  debitAccount: ExpenseDebitAccountView | null;
  /** Número del asiento, si el egreso ya tiene uno. */
  entryNumber?: number | null;
}

/**
 * "Cuenta contable" del detalle del egreso (TSK-757, D6): la del Debe del
 * asiento si está confirmado; en borrador, la prevista con su origen.
 */
export function _ExpenseDebitAccountInfo({ debitAccount, entryNumber }: ExpenseDebitAccountInfoProps) {
  if (!debitAccount) return null;

  return (
    <div className="min-w-0" data-testid="expense-debit-account">
      <p className="text-sm text-muted-foreground">Cuenta contable</p>
      {debitAccount.origin === 'missing' ? (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
          Sin cuenta: configurala antes de confirmar
        </p>
      ) : (
        <>
          <p className="font-medium break-words">{debitAccount.label}</p>
          <span className="text-xs text-muted-foreground">
            ({describeExpenseDebitSource(debitAccount.origin)}
            {debitAccount.origin === 'entry' && entryNumber ? ` N° ${entryNumber}` : ''})
          </span>
        </>
      )}
    </div>
  );
}
