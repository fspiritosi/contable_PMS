import { describe, expect, it } from 'vitest';

import {
  buildMissingPaymentAccountMessage,
  buildOmittedPaymentWarning,
  buildPartnerOrderWarning,
  buildSingleLineEntryMessage,
  classifyPayments,
  describePayment,
  resolvePaymentAccount,
  type PaymentAccountCheck,
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
    expect(
      resolvePaymentAccount(pago({ cashRegisterId: 'caja', cashRegister: CAJA }), CON_DEFAULTS)
    ).toEqual({ kind: 'resolved', accountId: 'CTA-CAJA', source: 'cashRegister' });
  });

  it('caja sin cuenta propia cae en la "Caja por Defecto"', () => {
    expect(
      resolvePaymentAccount(
        pago({ cashRegisterId: 'caja', cashRegister: CAJA_SIN_CUENTA }),
        CON_DEFAULTS
      )
    ).toEqual({ kind: 'resolved', accountId: 'DC', source: 'defaultCash' });
  });

  it('caja sin cuenta propia ni por defecto → falta obligatoria de la caja', () => {
    expect(
      resolvePaymentAccount(
        pago({ cashRegisterId: 'caja', cashRegister: CAJA_SIN_CUENTA }),
        SIN_DEFAULTS
      )
    ).toEqual({ kind: 'missing', via: 'cashRegister' });
  });

  it('transferencia con banco que tiene cuenta propia → la cuenta del banco', () => {
    expect(
      resolvePaymentAccount(
        pago({ paymentMethod: 'TRANSFER', bankAccountId: 'banco', bankAccount: BANCO }),
        CON_DEFAULTS
      )
    ).toEqual({ kind: 'resolved', accountId: 'CTA-BANCO', source: 'bankAccount' });
  });

  it('banco sin cuenta propia cae en el "Banco por Defecto"', () => {
    expect(
      resolvePaymentAccount(
        pago({ paymentMethod: 'TRANSFER', bankAccountId: 'banco', bankAccount: BANCO_SIN_CUENTA }),
        CON_DEFAULTS
      )
    ).toEqual({ kind: 'resolved', accountId: 'DB', source: 'defaultBank' });
  });

  it('banco sin cuenta propia ni por defecto → falta obligatoria del banco', () => {
    expect(
      resolvePaymentAccount(
        pago({ paymentMethod: 'ECHEQ', bankAccountId: 'banco', bankAccount: BANCO_SIN_CUENTA }),
        SIN_DEFAULTS
      )
    ).toEqual({ kind: 'missing', via: 'bankAccount' });
  });

  /** Es el orden actual del asiento (`index.ts:740-750`): caja propia > banco propio > defaults. */
  it('la caja gana sobre el banco si vinieran los dos', () => {
    expect(
      resolvePaymentAccount(
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
      resolvePaymentAccount(
        pago({ cashRegisterId: 'caja', cashRegister: { name: 'Caja', accountId: '' } }),
        { defaultCashAccountId: '', defaultBankAccountId: null }
      )
    ).toEqual({ kind: 'missing', via: 'cashRegister' });
    expect(resolvePaymentAccount(pago({ cashRegisterId: '' }), CON_DEFAULTS)).toEqual({
      kind: 'missing',
      via: 'noCashRegister',
    });
  });

  it('tarjeta de socio se omite aunque traiga un banco con cuenta', () => {
    expect(
      resolvePaymentAccount(
        pago({
          paymentMethod: 'DEBIT_CARD',
          bankAccountId: 'banco',
          bankAccount: BANCO,
          card: { name: 'Visa Galicia Socio', ownerType: 'PARTNER' },
        }),
        CON_DEFAULTS
      )
    ).toEqual({ kind: 'omitted', reason: 'PARTNER_CARD' });
  });

  it('efectivo sin caja → falta la caja (borrador viejo, el Zod ya no lo permite)', () => {
    expect(resolvePaymentAccount(pago(), CON_DEFAULTS)).toEqual({
      kind: 'missing',
      via: 'noCashRegister',
    });
  });

  it('transferencia o débito de la empresa sin banco → falta el banco', () => {
    expect(resolvePaymentAccount(pago({ paymentMethod: 'TRANSFER' }), CON_DEFAULTS)).toEqual({
      kind: 'missing',
      via: 'noBankAccount',
    });
    expect(resolvePaymentAccount(pago({ paymentMethod: 'DEBIT_CARD' }), CON_DEFAULTS)).toEqual({
      kind: 'missing',
      via: 'noBankAccount',
    });
    expect(
      resolvePaymentAccount(
        pago({
          paymentMethod: 'DEBIT_CARD',
          card: { name: 'Visa Débito Empresa', ownerType: 'COMPANY' },
        }),
        CON_DEFAULTS
      )
    ).toEqual({ kind: 'missing', via: 'noBankAccount' });
  });

  it('e-cheq sin banco → falta el banco (se imputa al banco como hoy)', () => {
    expect(resolvePaymentAccount(pago({ paymentMethod: 'ECHEQ' }), CON_DEFAULTS)).toEqual({
      kind: 'missing',
      via: 'noBankAccount',
    });
  });

  it('cheque físico → sin cuenta por diseño', () => {
    expect(
      resolvePaymentAccount(pago({ paymentMethod: 'CHECK', checkNumber: '123' }), CON_DEFAULTS)
    ).toEqual({ kind: 'omitted', reason: 'CHECK' });
  });

  it('cheque o e-cheq endosado → sin cuenta por diseño', () => {
    expect(
      resolvePaymentAccount(pago({ paymentMethod: 'CHECK', endorsedCheckId: 'chk' }), CON_DEFAULTS)
    ).toEqual({ kind: 'omitted', reason: 'ENDORSED_CHECK' });
    expect(
      resolvePaymentAccount(pago({ paymentMethod: 'ECHEQ', endorsedCheckId: 'chk' }), CON_DEFAULTS)
    ).toEqual({ kind: 'omitted', reason: 'ENDORSED_CHECK' });
  });

  it('tarjeta de crédito y "Cuenta Corriente" → sin cuenta por diseño', () => {
    expect(resolvePaymentAccount(pago({ paymentMethod: 'CREDIT_CARD' }), CON_DEFAULTS)).toEqual({
      kind: 'omitted',
      reason: 'CREDIT_CARD',
    });
    expect(resolvePaymentAccount(pago({ paymentMethod: 'ACCOUNT' }), CON_DEFAULTS)).toEqual({
      kind: 'omitted',
      reason: 'ACCOUNT',
    });
  });
});

describe('clasificación de los pagos de un comprobante', () => {
  const efectivo = pago({ cashRegisterId: 'caja', cashRegister: CAJA, amount: 500 });
  const cheque = pago({ paymentMethod: 'CHECK', checkNumber: '123', amount: 300 });
  const transferenciaSinBanco = pago({ paymentMethod: 'TRANSFER', amount: 200 });
  const tarjeta = pago({ paymentMethod: 'CREDIT_CARD', amount: 100.5 });

  it('separa resueltos, faltantes y omitidos conservando orden y objeto original', () => {
    const result = classifyPayments(
      [efectivo, cheque, transferenciaSinBanco, tarjeta],
      CON_DEFAULTS
    );

    expect(result.resolved).toEqual([
      { payment: efectivo, accountId: 'CTA-CAJA', source: 'cashRegister' },
    ]);
    expect(result.resolved[0].payment).toBe(efectivo);
    expect(result.missing).toEqual([{ payment: transferenciaSinBanco, via: 'noBankAccount' }]);
    expect(result.omitted).toEqual([
      { payment: cheque, reason: 'CHECK' },
      { payment: tarjeta, reason: 'CREDIT_CARD' },
    ]);
  });

  it('suma el importe de los omitidos, redondeado a centavos', () => {
    expect(classifyPayments([efectivo, cheque, tarjeta], CON_DEFAULTS).omittedAmount).toBe(400.5);
    expect(
      classifyPayments(
        [
          pago({ paymentMethod: 'CHECK', amount: 0.1 }),
          pago({ paymentMethod: 'CHECK', amount: 0.2 }),
        ],
        CON_DEFAULTS
      ).omittedAmount
    ).toBe(0.3);
  });

  it('sin pagos devuelve listas vacías y cero', () => {
    expect(classifyPayments([], SIN_DEFAULTS)).toEqual({
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
  const cheque = pago({ paymentMethod: 'CHECK', checkNumber: '123' });

  it('cheque en un recibo: queda pendiente en Cuentas por Cobrar', () => {
    expect(buildOmittedPaymentWarning({ payment: cheque, reason: 'CHECK' }, 'receipt')).toBe(
      'Cheque N° 123 por $\u00a01.000,00 no genera línea en el asiento contable: los cheques todavía ' +
        'no tienen cuenta asignada en el sistema. Ese importe queda pendiente en Cuentas por ' +
        'Cobrar hasta que se regularice.'
    );
  });

  it('cheque endosado en una OP: queda pendiente en Cuentas por Pagar', () => {
    expect(
      buildOmittedPaymentWarning(
        {
          payment: pago({ paymentMethod: 'CHECK', endorsedCheckId: 'x' }),
          reason: 'ENDORSED_CHECK',
        },
        'paymentOrder'
      )
    ).toBe(
      'Cheque por $\u00a01.000,00 no genera línea en el asiento contable: los cheques endosados ' +
        'todavía no tienen cuenta asignada en el sistema. Ese importe queda pendiente en ' +
        'Cuentas por Pagar hasta que se regularice.'
    );
  });

  it('tarjeta de crédito', () => {
    expect(
      buildOmittedPaymentWarning(
        {
          payment: pago({
            paymentMethod: 'CREDIT_CARD',
            card: { name: 'Visa Galicia Empresa', ownerType: 'COMPANY' },
          }),
          reason: 'CREDIT_CARD',
        },
        'paymentOrder'
      )
    ).toBe(
      'Tarjeta de Crédito (Visa Galicia Empresa) por $\u00a01.000,00 no genera línea en el asiento ' +
        'contable: las tarjetas de crédito todavía no tienen cuenta asignada en el sistema. Ese ' +
        'importe queda pendiente en Cuentas por Pagar hasta que se regularice.'
    );
  });

  it('tarjeta de socio: la empresa no mueve fondos ahora', () => {
    expect(
      buildOmittedPaymentWarning(
        {
          payment: pago({
            paymentMethod: 'DEBIT_CARD',
            card: { name: 'Visa Socio', ownerType: 'PARTNER' },
          }),
          reason: 'PARTNER_CARD',
        },
        'paymentOrder'
      )
    ).toBe(
      'Tarjeta de Débito (Visa Socio) por $\u00a01.000,00 no genera línea en el asiento contable: la ' +
        'tarjeta es de un socio y la empresa no mueve fondos ahora. Ese importe queda pendiente ' +
        'en Cuentas por Pagar hasta que se regularice.'
    );
  });

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
});

describe('asiento de una sola línea', () => {
  it('recibo: lista los pagos omitidos y qué agregar', () => {
    expect(
      buildSingleLineEntryMessage('el recibo R-00012', 'receipt', [
        { payment: pago({ paymentMethod: 'CHECK', checkNumber: '123' }), reason: 'CHECK' },
      ])
    ).toBe(
      'No se puede confirmar el recibo R-00012: ningún pago genera línea contable (Cheque N° 123 ' +
        'por $\u00a01.000,00) y no hay retenciones, así que el asiento quedaría con una sola línea. ' +
        'Agregá un pago en efectivo, transferencia o e-cheq, o una retención.'
    );
  });

  it('OP: suma el débito de la empresa y separa varios pagos con coma', () => {
    expect(
      buildSingleLineEntryMessage('la orden de pago OP-00003', 'paymentOrder', [
        { payment: pago({ paymentMethod: 'CHECK', checkNumber: '9' }), reason: 'CHECK' },
        { payment: pago({ paymentMethod: 'ACCOUNT', amount: 50 }), reason: 'ACCOUNT' },
      ])
    ).toBe(
      'No se puede confirmar la orden de pago OP-00003: ningún pago genera línea contable ' +
        '(Cheque N° 9 por $\u00a01.000,00, Cuenta Corriente por $\u00a050,00) y no hay retenciones, así que ' +
        'el asiento quedaría con una sola línea. Agregá un pago en efectivo, transferencia, ' +
        'débito de la empresa o e-cheq, o una retención.'
    );
  });

  it('sin ningún pago tampoco lista nada', () => {
    expect(buildSingleLineEntryMessage('el recibo R-00012', 'receipt', [])).toBe(
      'No se puede confirmar el recibo R-00012: no hay pagos ni retenciones, así que el asiento ' +
        'quedaría con una sola línea. Agregá un pago en efectivo, transferencia o e-cheq, o una ' +
        'retención.'
    );
  });
});

describe('OP de devolución a socio', () => {
  it('avisa que no genera asiento', () => {
    expect(buildPartnerOrderWarning()).toBe(
      'Las órdenes de pago a socios no generan asiento contable.'
    );
  });
});
