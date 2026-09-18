import type { Prisma } from '@/generated/prisma/client';
import type { ProductUsage } from '@/generated/prisma/enums';

/**
 * Helper puro del facet "Imputación" del listado de ítems y de los badges
 * "Sin ingreso" / "Sin egreso" de la columna homónima (TSK-721).
 *
 * La idea central: a un ítem le falta una cuenta SOLO si le aplica por su
 * uso. A uno solo de compra no le falta la de ingresos, y viceversa.
 *
 * Sin cliente Prisma (solo tipos): se testea con Vitest sin base.
 */

/** Valores del facet "Imputación" del listado (columna `imputation`). */
export type ImputationFilterValue = 'noIncome' | 'noExpense';

/** Ítems a los que les aplica la cuenta de ingresos: se venden. */
export const INCOME_USAGES: ProductUsage[] = ['SALE', 'PURCHASE_SALE'];
/** Ítems a los que les aplica la cuenta de egresos: se compran. */
export const EXPENSE_USAGES: ProductUsage[] = ['PURCHASE', 'PURCHASE_SALE'];

/** Ítem que se vende y no tiene Cuenta de Ingresos propia (cae en la por defecto). */
export const missingIncomeWhere: Prisma.ProductWhereInput = {
  usage: { in: INCOME_USAGES },
  defaultIncomeAccountId: null,
};
/** Ítem que se compra y no tiene Cuenta de Egresos propia (cae en la por defecto). */
export const missingExpenseWhere: Prisma.ProductWhereInput = {
  usage: { in: EXPENSE_USAGES },
  defaultExpenseAccountId: null,
};

/** Lo mínimo del ítem que necesita la columna "Imputación" para decidir qué badge mostrar. */
export interface ImputationCheck {
  usage: ProductUsage;
  defaultIncomeAccountId: string | null;
  defaultExpenseAccountId: string | null;
}

/**
 * Qué cuentas le faltan a un ítem SEGÚN SU USO. Lo usa la columna
 * "Imputación" para los badges "Sin ingreso" / "Sin egreso".
 */
export function missingImputations(product: ImputationCheck): ImputationFilterValue[] {
  const missing: ImputationFilterValue[] = [];
  if (INCOME_USAGES.includes(product.usage) && !product.defaultIncomeAccountId) {
    missing.push('noIncome');
  }
  if (EXPENSE_USAGES.includes(product.usage) && !product.defaultExpenseAccountId) {
    missing.push('noExpense');
  }
  return missing;
}

/**
 * Condición Prisma del filtro "Imputación" del listado: los valores elegidos
 * se combinan con OR. Sin valores devuelve `{}` (no filtra).
 */
export function buildImputationWhere(values: string[]): Prisma.ProductWhereInput {
  const conditions: Prisma.ProductWhereInput[] = [
    ...(values.includes('noIncome') ? [missingIncomeWhere] : []),
    ...(values.includes('noExpense') ? [missingExpenseWhere] : []),
  ];
  return conditions.length > 0 ? { OR: conditions } : {};
}
