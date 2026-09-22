import { describe, expect, it } from 'vitest';

import {
  buildMissingSettingsAccountsMessage,
  findMissingSettingsAccounts,
  withholdingSettingsField,
} from './settings-accounts';

/**
 * TSK-728: antes de abrir la transacción, el confirm de recibos, OP y gastos
 * pregunta qué cuentas de Ajustes le faltan y arma un mensaje con el nombre
 * exacto del campo, en vez de dejar el comprobante confirmado sin asiento.
 */
describe('cuentas de Ajustes que faltan', () => {
  it('devuelve solo las requeridas que están en null', () => {
    expect(
      findMissingSettingsAccounts(
        { receivablesAccountId: 'X', withholdingIibbSufferedAccountId: null },
        ['receivablesAccountId', 'withholdingIibbSufferedAccountId']
      )
    ).toEqual(['withholdingIibbSufferedAccountId']);
  });

  /** Un `''` que venga del formulario o de un select vacío es "sin cuenta", no una cuenta. */
  it('trata la cadena vacía y el campo ausente como faltantes', () => {
    expect(
      findMissingSettingsAccounts({ receivablesAccountId: '' }, [
        'receivablesAccountId',
        'defaultCashAccountId',
      ])
    ).toEqual(['receivablesAccountId', 'defaultCashAccountId']);
  });

  it('sin faltantes devuelve una lista vacía', () => {
    expect(
      findMissingSettingsAccounts({ receivablesAccountId: 'X', payablesAccountId: 'Y' }, [
        'receivablesAccountId',
        'payablesAccountId',
      ])
    ).toEqual([]);
  });

  it('conserva el orden de las requeridas', () => {
    expect(
      findMissingSettingsAccounts({}, [
        'withholdingSussSufferedAccountId',
        'payablesAccountId',
        'expensesAccountId',
      ])
    ).toEqual(['withholdingSussSufferedAccountId', 'payablesAccountId', 'expensesAccountId']);
  });
});

describe('campo de Ajustes de cada retención', () => {
  it('resuelve los cuatro tipos por rol', () => {
    expect(withholdingSettingsField('IVA', 'emitted')).toBe('withholdingIvaEmittedAccountId');
    expect(withholdingSettingsField('GANANCIAS', 'emitted')).toBe(
      'withholdingGananciasEmittedAccountId'
    );
    expect(withholdingSettingsField('IIBB', 'emitted')).toBe('withholdingIibbEmittedAccountId');
    expect(withholdingSettingsField('SUSS', 'emitted')).toBe('withholdingSussEmittedAccountId');
    expect(withholdingSettingsField('IVA', 'suffered')).toBe('withholdingIvaSufferedAccountId');
    expect(withholdingSettingsField('GANANCIAS', 'suffered')).toBe(
      'withholdingGananciasSufferedAccountId'
    );
    expect(withholdingSettingsField('IIBB', 'suffered')).toBe('withholdingIibbSufferedAccountId');
    expect(withholdingSettingsField('SUSS', 'suffered')).toBe('withholdingSussSufferedAccountId');
  });
});

describe('mensaje de cuentas de Ajustes faltantes', () => {
  it('nombra el comprobante, los campos con su label real y dónde se configuran', () => {
    const mensaje = buildMissingSettingsAccountsMessage('el recibo R-00012', [
      'receivablesAccountId',
      'withholdingIibbSufferedAccountId',
    ]);

    expect(mensaje).toBe(
      'No se puede confirmar el recibo R-00012: falta configurar "Cuentas por Cobrar" y ' +
        '"Ret. IIBB Sufrida" en Contabilidad → Configuración.'
    );
  });

  it('con un solo campo no dice "y"', () => {
    expect(
      buildMissingSettingsAccountsMessage('la orden de pago OP-00003', ['payablesAccountId'])
    ).toBe(
      'No se puede confirmar la orden de pago OP-00003: falta configurar "Cuentas por Pagar" ' +
        'en Contabilidad → Configuración.'
    );
  });

  it('con tres campos usa comas y "y" antes del último', () => {
    expect(
      buildMissingSettingsAccountsMessage('el gasto G-00007', [
        'expensesAccountId',
        'vatCreditAccountId',
        'payablesAccountId',
      ])
    ).toContain(
      'falta configurar "Cuenta de Gastos Operativos", "IVA Crédito Fiscal" y "Cuentas por Pagar" en'
    );
  });
});
