import { describe, expect, it } from 'vitest';

import { ACCOUNTING_SETTINGS_PATH } from '@/shared/lib/accounts/settings-account-labels';

import {
  buildMissingPaymentAccountMessage,
  buildOmittedPaymentWarning,
  buildPartnerRepaymentOmittedMessage,
  buildSingleLineEntryMessage,
  classifyPayments,
  describePayment,
  endorsedEcheqLabel,
  paymentBankLabel,
  resolvePaymentAccount,
  type EntryDocumentKind,
  type PaymentAccountCheck,
  type PaymentAccountSettings,
} from './payment-accounts';

/**
 * TSK-728: la cadena de resolución de la cuenta de un pago (caja/banco propia
 * → por defecto de Ajustes) era una copia literal en el asiento del recibo y
 * en el de la OP, y cuando no resolvía nada hacía `continue`: asiento
 * descuadrado, comprobante confirmado sin asiento y nadie se enteraba.
 *
 * Los importes salen de `formatCurrency` (es-AR), que separa el símbolo con un
 * espacio duro: por eso los mensajes esperados escriben `$\u00a01.000,00`.
 */

const CAJA = { name: 'Caja principal', accountId: 'CTA-CAJA' };
const CAJA_SIN_CUENTA = { name: 'Caja principal', accountId: null };
const BANCO = { bankName: 'Banco Galicia', accountNumber: '123-456', accountId: 'CTA-BANCO' };
const BANCO_SIN_CUENTA = { bankName: 'Banco Galicia', accountNumber: '123-456', accountId: null };
const SIN_DEFAULTS = { defaultCashAccountId: null, defaultBankAccountId: null };
const CON_DEFAULTS = { defaultCashAccountId: 'DC', defaultBankAccountId: 'DB' };

const resolve = (
  payment: PaymentAccountCheck,
  settings: PaymentAccountSettings,
  kind: EntryDocumentKind = 'receipt'
) => resolvePaymentAccount(payment, settings, kind);
const classify = <T extends PaymentAccountCheck>(
  payments: readonly T[],
  settings: PaymentAccountSettings,
  kind: EntryDocumentKind = 'receipt'
) => classifyPayments(payments, settings, kind);

function pago(overrides: Partial<PaymentAccountCheck> = {}): PaymentAccountCheck {
  return {
    paymentMethod: 'CASH',
    amount: 1000,
    cashRegisterId: null,
    bankAccountId: null,
    ...overrides,
  };
}

describe('resolución de la cuenta de un pago', () => {
  it('efectivo con caja que tiene cuenta propia → la cuenta de la caja', () => {
    expect(resolve(pago({ cashRegisterId: 'caja', cashRegister: CAJA }), CON_DEFAULTS)).toEqual({
      kind: 'resolved',
      accountId: 'CTA-CAJA',
      source: 'cashRegister',
    });
  });

  it('caja sin cuenta propia cae en la "Caja por Defecto"', () => {
    expect(
      resolve(pago({ cashRegisterId: 'caja', cashRegister: CAJA_SIN_CUENTA }), CON_DEFAULTS)
    ).toEqual({ kind: 'resolved', accountId: 'DC', source: 'defaultCash' });
  });

  it('caja sin cuenta propia ni por defecto → falta obligatoria de la caja', () => {
    expect(
      resolve(pago({ cashRegisterId: 'caja', cashRegister: CAJA_SIN_CUENTA }), SIN_DEFAULTS)
    ).toEqual({ kind: 'missing', via: 'cashRegister' });
  });

  it('transferencia con banco que tiene cuenta propia → la cuenta del banco', () => {
    expect(
      resolve(
        pago({ paymentMethod: 'TRANSFER', bankAccountId: 'banco', bankAccount: BANCO }),
        CON_DEFAULTS
      )
    ).toEqual({ kind: 'resolved', accountId: 'CTA-BANCO', source: 'bankAccount' });
  });

  it('banco sin cuenta propia cae en el "Banco por Defecto"', () => {
    expect(
      resolve(
        pago({ paymentMethod: 'TRANSFER', bankAccountId: 'banco', bankAccount: BANCO_SIN_CUENTA }),
        CON_DEFAULTS
      )
    ).toEqual({ kind: 'resolved', accountId: 'DB', source: 'defaultBank' });
  });

  it('banco sin cuenta propia ni por defecto → falta obligatoria del banco', () => {
    expect(
      resolve(
        pago({ paymentMethod: 'ECHEQ', bankAccountId: 'banco', bankAccount: BANCO_SIN_CUENTA }),
        SIN_DEFAULTS,
        'paymentOrder'
      )
    ).toEqual({ kind: 'missing', via: 'bankAccount' });
  });

  /** Es el orden actual del asiento (`index.ts:740-750`): caja propia > banco propio > defaults. */
  it('la caja gana sobre el banco si vinieran los dos', () => {
    expect(
      resolve(
        pago({
          cashRegisterId: 'caja',
          cashRegister: CAJA,
          bankAccountId: 'banco',
          bankAccount: BANCO,
        }),
        CON_DEFAULTS
      )
    ).toEqual({ kind: 'resolved', accountId: 'CTA-CAJA', source: 'cashRegister' });
  });

  /** `''` en un id o una cuenta es "sin valor", no un id. */
  it('trata la cadena vacía como ausencia', () => {
    expect(
      resolve(pago({ cashRegisterId: 'caja', cashRegister: { name: 'Caja', accountId: '' } }), {
        defaultCashAccountId: '',
        defaultBankAccountId: null,
      })
    ).toEqual({ kind: 'missing', via: 'cashRegister' });
    expect(resolve(pago({ cashRegisterId: '' }), CON_DEFAULTS)).toEqual({
      kind: 'missing',
      via: 'noCashRegister',
    });
  });

  it('efectivo sin caja → falta la caja (borrador viejo, el Zod ya no lo permite)', () => {
    expect(resolve(pago(), CON_DEFAULTS)).toEqual({
      kind: 'missing',
      via: 'noCashRegister',
    });
  });

  it('transferencia o débito de la empresa sin banco → falta el banco', () => {
    expect(resolve(pago({ paymentMethod: 'TRANSFER' }), CON_DEFAULTS)).toEqual({
      kind: 'missing',
      via: 'noBankAccount',
    });
    expect(resolve(pago({ paymentMethod: 'DEBIT_CARD' }), CON_DEFAULTS)).toEqual({
      kind: 'missing',
      via: 'noBankAccount',
    });
    expect(
      resolve(
        pago({
          paymentMethod: 'DEBIT_CARD',
          card: { name: 'Visa Débito Empresa', ownerType: 'COMPANY' },
        }),
        CON_DEFAULTS
      )
    ).toEqual({ kind: 'missing', via: 'noBankAccount' });
  });

  it('e-cheq sin banco → falta el banco (se imputa al banco como hoy)', () => {
    expect(resolve(pago({ paymentMethod: 'ECHEQ' }), CON_DEFAULTS, 'paymentOrder')).toEqual({
      kind: 'missing',
      via: 'noBankAccount',
    });
  });

  it('tarjeta de socio → Deudas con socios, aunque traiga un banco con cuenta', () => {
    const socio = pago({
      paymentMethod: 'DEBIT_CARD',
      bankAccountId: 'banco',
      bankAccount: BANCO,
      card: { name: 'Visa Galicia Socio', ownerType: 'PARTNER' },
    });
    expect(resolve(socio, { partnerDebtsAccountId: 'SOC' }, 'paymentOrder')).toEqual({
      kind: 'resolved',
      accountId: 'SOC',
      source: 'partnerDebts',
    });
    expect(resolve(socio, CON_DEFAULTS, 'paymentOrder')).toEqual({
      kind: 'missing',
      via: 'settings:partnerDebtsAccountId',
    });
  });

  it('cheque o e-cheq en un recibo → Valores a depositar, ignora el banco elegido', () => {
    const echeq = pago({
      paymentMethod: 'ECHEQ',
      bankAccountId: 'b1',
      bankAccount: { ...BANCO, accountId: 'bankAcc' },
    });
    expect(resolve(echeq, { checksReceivedAccountId: 'vad' }, 'receipt')).toEqual({
      kind: 'resolved',
      accountId: 'vad',
      source: 'checksReceived',
    });
    expect(
      resolve(pago({ paymentMethod: 'CHECK', checkNumber: '1' }), CON_DEFAULTS, 'receipt')
    ).toEqual({ kind: 'missing', via: 'settings:checksReceivedAccountId' });
  });

  it('cheque endosado en una OP con cuenta registrada → esa cuenta', () => {
    const endosado = pago({
      paymentMethod: 'CHECK',
      endorsedCheckId: 'chk',
      endorsedCheck: { accountId: 'REG', customerId: 'c1', isElectronic: false, bankAccount: null },
    });
    expect(resolve(endosado, {}, 'paymentOrder')).toEqual({
      kind: 'resolved',
      accountId: 'REG',
      source: 'endorsedCheck',
    });
  });

  it('endoso histórico físico → Cuentas por Cobrar con el cliente del cheque', () => {
    const historico = pago({
      paymentMethod: 'CHECK',
      endorsedCheckId: 'chk',
      endorsedCheck: { accountId: null, customerId: 'c1', isElectronic: false, bankAccount: null },
    });
    expect(resolve(historico, { receivablesAccountId: 'cobrar' }, 'paymentOrder')).toEqual({
      kind: 'resolved',
      accountId: 'cobrar',
      source: 'endorsedLegacyReceivable',
      customerId: 'c1',
    });
    expect(resolve(historico, {}, 'paymentOrder')).toEqual({
      kind: 'missing',
      via: 'settings:receivablesAccountId',
    });
  });

  it('endoso histórico electrónico → banco del cheque, luego Banco por Defecto, luego falta', () => {
    const echeqHistorico = (bankAccountAccountId: string | null) =>
      pago({
        paymentMethod: 'ECHEQ',
        endorsedCheckId: 'chk',
        endorsedCheck: {
          accountId: null,
          customerId: 'c1',
          isElectronic: true,
          bankAccount: { accountId: bankAccountAccountId },
        },
      });
    expect(resolve(echeqHistorico('BCH'), CON_DEFAULTS, 'paymentOrder')).toEqual({
      kind: 'resolved',
      accountId: 'BCH',
      source: 'bankAccount',
    });
    expect(resolve(echeqHistorico(null), CON_DEFAULTS, 'paymentOrder')).toEqual({
      kind: 'resolved',
      accountId: 'DB',
      source: 'defaultBank',
    });
    expect(resolve(echeqHistorico(null), SIN_DEFAULTS, 'paymentOrder')).toEqual({
      kind: 'missing',
      via: 'noBankAccount',
    });
  });

  it('cheque propio en una OP → Valores diferidos a pagar', () => {
    const propio = pago({ paymentMethod: 'CHECK', checkNumber: '9' });
    expect(resolve(propio, { checksPayableAccountId: 'dif' }, 'paymentOrder')).toEqual({
      kind: 'resolved',
      accountId: 'dif',
      source: 'checksPayable',
    });
    expect(resolve(propio, CON_DEFAULTS, 'paymentOrder')).toEqual({
      kind: 'missing',
      via: 'settings:checksPayableAccountId',
    });
  });

  it('e-cheq propio en una OP → cadena de banco, sin cambio', () => {
    expect(
      resolve(
        pago({ paymentMethod: 'ECHEQ', bankAccountId: 'banco', bankAccount: BANCO }),
        CON_DEFAULTS,
        'paymentOrder'
      )
    ).toEqual({ kind: 'resolved', accountId: 'CTA-BANCO', source: 'bankAccount' });
    expect(resolve(pago({ paymentMethod: 'ECHEQ' }), CON_DEFAULTS, 'paymentOrder')).toEqual({
      kind: 'missing',
      via: 'noBankAccount',
    });
  });

  it('tarjeta de crédito de la empresa → Tarjetas de crédito a pagar', () => {
    const tarjeta = pago({
      paymentMethod: 'CREDIT_CARD',
      card: { name: 'Visa', ownerType: 'COMPANY' },
    });
    expect(resolve(tarjeta, { creditCardsPayableAccountId: 'tc' }, 'paymentOrder')).toEqual({
      kind: 'resolved',
      accountId: 'tc',
      source: 'creditCardsPayable',
    });
    const sinCuenta = resolve(tarjeta, CON_DEFAULTS, 'paymentOrder');
    expect(sinCuenta).toEqual({ kind: 'missing', via: 'settings:creditCardsPayableAccountId' });
    if (sinCuenta.kind !== 'missing') throw new Error('esperaba missing');
    expect(
      buildMissingPaymentAccountMessage('la orden de pago OP-00001', {
        payment: tarjeta,
        via: sinCuenta.via,
      })
    ).toBe(
      'No se puede confirmar la orden de pago OP-00001: Tarjeta de Crédito por $\u00a01.000,00 ' +
        'necesita la cuenta "Tarjetas de crédito a pagar". Configurala en ' +
        `${ACCOUNTING_SETTINGS_PATH}.`
    );
  });

  it('tarjeta de crédito en un recibo → omitida (cobro de un cliente)', () => {
    const cobro = pago({ paymentMethod: 'CREDIT_CARD' });
    expect(resolve(cobro, { creditCardsPayableAccountId: 'tc' }, 'receipt')).toEqual({
      kind: 'omitted',
      reason: 'CUSTOMER_CREDIT_CARD',
    });
    expect(classify([cobro], CON_DEFAULTS, 'receipt').omittedAmount).toBe(1000);
  });

  it('tarjeta de crédito de un socio en una OP → Deudas con socios (gana sobre la fila 8)', () => {
    const socio = pago({
      paymentMethod: 'CREDIT_CARD',
      card: { name: 'Visa Socio', ownerType: 'PARTNER' },
    });
    expect(
      resolve(
        socio,
        { partnerDebtsAccountId: 'SOC', creditCardsPayableAccountId: 'tc' },
        'paymentOrder'
      )
    ).toEqual({ kind: 'resolved', accountId: 'SOC', source: 'partnerDebts' });
  });

  it('"Cuenta Corriente" → omitido', () => {
    expect(resolve(pago({ paymentMethod: 'ACCOUNT' }), CON_DEFAULTS)).toEqual({
      kind: 'omitted',
      reason: 'ACCOUNT',
    });
  });
});

describe('clasificación de los pagos de un comprobante', () => {
  const efectivo = pago({ cashRegisterId: 'caja', cashRegister: CAJA, amount: 500 });
  const cheque = pago({ paymentMethod: 'CHECK', checkNumber: '123', amount: 300 });
  const transferenciaSinBanco = pago({ paymentMethod: 'TRANSFER', amount: 200 });
  const cuentaCorriente = pago({ paymentMethod: 'ACCOUNT', amount: 100.5 });
  const settings = { ...CON_DEFAULTS, checksReceivedAccountId: 'VAD' };

  it('separa resueltos, faltantes y omitidos conservando orden y objeto original', () => {
    const result = classify([efectivo, cheque, transferenciaSinBanco, cuentaCorriente], settings);

    expect(result.resolved).toEqual([
      { payment: efectivo, accountId: 'CTA-CAJA', source: 'cashRegister' },
      { payment: cheque, accountId: 'VAD', source: 'checksReceived' },
    ]);
    expect(result.resolved[0].payment).toBe(efectivo);
    expect(result.missing).toEqual([{ payment: transferenciaSinBanco, via: 'noBankAccount' }]);
    expect(result.omitted).toEqual([{ payment: cuentaCorriente, reason: 'ACCOUNT' }]);
  });

  it('omittedAmount es solo el importe de "Cuenta Corriente", redondeado a centavos', () => {
    expect(classify([efectivo, cheque, cuentaCorriente], settings).omittedAmount).toBe(100.5);
    expect(
      classify(
        [
          pago({ paymentMethod: 'ACCOUNT', amount: 0.1 }),
          pago({ paymentMethod: 'ACCOUNT', amount: 0.2 }),
        ],
        CON_DEFAULTS
      ).omittedAmount
    ).toBe(0.3);
  });

  it('el kind decide: el mismo cheque va a Valores a depositar o a Valores diferidos', () => {
    const s = { checksReceivedAccountId: 'VAD', checksPayableAccountId: 'DIF' };
    expect(classify([cheque], s, 'receipt').resolved[0].accountId).toBe('VAD');
    expect(classify([cheque], s, 'paymentOrder').resolved[0].accountId).toBe('DIF');
  });

  it('sin pagos devuelve listas vacías y cero', () => {
    expect(classify([], SIN_DEFAULTS)).toEqual({
      resolved: [],
      missing: [],
      omitted: [],
      omittedAmount: 0,
    });
  });
});

describe('cómo se nombra un pago', () => {
  it('cheque con número', () => {
    expect(describePayment(pago({ paymentMethod: 'CHECK', checkNumber: '123' }))).toBe(
      'Cheque N° 123 por $\u00a01.000,00'
    );
  });

  it('transferencia con banco', () => {
    expect(
      describePayment(
        pago({ paymentMethod: 'TRANSFER', bankAccountId: 'b', bankAccount: BANCO, amount: 25000 })
      )
    ).toBe('Transferencia (Banco Galicia 123-456) por $\u00a025.000,00');
  });

  it('efectivo con caja', () => {
    expect(describePayment(pago({ cashRegisterId: 'c', cashRegister: CAJA, amount: 1234.5 }))).toBe(
      'Efectivo (Caja principal) por $\u00a01.234,50'
    );
  });

  it('tarjeta con nombre', () => {
    expect(
      describePayment(
        pago({
          paymentMethod: 'CREDIT_CARD',
          card: { name: 'Visa Galicia Empresa', ownerType: 'COMPANY' },
        })
      )
    ).toBe('Tarjeta de Crédito (Visa Galicia Empresa) por $\u00a01.000,00');
  });

  it('sin detalle usa solo el medio', () => {
    expect(describePayment(pago({ paymentMethod: 'ACCOUNT' }))).toBe(
      'Cuenta Corriente por $\u00a01.000,00'
    );
    expect(describePayment(pago({ paymentMethod: 'CHECK' }))).toBe('Cheque por $\u00a01.000,00');
  });
});

describe('mensaje de caja/banco sin cuenta', () => {
  it('caja sin cuenta: nombra la caja, dónde se asigna y el ajuste por defecto', () => {
    expect(
      buildMissingPaymentAccountMessage('el recibo R-00012', {
        via: 'cashRegister',
        payment: pago({ cashRegisterId: 'c', cashRegister: CAJA_SIN_CUENTA }),
      })
    ).toBe(
      'No se puede confirmar el recibo R-00012: la caja "Caja principal" no tiene cuenta ' +
        'contable asociada. Configurala en Tesorería → Cajas o definí la "Caja por Defecto" ' +
        'en Contabilidad → Configuración.'
    );
  });

  it('banco sin cuenta: ídem con la cuenta bancaria', () => {
    expect(
      buildMissingPaymentAccountMessage('la orden de pago OP-00003', {
        via: 'bankAccount',
        payment: pago({
          paymentMethod: 'TRANSFER',
          bankAccountId: 'b',
          bankAccount: BANCO_SIN_CUENTA,
        }),
      })
    ).toBe(
      'No se puede confirmar la orden de pago OP-00003: la cuenta bancaria "Banco Galicia 123-456" ' +
        'no tiene cuenta contable asociada. Configurala en Tesorería → Cuentas Bancarias o definí ' +
        'el "Banco por Defecto" en Contabilidad → Configuración.'
    );
  });

  it('efectivo sin caja: manda a editar el comprobante', () => {
    expect(
      buildMissingPaymentAccountMessage('el recibo R-00012', {
        via: 'noCashRegister',
        payment: pago(),
      })
    ).toBe(
      'No se puede confirmar el recibo R-00012: el pago en Efectivo de $\u00a01.000,00 no tiene caja ' +
        'asignada. Editá el comprobante y elegí la caja.'
    );
  });

  it('transferencia sin banco: manda a editar el comprobante', () => {
    expect(
      buildMissingPaymentAccountMessage('la orden de pago OP-00003', {
        via: 'noBankAccount',
        payment: pago({ paymentMethod: 'DEBIT_CARD', amount: 2500 }),
      })
    ).toBe(
      'No se puede confirmar la orden de pago OP-00003: el pago en Tarjeta de Débito de ' +
        '$\u00a02.500,00 no tiene cuenta bancaria asignada. Editá el comprobante y elegí la cuenta bancaria.'
    );
  });
});

describe('aviso de pago omitido del asiento', () => {
  it('"Cuenta Corriente" no es un movimiento de fondos', () => {
    expect(
      buildOmittedPaymentWarning(
        { payment: pago({ paymentMethod: 'ACCOUNT' }), reason: 'ACCOUNT' },
        'receipt'
      )
    ).toBe(
      'Cuenta Corriente por $\u00a01.000,00 no genera línea en el asiento contable: "Cuenta ' +
        'Corriente" no representa un movimiento de fondos. Ese importe queda pendiente en ' +
        'Cuentas por Cobrar hasta que se regularice.'
    );
  });

  it('en una OP queda pendiente en Cuentas por Pagar', () => {
    expect(
      buildOmittedPaymentWarning(
        { payment: pago({ paymentMethod: 'ACCOUNT' }), reason: 'ACCOUNT' },
        'paymentOrder'
      )
    ).toContain('Cuentas por Pagar hasta que se regularice.');
  });
});

describe('asiento de una sola línea', () => {
  it('recibo: lista los pagos omitidos y qué agregar', () => {
    expect(
      buildSingleLineEntryMessage('el recibo R-00012', 'receipt', [
        { payment: pago({ paymentMethod: 'ACCOUNT' }), reason: 'ACCOUNT' },
      ])
    ).toBe(
      'No se puede confirmar el recibo R-00012: ningún pago genera línea contable (Cuenta Corriente ' +
        'por $\u00a01.000,00) y no hay retenciones, así que el asiento quedaría con una sola línea. ' +
        'Agregá un pago en efectivo, transferencia o cheque, o una retención.'
    );
  });

  it('OP: suma el débito de la empresa y separa varios pagos con coma', () => {
    expect(
      buildSingleLineEntryMessage('la orden de pago OP-00003', 'paymentOrder', [
        { payment: pago({ paymentMethod: 'ACCOUNT', amount: 9 }), reason: 'ACCOUNT' },
        { payment: pago({ paymentMethod: 'ACCOUNT', amount: 50 }), reason: 'ACCOUNT' },
      ])
    ).toBe(
      'No se puede confirmar la orden de pago OP-00003: ningún pago genera línea contable ' +
        '(Cuenta Corriente por $\u00a09,00, Cuenta Corriente por $\u00a050,00) y no hay retenciones, así que ' +
        'el asiento quedaría con una sola línea. Agregá un pago en efectivo, transferencia, ' +
        'cheque o tarjeta, o una retención.'
    );
  });

  it('sin ningún pago tampoco lista nada', () => {
    expect(buildSingleLineEntryMessage('el recibo R-00012', 'receipt', [])).toBe(
      'No se puede confirmar el recibo R-00012: no hay pagos ni retenciones, así que el asiento ' +
        'quedaría con una sola línea. Agregá un pago en efectivo, transferencia o cheque, o una ' +
        'retención.'
    );
  });
});

describe('OP de devolución a socio (TSK-735)', () => {
  it('un pago sin línea bloquea: el Debe son las cuotas y el asiento descuadraría', () => {
    expect(
      buildPartnerRepaymentOmittedMessage('la orden de pago OP-00007', {
        payment: pago({ paymentMethod: 'ACCOUNT', amount: 400 }),
        reason: 'ACCOUNT',
      })
    ).toBe(
      'No se puede confirmar la orden de pago OP-00007: Cuenta Corriente por $\u00a0400,00 no ' +
        'genera línea en el asiento contable ("Cuenta Corriente" no representa un movimiento de ' +
        'fondos) y la devolución al socio tiene que salir de una caja, un banco o un cheque. ' +
        'Elegí otro medio de pago.'
    );
  });
});

describe('cheque endosado inexistente o e-cheq endosado sin banco (TSK-735)', () => {
  const colgado = pago({ paymentMethod: 'CHECK', endorsedCheckId: 'chk', endorsedCheck: null });

  it('endorsedCheckId sin cheque cargado → falta, no cae al histórico', () => {
    expect(resolve(colgado, { receivablesAccountId: 'cobrar' }, 'paymentOrder')).toEqual({
      kind: 'missing',
      via: 'endorsedCheckNotFound',
    });
    expect(resolve({ ...colgado, endorsedCheck: undefined }, CON_DEFAULTS, 'paymentOrder')).toEqual(
      { kind: 'missing', via: 'endorsedCheckNotFound' }
    );
  });

  it('el mensaje manda a Tesorería → Cheques', () => {
    expect(
      buildMissingPaymentAccountMessage('la orden de pago OP-00003', {
        via: 'endorsedCheckNotFound',
        payment: colgado,
      })
    ).toBe(
      'No se puede confirmar la orden de pago OP-00003: el cheque endosado ya no existe en ' +
        'Tesorería → Cheques.'
    );
  });

  const echeq = (
    bankAccount: { accountId: string | null; bankName: string; accountNumber: string } | null
  ) =>
    pago({
      paymentMethod: 'ECHEQ',
      endorsedCheckId: 'chk',
      endorsedCheck: {
        accountId: null,
        customerId: 'c1',
        isElectronic: true,
        checkNumber: 'E-77',
        bankAccount,
      },
    });

  it('e-cheq endosado con banco sin cuenta: nombra el banco del cheque, no el de la línea', () => {
    const payment = echeq({ accountId: null, bankName: 'Banco Nación', accountNumber: '999' });
    expect(paymentBankLabel(payment)).toBe('Banco Nación 999');
    expect(
      buildMissingPaymentAccountMessage('la orden de pago OP-00003', {
        via: 'noBankAccount',
        payment,
      })
    ).toBe(
      'No se puede confirmar la orden de pago OP-00003: la cuenta bancaria "Banco Nación 999" del ' +
        'e-cheq endosado N° E-77 no tiene cuenta contable asociada. Configurala en Tesorería → ' +
        'Cuentas Bancarias o definí el "Banco por Defecto" en Contabilidad → Configuración.'
    );
  });

  it('e-cheq endosado sin banco: lo nombra por su número', () => {
    const payment = echeq(null);
    expect(paymentBankLabel(payment)).toBeNull();
    expect(endorsedEcheqLabel(payment)).toBe('e-cheq endosado N° E-77');
    expect(
      buildMissingPaymentAccountMessage('la orden de pago OP-00003', {
        via: 'noBankAccount',
        payment,
      })
    ).toBe(
      'No se puede confirmar la orden de pago OP-00003: el e-cheq endosado N° E-77 no tiene ' +
        'cuenta bancaria. Definí el "Banco por Defecto" en Contabilidad → Configuración.'
    );
  });

  it('pago con banco propio: la etiqueta es la de la línea', () => {
    expect(paymentBankLabel(pago({ bankAccountId: 'b', bankAccount: BANCO }))).toBe(
      'Banco Galicia 123-456'
    );
  });
});
