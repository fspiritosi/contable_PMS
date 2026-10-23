import { describe, expect, it } from 'vitest';

import { paymentDetail, paymentLabel } from './labels';

describe('paymentLabel', () => {
  it('método, detalle, cheque e importe', () => {
    expect(
      paymentLabel({ paymentMethod: 'CHECK', amount: 500, detail: 'Banco X', checkNumber: '12' })
    ).toMatch(/^Cheque · Banco X · N° 12 · \$\s?500,00$/);
  });
  it('omite lo que falta', () => {
    expect(paymentLabel({ paymentMethod: 'CASH', amount: '10.5' })).toMatch(
      /^Efectivo · \$\s?10,50$/
    );
  });
});

describe('paymentDetail', () => {
  it('tarjeta con cuotas antes que banco o caja', () => {
    expect(
      paymentDetail({
        card: { name: 'Visa' },
        installmentsCount: 3,
        bankAccount: { bankName: 'B' },
      })
    ).toBe('Visa en 3 cuotas');
    expect(paymentDetail({ bankAccount: { bankName: 'B' } })).toBe('B');
    expect(paymentDetail({ cashRegister: { name: 'C' } })).toBe('C');
    expect(paymentDetail({})).toBeNull();
  });
});
