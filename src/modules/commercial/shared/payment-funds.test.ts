import { describe, expect, it } from 'vitest';

import { normalizePaymentFunds } from './payment-funds';

/**
 * TSK-735 (revisión final, F6): el formulario arrastra la caja/banco de otro medio; el
 * servidor guarda solo lo que el medio usa.
 */
describe('normalizePaymentFunds', () => {
  const dragged = { cashRegisterId: 'caja', bankAccountId: 'banco' };

  it('efectivo conserva la caja y suelta el banco', () => {
    expect(normalizePaymentFunds({ paymentMethod: 'CASH', ...dragged })).toMatchObject({
      cashRegisterId: 'caja',
      bankAccountId: null,
    });
  });

  it.each(['TRANSFER', 'DEBIT_CARD', 'ECHEQ'] as const)(
    '%s conserva el banco y suelta la caja',
    (paymentMethod) => {
      expect(normalizePaymentFunds({ paymentMethod, ...dragged })).toMatchObject({
        cashRegisterId: null,
        bankAccountId: 'banco',
      });
    }
  );

  it.each(['CHECK', 'CREDIT_CARD', 'ACCOUNT'] as const)(
    '%s no guarda ni caja ni banco',
    (paymentMethod) => {
      expect(normalizePaymentFunds({ paymentMethod, ...dragged })).toMatchObject({
        cashRegisterId: null,
        bankAccountId: null,
      });
    }
  );

  it('conserva el resto del pago y trata la cadena vacía como ausencia', () => {
    expect(
      normalizePaymentFunds({
        paymentMethod: 'TRANSFER',
        amount: '100',
        cashRegisterId: undefined,
        bankAccountId: '',
      })
    ).toEqual({
      paymentMethod: 'TRANSFER',
      amount: '100',
      cashRegisterId: null,
      bankAccountId: null,
    });
  });
});
