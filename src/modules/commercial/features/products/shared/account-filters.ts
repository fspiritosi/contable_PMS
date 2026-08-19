/**
 * Qué cuentas contables puede imputarse un ítem, según se lo compre o se lo
 * venda.
 *
 * El criterio es el tipo de cuenta y no la naturaleza del saldo: la naturaleza
 * dice cómo suma la cuenta (deudora o acreedora), no si el ítem puede comprarse
 * o venderse. Filtrar por naturaleza dejaba los activos fuera del selector de
 * ingresos (TSK-579).
 */

/** Mínimo que necesita una cuenta para poder clasificarla. */
export interface ClassifiableAccount {
  type: string;
}

/**
 * Los activos entran en ambos selectores: un rodado o una máquina se compra y
 * también se vende. Pasivo y patrimonio neto quedan fuera de los dos, porque no
 * son contrapartida de la compraventa de un ítem.
 */
const EXPENSE_ACCOUNT_TYPES = ['EXPENSE', 'ASSET'];
const INCOME_ACCOUNT_TYPES = ['REVENUE', 'ASSET'];

/** Cuentas imputables cuando se compra el ítem. */
export function filterExpenseAccounts<T extends ClassifiableAccount>(accounts: T[]): T[] {
  return accounts.filter((account) => EXPENSE_ACCOUNT_TYPES.includes(account.type));
}

/** Cuentas imputables cuando se vende el ítem. */
export function filterIncomeAccounts<T extends ClassifiableAccount>(accounts: T[]): T[] {
  return accounts.filter((account) => INCOME_ACCOUNT_TYPES.includes(account.type));
}
