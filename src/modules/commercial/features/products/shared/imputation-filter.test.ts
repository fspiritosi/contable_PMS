import { describe, expect, it } from 'vitest';

import {
  EXPENSE_USAGES,
  INCOME_USAGES,
  buildImputationWhere,
  missingExpenseWhere,
  missingImputations,
  missingIncomeWhere,
} from './imputation-filter';

describe('qué cuentas le faltan a un ítem según su uso (TSK-721)', () => {
  it('un ítem solo de venta sin cuentas solo tiene pendiente la de ingresos', () => {
    expect(
      missingImputations({
        usage: 'SALE',
        defaultIncomeAccountId: null,
        defaultExpenseAccountId: null,
      })
    ).toEqual(['noIncome']);
  });

  it('un ítem solo de compra sin cuentas solo tiene pendiente la de egresos', () => {
    expect(
      missingImputations({
        usage: 'PURCHASE',
        defaultIncomeAccountId: null,
        defaultExpenseAccountId: null,
      })
    ).toEqual(['noExpense']);
  });

  it('un ítem de compra y venta sin cuentas tiene pendientes las dos, ingresos primero', () => {
    expect(
      missingImputations({
        usage: 'PURCHASE_SALE',
        defaultIncomeAccountId: null,
        defaultExpenseAccountId: null,
      })
    ).toEqual(['noIncome', 'noExpense']);
  });

  it('un ítem de compra y venta con las dos cuentas no tiene nada pendiente', () => {
    expect(
      missingImputations({
        usage: 'PURCHASE_SALE',
        defaultIncomeAccountId: 'cta-ingresos',
        defaultExpenseAccountId: 'cta-egresos',
      })
    ).toEqual([]);
  });

  it('un ítem de compra y venta con solo la de egresos tiene pendiente la de ingresos', () => {
    expect(
      missingImputations({
        usage: 'PURCHASE_SALE',
        defaultIncomeAccountId: null,
        defaultExpenseAccountId: 'cta-egresos',
      })
    ).toEqual(['noIncome']);
  });

  it('un ítem solo de compra con la de egresos no tiene nada pendiente aunque no tenga ingresos', () => {
    expect(
      missingImputations({
        usage: 'PURCHASE',
        defaultIncomeAccountId: null,
        defaultExpenseAccountId: 'cta-egresos',
      })
    ).toEqual([]);
  });
});

describe('condiciones Prisma del facet "Imputación" (TSK-721)', () => {
  it('los usos que venden son SALE y PURCHASE_SALE; los que compran, PURCHASE y PURCHASE_SALE', () => {
    expect(INCOME_USAGES).toEqual(['SALE', 'PURCHASE_SALE']);
    expect(EXPENSE_USAGES).toEqual(['PURCHASE', 'PURCHASE_SALE']);
  });

  it('"sin cuenta de ingreso" = se vende y no tiene cuenta de ingresos', () => {
    expect(missingIncomeWhere).toEqual({
      usage: { in: ['SALE', 'PURCHASE_SALE'] },
      defaultIncomeAccountId: null,
    });
  });

  it('"sin cuenta de egreso" = se compra y no tiene cuenta de egresos', () => {
    expect(missingExpenseWhere).toEqual({
      usage: { in: ['PURCHASE', 'PURCHASE_SALE'] },
      defaultExpenseAccountId: null,
    });
  });
});

describe('where del filtro "Imputación" del listado (TSK-721)', () => {
  it('sin valores no filtra', () => {
    expect(buildImputationWhere([])).toEqual({});
  });

  it('con un solo valor deja esa única condición dentro del OR', () => {
    expect(buildImputationWhere(['noExpense'])).toEqual({ OR: [missingExpenseWhere] });
  });

  it('con los dos valores los combina con OR (ingreso primero)', () => {
    expect(buildImputationWhere(['noIncome', 'noExpense'])).toEqual({
      OR: [missingIncomeWhere, missingExpenseWhere],
    });
  });

  it('ignora valores desconocidos', () => {
    expect(buildImputationWhere(['otro'])).toEqual({});
  });
});
