import { describe, expect, it } from 'vitest';

import { filterExpenseAccounts, filterIncomeAccounts } from './account-filters';

const CUENTAS = [
  { id: '1', code: '1.1.1/01', name: 'Caja', type: 'ASSET' },
  { id: '2', code: '1.2.3/05', name: 'Rodados', type: 'ASSET' },
  { id: '3', code: '2.1.1/01', name: 'Proveedores', type: 'LIABILITY' },
  { id: '4', code: '3.1.1/01', name: 'Capital social', type: 'EQUITY' },
  { id: '5', code: '4.2.1/02', name: 'Venta de servicios', type: 'REVENUE' },
  { id: '6', code: '5.1.1/03', name: 'Gastos de librería', type: 'EXPENSE' },
];

const codigos = (cuentas: { code: string }[]) => cuentas.map((c) => c.code);

describe('cuentas elegibles para imputar un ítem', () => {
  it('el selector de egresos ofrece gastos y activos', () => {
    expect(codigos(filterExpenseAccounts(CUENTAS))).toEqual([
      '1.1.1/01',
      '1.2.3/05',
      '5.1.1/03',
    ]);
  });

  it('el selector de ingresos ofrece ventas y activos', () => {
    expect(codigos(filterIncomeAccounts(CUENTAS))).toEqual([
      '1.1.1/01',
      '1.2.3/05',
      '4.2.1/02',
    ]);
  });

  it('ninguno de los dos ofrece pasivo ni patrimonio neto', () => {
    const ofrecidas = [
      ...codigos(filterExpenseAccounts(CUENTAS)),
      ...codigos(filterIncomeAccounts(CUENTAS)),
    ];

    expect(ofrecidas).not.toContain('2.1.1/01');
    expect(ofrecidas).not.toContain('3.1.1/01');
  });

  it('conserva el orden original del plan de cuentas', () => {
    expect(codigos(filterExpenseAccounts(CUENTAS))).toEqual(
      codigos(CUENTAS.filter((c) => ['1.1.1/01', '1.2.3/05', '5.1.1/03'].includes(c.code)))
    );
  });
});

/**
 * Regresión de TSK-579. La usuaria cargaba un ítem que es un activo ("puedo
 * comprar o vender un activo") y encontraba la cuenta 1... en el selector de
 * egresos pero no en el de ingresos, así que no podía completar la carga.
 *
 * El filtro usaba la naturaleza del saldo: las cuentas de activo son deudoras
 * (DEBIT), de modo que entraban en egresos y quedaban excluidas de ingresos por
 * construcción. La naturaleza describe cómo suma el saldo, no si la cuenta
 * puede comprarse o venderse; el criterio correcto es el tipo de cuenta.
 */
describe('un activo puede comprarse y venderse (TSK-579)', () => {
  const rodados = CUENTAS.find((c) => c.code === '1.2.3/05')!;

  it('aparece tanto en egresos como en ingresos', () => {
    expect(filterExpenseAccounts(CUENTAS)).toContain(rodados);
    expect(filterIncomeAccounts(CUENTAS)).toContain(rodados);
  });
});
