import { describe, expect, it } from 'vitest';

import { settingsAccountLabel } from '@/shared/lib/accounts/settings-account-labels';

import {
  buildCategoryAccountNotImputableMessage,
  buildExpenseDebitAccountView,
  buildExpenseDebitLine,
  buildMissingExpenseAccountsMessage,
  describeExpenseDebitSource,
  requiredExpenseSettingsFields,
  resolveExpenseDebitAccount,
} from './expense-accounts';
import { buildMissingSettingsAccountsMessage } from './settings-accounts';

/**
 * TSK-757: el Debe del egreso va a la cuenta de su categoría; si la categoría no
 * tiene, a la "Cuenta de egresos por defecto" de Ajustes; si tampoco, no se
 * confirma. Estas funciones son la única fuente de esa regla (pre-validación,
 * presupuesto, asiento y detalle la comparten).
 */
describe('resolveExpenseDebitAccount', () => {
  it('P1: usa la cuenta de la categoría aunque no haya cuenta por defecto', () => {
    expect(resolveExpenseDebitAccount({ categoryAccountId: 'c', defaultAccountId: null })).toEqual({
      accountId: 'c',
      source: 'category',
    });
  });

  it('P2: la cuenta de la categoría gana sobre la por defecto', () => {
    expect(resolveExpenseDebitAccount({ categoryAccountId: 'c', defaultAccountId: 'd' })).toEqual({
      accountId: 'c',
      source: 'category',
    });
  });

  it('P3: sin cuenta en la categoría usa la por defecto', () => {
    expect(resolveExpenseDebitAccount({ categoryAccountId: null, defaultAccountId: 'd' })).toEqual({
      accountId: 'd',
      source: 'default',
    });
  });

  it('P4: sin ninguna de las dos devuelve null', () => {
    expect(resolveExpenseDebitAccount({ categoryAccountId: null, defaultAccountId: null })).toBeNull();
    expect(
      resolveExpenseDebitAccount({ categoryAccountId: undefined, defaultAccountId: undefined })
    ).toBeNull();
  });

  it('P5: la cadena vacía cuenta como "sin cuenta"', () => {
    expect(resolveExpenseDebitAccount({ categoryAccountId: '', defaultAccountId: 'd' })).toEqual({
      accountId: 'd',
      source: 'default',
    });
    expect(resolveExpenseDebitAccount({ categoryAccountId: '', defaultAccountId: '' })).toBeNull();
  });
});

describe('requiredExpenseSettingsFields', () => {
  it('P6: con cuenta propia solo exige Cuentas por Pagar; sin cuenta exige las dos', () => {
    expect(requiredExpenseSettingsFields('c')).toEqual(['payablesAccountId']);
    expect(requiredExpenseSettingsFields(null)).toEqual(['expensesAccountId', 'payablesAccountId']);
    expect(requiredExpenseSettingsFields(undefined)).toEqual([
      'expensesAccountId',
      'payablesAccountId',
    ]);
    expect(requiredExpenseSettingsFields('')).toEqual(['expensesAccountId', 'payablesAccountId']);
  });
});

describe('buildMissingExpenseAccountsMessage', () => {
  it('P7: si falta la por defecto, nombra la categoría como segunda salida', () => {
    const message = buildMissingExpenseAccountsMessage(
      'el gasto GTO-00001',
      ['expensesAccountId', 'payablesAccountId'],
      'Alquiler'
    );
    expect(message).toContain(
      `falta configurar ${settingsAccountLabel('expensesAccountId')} y "Cuentas por Pagar" en Contabilidad → Configuración`
    );
    expect(message).toContain(
      'o asignale una cuenta contable a la categoría "Alquiler" en Comercial → Egresos → Categorías.'
    );
    expect(message.startsWith('No se puede confirmar el gasto GTO-00001: ')).toBe(true);
  });

  it('P8: si falta solo Cuentas por Pagar, es exactamente el mensaje de TSK-728', () => {
    expect(
      buildMissingExpenseAccountsMessage('el gasto GTO-00001', ['payablesAccountId'], 'Alquiler')
    ).toBe(buildMissingSettingsAccountsMessage('el gasto GTO-00001', ['payablesAccountId']));
  });
});

describe('buildCategoryAccountNotImputableMessage', () => {
  it('P9: nombra la cuenta, la categoría y dónde corregirla', () => {
    expect(
      buildCategoryAccountNotImputableMessage('el gasto GTO-00001', 'Alquiler', '5.2.03 - Alquileres')
    ).toBe(
      'No se puede confirmar el gasto GTO-00001: la cuenta 5.2.03 - Alquileres de la categoría ' +
        '"Alquiler" no está activa o no es imputable. Corregila en Comercial → Egresos → Categorías.'
    );
  });

  it('P10: si la cuenta ya no existe lo dice', () => {
    const message = buildCategoryAccountNotImputableMessage('el gasto GTO-00001', 'Alquiler', null);
    expect(message).toContain(
      'la cuenta contable de la categoría "Alquiler" ya no existe en el plan de cuentas'
    );
    expect(message).toContain('Corregila en Comercial → Egresos → Categorías.');
  });
});

describe('buildExpenseDebitLine', () => {
  it('P11: arma la línea de Debe del asiento, sin centro de costo', () => {
    const line = buildExpenseDebitLine({
      accountId: 'acc-1',
      amount: 1000,
      fullNumber: 'GTO-00001',
      description: 'Alquiler',
    });
    expect(line).toEqual({
      accountId: 'acc-1',
      debit: 1000,
      credit: 0,
      description: 'Gasto GTO-00001 - Alquiler',
    });
    expect('costCenterId' in line).toBe(false);
  });
});

describe('buildExpenseDebitAccountView', () => {
  it('P12: si hay asiento, manda la cuenta del asiento', () => {
    expect(
      buildExpenseDebitAccountView({
        entryAccountLabel: '5.2.01 - Gastos',
        categoryAccountLabel: '5.2.03 - Alquileres',
        defaultAccountLabel: '5.2.99 - Varios',
      })
    ).toEqual({ origin: 'entry', label: '5.2.01 - Gastos' });
  });

  it('P13: sin asiento, categoría > por defecto > sin cuenta', () => {
    expect(
      buildExpenseDebitAccountView({
        entryAccountLabel: null,
        categoryAccountLabel: '5.2.03 - Alquileres',
        defaultAccountLabel: '5.2.99 - Varios',
      })
    ).toEqual({ origin: 'category', label: '5.2.03 - Alquileres' });
    expect(
      buildExpenseDebitAccountView({
        entryAccountLabel: null,
        categoryAccountLabel: null,
        defaultAccountLabel: '5.2.99 - Varios',
      })
    ).toEqual({ origin: 'default', label: '5.2.99 - Varios' });
    expect(
      buildExpenseDebitAccountView({
        entryAccountLabel: null,
        categoryAccountLabel: null,
        defaultAccountLabel: null,
      })
    ).toEqual({ origin: 'missing', label: null });
  });
});

describe('describeExpenseDebitSource', () => {
  it('P14: texto de cada origen', () => {
    expect(describeExpenseDebitSource('entry')).toBe('del asiento');
    expect(describeExpenseDebitSource('category')).toBe('de la categoría');
    expect(describeExpenseDebitSource('default')).toBe('por defecto');
  });
});
