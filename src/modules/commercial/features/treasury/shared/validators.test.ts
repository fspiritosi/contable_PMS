import { describe, expect, it } from 'vitest';

import { paymentOrderPaymentSchema, receiptPaymentSchema } from './validators';

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
