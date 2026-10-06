/**
 * Cuenta contable del Debe de un egreso (TSK-757).
 *
 * Cada categoría de gasto puede tener su propia cuenta; si no tiene, el egreso
 * usa la "Cuenta de egresos por defecto" de Ajustes contables; si tampoco hay,
 * no se confirma y el mensaje dice las dos formas de resolverlo. Si la cuenta de
 * la categoría existe pero no es imputable, el llamador BLOQUEA: nunca se cae en
 * silencio a la por defecto (criterio de TSK-717).
 *
 * Funciones puras (sin Prisma, sin React), compartidas por `confirmExpense`
 * (pre-validación y presupuesto), el asiento
 * (`accounting/features/integrations/commercial/index.ts`, defensa en
 * profundidad) y el detalle del egreso, para que las cuatro piezas resuelvan la
 * misma cuenta.
 */

import type { AccountingSettingsAccountField } from '@/shared/lib/accounts/settings-account-labels';

import { buildMissingSettingsAccountsMessage } from './settings-accounts';

/** Campos de Ajustes que intervienen en el asiento del egreso. */
export type ExpenseEntryField = Extract<
  AccountingSettingsAccountField,
  'expensesAccountId' | 'payablesAccountId'
>;

/** De dónde sale la cuenta del Debe al confirmar. */
export type ExpenseDebitSource = 'category' | 'default';

/** Origen que muestra el detalle: la del asiento (confirmado) o la prevista (borrador). */
export type ExpenseDebitAccountOrigin = ExpenseDebitSource | 'entry';

/** Dónde se gestionan las categorías (el "dónde" de los mensajes). */
export const EXPENSE_CATEGORIES_PATH = 'Comercial → Egresos → Categorías';

export interface ResolveExpenseDebitAccountInput {
  /** `ExpenseCategory.accountId` del egreso. */
  categoryAccountId: string | null | undefined;
  /** `AccountingSettings.expensesAccountId` ("Cuenta de egresos por defecto"). */
  defaultAccountId: string | null | undefined;
}

export interface ResolvedExpenseDebitAccount {
  accountId: string;
  source: ExpenseDebitSource;
}

/**
 * Cuenta del Debe: la de la categoría; si no tiene, la por defecto; si tampoco, null.
 * `''` cuenta como vacío (mismo criterio `||` que `findMissingSettingsAccounts`).
 * No decide imputabilidad: si la de la categoría no es imputable, el llamador BLOQUEA.
 */
export function resolveExpenseDebitAccount(
  input: ResolveExpenseDebitAccountInput
): ResolvedExpenseDebitAccount | null {
  if (input.categoryAccountId) return { accountId: input.categoryAccountId, source: 'category' };
  if (input.defaultAccountId) return { accountId: input.defaultAccountId, source: 'default' };
  return null;
}

/**
 * Campos de Ajustes que el asiento exige según la categoría, en el orden de TSK-728:
 * con cuenta propia → ['payablesAccountId']; sin cuenta → ['expensesAccountId', 'payablesAccountId'].
 */
export function requiredExpenseSettingsFields(
  categoryAccountId: string | null | undefined
): ExpenseEntryField[] {
  return categoryAccountId ? ['payablesAccountId'] : ['expensesAccountId', 'payablesAccountId'];
}

/**
 * Mensaje de faltantes de TSK-728 y, si falta `expensesAccountId`, la segunda salida:
 * reemplaza el punto final por `, o asignale una cuenta contable a la categoría "X" en
 * Comercial → Egresos → Categorías.` Con solo `payablesAccountId` es el mensaje de TSK-728.
 */
export function buildMissingExpenseAccountsMessage(
  documentLabel: string,
  missing: readonly AccountingSettingsAccountField[],
  categoryName: string
): string {
  const base = buildMissingSettingsAccountsMessage(documentLabel, missing);
  if (!missing.includes('expensesAccountId')) return base;
  return (
    `${base.slice(0, -1)}, o asignale una cuenta contable a la categoría "${categoryName}" ` +
    `en ${EXPENSE_CATEGORIES_PATH}.`
  );
}

/**
 * La cuenta propia de la categoría no es imputable (o ya no existe). Nombra la
 * categoría, la cuenta y dónde corregirla (en la categoría, no en Ajustes).
 */
export function buildCategoryAccountNotImputableMessage(
  documentLabel: string,
  categoryName: string,
  accountLabel: string | null
): string {
  const problem = accountLabel
    ? `la cuenta ${accountLabel} de la categoría "${categoryName}" no está activa o no es imputable`
    : `la cuenta contable de la categoría "${categoryName}" ya no existe en el plan de cuentas`;
  return `No se puede confirmar ${documentLabel}: ${problem}. Corregila en ${EXPENSE_CATEGORIES_PATH}.`;
}

const ORIGIN_DESCRIPTIONS: Record<ExpenseDebitAccountOrigin, string> = {
  entry: 'del asiento',
  category: 'de la categoría',
  default: 'por defecto',
};

/** Texto del origen para la UI (D6). */
export function describeExpenseDebitSource(origin: ExpenseDebitAccountOrigin): string {
  return ORIGIN_DESCRIPTIONS[origin];
}

/**
 * Input de la línea de Debe. PUNTO DE EXTENSIÓN TSK-738: sumará `costCenterId?: string`
 * acá y en `ExpenseDebitLine`, y `buildExpenseDebitLine` lo copiará a la línea; los
 * llamadores (`createJournalEntryForExpense`) no cambian de forma.
 */
export interface ExpenseDebitLineInput {
  accountId: string;
  amount: number;
  fullNumber: string;
  description: string;
}

/** Estructuralmente compatible con `JournalEntryLineInput` del asiento. */
export interface ExpenseDebitLine {
  accountId: string;
  debit: number;
  credit: 0;
  description: string;
  costCenterId?: string;
}

/** Línea de Debe del asiento del egreso: `Gasto GTO-00001 - <descripción>`. */
export function buildExpenseDebitLine(input: ExpenseDebitLineInput): ExpenseDebitLine {
  return {
    accountId: input.accountId,
    debit: input.amount,
    credit: 0,
    description: `Gasto ${input.fullNumber} - ${input.description}`,
  };
}

/** Lo que muestra "Cuenta contable" en el detalle del egreso (D6). */
export type ExpenseDebitAccountView =
  | { origin: ExpenseDebitAccountOrigin; label: string }
  | { origin: 'missing'; label: null };

export interface BuildExpenseDebitAccountViewInput {
  /** `code - name` de la línea de Debe del asiento (egreso confirmado), o null. */
  entryAccountLabel: string | null;
  /** `code - name` de la cuenta de la categoría, o null si no tiene. */
  categoryAccountLabel: string | null;
  /** `code - name` de la cuenta de egresos por defecto, o null si no está configurada. */
  defaultAccountLabel: string | null;
}

/** Asiento > categoría > por defecto > 'missing' (borrador sin ninguna cuenta). */
export function buildExpenseDebitAccountView(
  input: BuildExpenseDebitAccountViewInput
): ExpenseDebitAccountView {
  if (input.entryAccountLabel) return { origin: 'entry', label: input.entryAccountLabel };
  if (input.categoryAccountLabel) return { origin: 'category', label: input.categoryAccountLabel };
  if (input.defaultAccountLabel) return { origin: 'default', label: input.defaultAccountLabel };
  return { origin: 'missing', label: null };
}
