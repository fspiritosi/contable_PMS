import { describe, expect, it } from 'vitest';

import {
  BANK_ACCOUNT_TYPE_LABELS,
  ACCOUNT_METHOD_REJECTED_MESSAGE,
  bankAccountSchema,
  createReceiptSchema,
  partnerRepaymentSchema,
  PAYMENT_METHOD_LABELS,
  SELECTABLE_PAYMENT_METHOD_LABELS,
  paymentOrderPaymentSchema,
  receiptPaymentSchema,
} from './validators';

/**
 * TSK-728: efectivo sin caja y transferencia/débito sin banco no mueven fondos
 * ni pueden ir al asiento; el Zod ya no deja crear el borrador así. El confirm
 * lo vuelve a validar para los borradores viejos.
 */

const CAJA = '11111111-1111-4111-8111-111111111111';
const BANCO = '22222222-2222-4222-8222-222222222222';
const TARJETA = '33333333-3333-4333-8333-333333333333';
const CHEQUE_EN_CARTERA = '44444444-4444-4444-8444-444444444444';

function issuesDe(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).map((i) => ({ path: i.path.join('.'), message: i.message }));
}

describe('pago de un recibo', () => {
  it('rechaza Efectivo sin caja', () => {
    const result = receiptPaymentSchema.safeParse({ paymentMethod: 'CASH', amount: '1000' });
    expect(result.success).toBe(false);
    expect(issuesDe(result)).toContainEqual({
      path: 'cashRegisterId',
      message: 'Debe seleccionar la caja',
    });
  });

  it('acepta Efectivo con caja', () => {
    expect(
      receiptPaymentSchema.safeParse({
        paymentMethod: 'CASH',
        amount: '1000',
        cashRegisterId: CAJA,
      }).success
    ).toBe(true);
  });

  it('rechaza Transferencia y Tarjeta de Débito sin cuenta bancaria', () => {
    for (const paymentMethod of ['TRANSFER', 'DEBIT_CARD']) {
      const result = receiptPaymentSchema.safeParse({ paymentMethod, amount: '1000' });
      expect(result.success).toBe(false);
      expect(issuesDe(result)).toContainEqual({
        path: 'bankAccountId',
        message: 'Debe seleccionar la cuenta bancaria',
      });
    }
  });

  it('acepta Transferencia y Tarjeta de Débito con cuenta bancaria', () => {
    for (const paymentMethod of ['TRANSFER', 'DEBIT_CARD']) {
      expect(
        receiptPaymentSchema.safeParse({ paymentMethod, amount: '1000', bankAccountId: BANCO })
          .success
      ).toBe(true);
    }
  });

  it('acepta un cheque con sus datos y sin banco', () => {
    expect(
      receiptPaymentSchema.safeParse({
        paymentMethod: 'CHECK',
        amount: '1000',
        checkNumber: '123',
        checkBankName: 'Banco Nación',
        checkDueDate: new Date('2026-10-01'),
        checkDrawerName: 'Juan Pérez',
      }).success
    ).toBe(true);
  });

  it('sigue exigiendo la cuenta de depósito del e-cheq', () => {
    const result = receiptPaymentSchema.safeParse({
      paymentMethod: 'ECHEQ',
      amount: '1000',
      checkNumber: '123',
      checkBankName: 'Banco Nación',
      checkDueDate: new Date('2026-10-01'),
      checkDrawerName: 'Juan Pérez',
    });
    expect(result.success).toBe(false);
    expect(issuesDe(result)).toContainEqual({
      path: 'bankAccountId',
      message: 'Debe indicar la cuenta de depósito del e-cheq',
    });
  });
});

describe('pago de una orden de pago', () => {
  it('rechaza Efectivo sin caja', () => {
    const result = paymentOrderPaymentSchema.safeParse({ paymentMethod: 'CASH', amount: '1000' });
    expect(result.success).toBe(false);
    expect(issuesDe(result)).toContainEqual({
      path: 'cashRegisterId',
      message: 'Debe seleccionar la caja',
    });
  });

  it('rechaza Transferencia sin cuenta bancaria', () => {
    const result = paymentOrderPaymentSchema.safeParse({
      paymentMethod: 'TRANSFER',
      amount: '1000',
    });
    expect(result.success).toBe(false);
    expect(issuesDe(result)).toContainEqual({
      path: 'bankAccountId',
      message: 'Debe seleccionar la cuenta bancaria',
    });
  });

  /** La tarjeta puede ser de un socio: la empresa no mueve banco. Lo decide la pre-validación. */
  it('acepta Tarjeta de Débito con tarjeta y sin banco', () => {
    expect(
      paymentOrderPaymentSchema.safeParse({
        paymentMethod: 'DEBIT_CARD',
        amount: '1000',
        cardId: TARJETA,
      }).success
    ).toBe(true);
  });

  it('acepta un cheque propio sin banco', () => {
    expect(
      paymentOrderPaymentSchema.safeParse({
        paymentMethod: 'CHECK',
        amount: '1000',
        checkOwnership: 'OWN',
        checkNumber: '123',
        checkBankName: 'Banco Nación',
        checkDueDate: new Date('2026-10-01'),
      }).success
    ).toBe(true);
  });

  it('acepta un cheque de terceros endosado', () => {
    expect(
      paymentOrderPaymentSchema.safeParse({
        paymentMethod: 'CHECK',
        amount: '1000',
        checkOwnership: 'THIRD_PARTY',
        endorsedCheckId: CHEQUE_EN_CARTERA,
      }).success
    ).toBe(true);
  });
});

describe('broker como tipo de cuenta (TSK-793)', () => {
  it('acepta un broker sin CBU ni alias', () => {
    const result = bankAccountSchema.safeParse({
      accountType: 'BROKER',
      bankName: 'Balanz',
      accountNumber: '123',
    });
    expect(result.success).toBe(true);
  });

  it('el tipo se muestra como "Broker"', () => {
    expect(BANK_ACCOUNT_TYPE_LABELS.BROKER).toBe('Broker');
  });

  it('exige el nombre del broker', () => {
    const result = bankAccountSchema.safeParse({ accountType: 'BROKER', bankName: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Ingresá el nombre del broker');
  });

  it('acepta un broker con nombre y sin CBU, alias ni número de cuenta', () => {
    const result = bankAccountSchema.safeParse({ accountType: 'BROKER', bankName: 'Balanz' });
    expect(result.success).toBe(true);
  });
});

describe('"Cuenta Corriente" ya no se ofrece (TSK-735)', () => {
  const MENSAJE =
    'El medio "Cuenta Corriente" ya no se usa: elegí otro medio o registrá una nota de crédito/débito';
  const FACTURA = '55555555-5555-4555-8555-555555555555';
  const CLIENTE = '66666666-6666-4666-8666-666666666666';
  const SOCIO = '77777777-7777-4777-8777-777777777777';
  const base = (payment: { paymentMethod: string; amount: string; cashRegisterId?: string }) => ({
    customerId: CLIENTE,
    date: new Date('2026-03-01'),
    items: [{ invoiceId: FACTURA, amount: '1000' }],
    payments: [payment],
    withholdings: [],
  });

  it('el mensaje es el literal', () => {
    expect(ACCOUNT_METHOD_REJECTED_MESSAGE).toBe(MENSAJE);
  });

  it('createReceiptSchema rechaza un pago ACCOUNT con el literal', () => {
    const result = createReceiptSchema.safeParse(base({ paymentMethod: 'ACCOUNT', amount: '1000' }));
    expect(result.success).toBe(false);
    expect(issuesDe(result)).toContainEqual({ path: 'payments.0.paymentMethod', message: MENSAJE });
  });

  it('createReceiptSchema acepta un pago CASH con caja', () => {
    const result = createReceiptSchema.safeParse(
      base({ paymentMethod: 'CASH', amount: '1000', cashRegisterId: CAJA })
    );
    expect(result.success).toBe(true);
  });

  it('paymentOrderPaymentSchema rechaza ACCOUNT con el literal', () => {
    const result = paymentOrderPaymentSchema.safeParse({ paymentMethod: 'ACCOUNT', amount: '10' });
    expect(issuesDe(result)).toContainEqual({ path: 'paymentMethod', message: MENSAJE });
  });

  it('partnerRepaymentSchema rechaza una devolución con ACCOUNT', () => {
    const result = partnerRepaymentSchema.safeParse({
      partnerId: SOCIO,
      date: new Date('2026-03-01'),
      installmentIds: [FACTURA],
      payments: [{ paymentMethod: 'ACCOUNT', amount: '10' }],
    });
    expect(result.success).toBe(false);
    expect(issuesDe(result)).toContainEqual({ path: 'payments.0.paymentMethod', message: MENSAJE });
  });

  it('SELECTABLE_PAYMENT_METHOD_LABELS es la completa sin ACCOUNT', () => {
    const { ACCOUNT: _omit, ...sinAccount } = PAYMENT_METHOD_LABELS;
    expect(SELECTABLE_PAYMENT_METHOD_LABELS).toEqual(sinAccount);
    expect(Object.keys(SELECTABLE_PAYMENT_METHOD_LABELS)).not.toContain('ACCOUNT');
  });
});
