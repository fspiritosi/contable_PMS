import { AccountType } from '@/generated/prisma/enums';
import { type Account } from '@/generated/prisma/client';
import { type AccountWithChildren } from '../types';

// Re-export balance functions
export {
  calculateAccountBalance,
  calculateAllAccountBalances,
  calculateBalanceByType,
  calculateOpeningBalance,
  verifyAccountingEquation,
  getAccountRollupBalances,
} from './balances';

/**
 * Determina si una cuenta está vigente en el ejercicio consultado.
 *
 * Reglas (ticket #376):
 * - `isActive: false` → nunca vigente (soft-delete global).
 * - Sin corte de deshabilitado (`disabledFrom == null`) → vigente.
 * - Con corte: vigente sólo si el ejercicio consultado es anterior al de corte,
 *   es decir `fiscalYearStart < disabledFrom`.
 *
 * @param account campos mínimos: `isActive` y `disabledFrom`.
 * @param fiscalYearStart fecha de inicio del ejercicio consultado.
 */
export function isAccountEnabled(
  account: { isActive: boolean; disabledFrom: Date | null },
  fiscalYearStart: Date
): boolean {
  return account.isActive && (!account.disabledFrom || fiscalYearStart < account.disabledFrom);
}

/**
 * Convierte una lista plana de cuentas en una estructura jerárquica
 */
export function buildAccountTree(accounts: Account[]): AccountWithChildren[] {
  const accountMap = new Map<string, AccountWithChildren>();

  // Primero crear todos los nodos
  accounts.forEach(account => {
    accountMap.set(account.id, {
      ...account,
      children: [],
    });
  });

  // Luego construir la jerarquía
  const rootAccounts: AccountWithChildren[] = [];
  accounts.forEach(account => {
    const node = accountMap.get(account.id)!;
    if (account.parentId) {
      const parent = accountMap.get(account.parentId);
      if (parent) {
        parent.children.push(node);
      }
    } else {
      rootAccounts.push(node);
    }
  });

  return rootAccounts;
}

/**
 * Genera el siguiente código de cuenta basado en el tipo y el último código existente
 */
export function generateNextAccountCode(type: AccountType, lastCode?: string): string {
  const baseCode = {
    [AccountType.ASSET]: '1',
    [AccountType.LIABILITY]: '2',
    [AccountType.EQUITY]: '3',
    [AccountType.REVENUE]: '4',
    [AccountType.EXPENSE]: '5',
  }[type];

  if (!lastCode) {
    return `${baseCode}.0.0`;
  }

  const parts = lastCode.split('.');
  if (parts[0] !== baseCode) {
    return `${baseCode}.0.0`;
  }

  const lastPart = parseInt(parts[parts.length - 1]);
  parts[parts.length - 1] = (lastPart + 1).toString();
  return parts.join('.');
}

/**
 * Formatea un número como valor monetario
 */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(amount);
}

/**
 * Formatea una fecha según el formato local
 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-AR').format(date);
}

/**
 * Calcula el saldo de una cuenta basado en su naturaleza (simple)
 * @deprecated Use calculateAccountBalance from balances.ts instead
 */
export function calculateSimpleBalance(debitTotal: number, creditTotal: number, nature: 'DEBIT' | 'CREDIT'): number {
  if (nature === 'DEBIT') {
    return debitTotal - creditTotal;
  }
  return creditTotal - debitTotal;
}

/**
 * Valida que un código de cuenta sea válido
 */
export function isValidAccountCode(code: string): boolean {
  // Formato: X.X.X donde X son números
  return /^[1-5]\.\d+\.\d+$/.test(code);
}

/**
 * Genera el siguiente número de asiento
 */
export function generateNextEntryNumber(lastNumber: number): number {
  return lastNumber + 1;
}

/**
 * Revalida rutas contables después de mutaciones
 */
export function revalidateAccountingRoutes(companyId: string) {
  const { revalidatePath } = require('next/cache');

  // Hub general
  revalidatePath('/dashboard/accounting');

  // Rutas específicas de la empresa
  revalidatePath('/dashboard/company/accounting');
  revalidatePath('/dashboard/company/accounting/accounts');
  revalidatePath('/dashboard/company/accounting/entries');
  revalidatePath('/dashboard/company/accounting/reports');
  revalidatePath('/dashboard/company/accounting/settings');
  revalidatePath('/dashboard/company/accounting/fiscal-year-close');
  revalidatePath('/dashboard/company/accounting/recurring-entries');
  revalidatePath('/dashboard/company/accounting/opening-balances');
  revalidatePath('/dashboard/company/accounting/budgets');

  // Dashboard principal (en caso de widgets contables)
  revalidatePath('/dashboard');
}
