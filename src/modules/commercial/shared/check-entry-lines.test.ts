import { describe, expect, it } from 'vitest';

import {
  buildCheckEventLines,
  checkOrigin,
  checkRegisteredIn,
  type CheckEventInput,
  type CheckOriginRow,
} from './check-entry-lines';

/**
 * Reglas del asiento de cada evento del ciclo de vida del cheque (TSK-735): un caso por
 * fila de la tabla del brief, más el e-cheq propio (va por banco desde la OP).
 */

const SETTINGS = {
  receivablesAccountId: 'cobrar',
  payablesAccountId: 'pagar',
  checksRejectedAccountId: 'rech',
};

type CheckShape = CheckEventInput['check'];

const thirdParty = (over: Partial<CheckShape> = {}): CheckShape => ({
  type: 'THIRD_PARTY',
  status: 'PORTFOLIO',
  amount: 500,
  isElectronic: false,
  accountId: 'vad',
  customerId: 'cli',
  supplierId: null,
  fromDocument: true,
  fundsAtOrigin: false,
  partnerRepayment: null,
  checkNumber: '123',
  depositEntered: false,
  ...over,
});

const own = (over: Partial<CheckShape> = {}): CheckShape => ({
  type: 'OWN',
  status: 'DELIVERED',
  amount: 500,
  isElectronic: false,
  accountId: 'vdp',
  customerId: null,
  supplierId: 'prov',
  fromDocument: true,
  fundsAtOrigin: false,
  partnerRepayment: null,
  checkNumber: '777',
  depositEntered: false,
  ...over,
});

const input = (
  event: CheckEventInput['event'],
  check: CheckShape,
  over: Partial<CheckEventInput> = {}
): CheckEventInput => ({ event, check, bankAccountId: 'bco', settings: SETTINGS, ...over });

describe('buildCheckEventLines', () => {
  describe('DEPOSIT', () => {
    it('tercero con cuenta registrada → Debe banco / Haber la cuenta del cheque', () => {
      const result = buildCheckEventLines(input('DEPOSIT', thirdParty()));
      expect(result).toMatchObject({
        lines: [
          { accountId: 'bco', debit: 500, credit: 0 },
          { accountId: 'vad', debit: 0, credit: 500 },
        ],
      });
    });

    it('tercero histórico físico de recibo → Debe banco / Haber Cuentas por Cobrar con el cliente', () => {
      const result = buildCheckEventLines(input('DEPOSIT', thirdParty({ accountId: null })));
      expect(result).toMatchObject({
        lines: [
          { accountId: 'bco', debit: 500, credit: 0 },
          { accountId: 'cobrar', debit: 0, credit: 500, customerId: 'cli' },
        ],
      });
    });

    it('tercero histórico electrónico de recibo → sin asiento, con aviso', () => {
      const result = buildCheckEventLines(
        input('DEPOSIT', thirdParty({ accountId: null, isElectronic: true }))
      );
      expect(result).toEqual({
        skip: true,
        warning:
          'El e-cheq N° 123 ya se registró en el banco al confirmar el recibo: el depósito no genera asiento.',
      });
    });

    it('histórico físico sin "Cuentas por Cobrar" configurada → missing', () => {
      const result = buildCheckEventLines(
        input('DEPOSIT', thirdParty({ accountId: null }), {
          settings: { ...SETTINGS, receivablesAccountId: null },
        })
      );
      expect(result).toEqual({ missing: 'receivablesAccountId' });
    });

    it('sin cuenta contable de banco → missing bank', () => {
      const result = buildCheckEventLines(input('DEPOSIT', thirdParty(), { bankAccountId: null }));
      expect(result).toEqual({ missing: 'bank' });
    });
  });

  describe('cheque cargado a mano (sin cuenta ni documento)', () => {
    const manualWarning =
      'El cheque N° 123 se cargó a mano: registrá el asiento en Contabilidad si corresponde.';

    it.each(['DEPOSIT', 'REJECT', 'VOID'] as const)(
      '%s de un tercero → sin asiento, con aviso',
      (event) => {
        const result = buildCheckEventLines(
          input(event, thirdParty({ accountId: null, fromDocument: false }), {
            bankAccountId: null,
          })
        );
        expect(result).toEqual({ skip: true, warning: manualWarning });
      }
    );

    it('DEBIT de un propio → sin asiento, con aviso', () => {
      const result = buildCheckEventLines(
        input('DEBIT', own({ accountId: null, fromDocument: false, checkNumber: '123' }))
      );
      expect(result).toEqual({ skip: true, warning: manualWarning });
    });
  });

  describe('REJECT', () => {
    it('→ Debe Cheques rechazados con el cliente / Haber banco', () => {
      const result = buildCheckEventLines(input('REJECT', thirdParty({ status: 'DEPOSITED' })));
      expect(result).toMatchObject({
        lines: [
          { accountId: 'rech', debit: 500, credit: 0, customerId: 'cli' },
          { accountId: 'bco', debit: 0, credit: 500 },
        ],
      });
    });

    it.each([
      ['físico con asiento de depósito', false, true],
      ['electrónico de documento', true, false],
    ] as const)(
      'histórico %s → Debe Cheques rechazados / Haber banco',
      (_label, isElectronic, depositEntered) => {
        const result = buildCheckEventLines(
          input(
            'REJECT',
            thirdParty({ status: 'DEPOSITED', accountId: null, isElectronic, depositEntered })
          )
        );
        expect(result).toMatchObject({
          lines: [
            { accountId: 'rech', debit: 500, credit: 0, customerId: 'cli' },
            { accountId: 'bco', debit: 0, credit: 500 },
          ],
        });
      }
    );

    it('histórico físico depositado sin asiento → Debe Cheques rechazados / Haber Cuentas por Cobrar, sin banco', () => {
      const result = buildCheckEventLines(
        input('REJECT', thirdParty({ status: 'DEPOSITED', accountId: null }))
      );
      expect(result).toMatchObject({
        lines: [
          { accountId: 'rech', debit: 500, credit: 0, customerId: 'cli' },
          { accountId: 'cobrar', debit: 0, credit: 500, customerId: 'cli' },
        ],
      });
    });

    it('histórico físico sin asiento y sin "Cuentas por Cobrar" → missing receivablesAccountId', () => {
      const result = buildCheckEventLines(
        input('REJECT', thirdParty({ status: 'DEPOSITED', accountId: null }), {
          settings: { ...SETTINGS, receivablesAccountId: null },
        })
      );
      expect(result).toEqual({ missing: 'receivablesAccountId' });
    });

    it('VOID de un histórico físico depositado sin asiento → sin asiento (Cobrar seguía abierto)', () => {
      const result = buildCheckEventLines(
        input('VOID', thirdParty({ status: 'DEPOSITED', accountId: null }))
      );
      expect(result).toMatchObject({ skip: true });
    });

    it('sin "Cheques rechazados" configurada → missing checksRejectedAccountId', () => {
      const result = buildCheckEventLines(
        input('REJECT', thirdParty({ status: 'DEPOSITED' }), {
          settings: { ...SETTINGS, checksRejectedAccountId: null },
        })
      );
      expect(result).toEqual({ missing: 'checksRejectedAccountId' });
    });
  });

  describe('DEBIT', () => {
    it('propio con cuenta registrada → Debe la cuenta del cheque / Haber banco', () => {
      const result = buildCheckEventLines(input('DEBIT', own()));
      expect(result).toMatchObject({
        lines: [
          { accountId: 'vdp', debit: 500, credit: 0 },
          { accountId: 'bco', debit: 0, credit: 500 },
        ],
      });
    });

    it('propio histórico de OP → Debe Cuentas por Pagar con el proveedor / Haber banco', () => {
      const result = buildCheckEventLines(input('DEBIT', own({ accountId: null })));
      expect(result).toMatchObject({
        lines: [
          { accountId: 'pagar', debit: 500, credit: 0, supplierId: 'prov' },
          { accountId: 'bco', debit: 0, credit: 500 },
        ],
      });
    });

    it('e-cheq propio de OP (va por banco) → sin asiento, con aviso', () => {
      const result = buildCheckEventLines(
        input('DEBIT', own({ accountId: null, isElectronic: true }))
      );
      expect(result).toEqual({
        skip: true,
        warning:
          'El e-cheq N° 777 ya se registró en el banco al confirmar la orden de pago: el débito no genera asiento.',
      });
    });
  });

  describe('VOID', () => {
    it.each(['PORTFOLIO', 'DEPOSITED'] as const)(
      'tercero %s con cuenta → Debe Cuentas por Cobrar con el cliente / Haber la cuenta del cheque',
      (status) => {
        const result = buildCheckEventLines(input('VOID', thirdParty({ status })));
        expect(result).toMatchObject({
          lines: [
            { accountId: 'cobrar', debit: 500, credit: 0, customerId: 'cli' },
            { accountId: 'vad', debit: 0, credit: 500 },
          ],
        });
      }
    );

    it('tercero PORTFOLIO histórico físico → sin asiento (Cobrar seguía abierto), con aviso', () => {
      const result = buildCheckEventLines(input('VOID', thirdParty({ accountId: null })));
      expect(result).toEqual({
        skip: true,
        warning:
          'El cheque N° 123 no tenía cuenta propia: su importe sigue en "Cuentas por Cobrar" y la anulación no genera asiento.',
      });
    });

    it('tercero PORTFOLIO histórico electrónico → Debe Cuentas por Cobrar / Haber banco', () => {
      const result = buildCheckEventLines(
        input('VOID', thirdParty({ accountId: null, isElectronic: true }))
      );
      expect(result).toMatchObject({
        lines: [
          { accountId: 'cobrar', debit: 500, credit: 0, customerId: 'cli' },
          { accountId: 'bco', debit: 0, credit: 500 },
        ],
      });
    });

    it('propio DELIVERED con cuenta → Debe la cuenta del cheque / Haber Cuentas por Pagar con el proveedor', () => {
      const result = buildCheckEventLines(input('VOID', own()));
      expect(result).toMatchObject({
        lines: [
          { accountId: 'vdp', debit: 500, credit: 0 },
          { accountId: 'pagar', debit: 0, credit: 500, supplierId: 'prov' },
        ],
      });
    });

    it('propio DELIVERED histórico físico → sin asiento, con aviso', () => {
      const result = buildCheckEventLines(input('VOID', own({ accountId: null })));
      expect(result).toEqual({
        skip: true,
        warning:
          'El cheque N° 777 no tenía cuenta propia: su importe sigue en "Cuentas por Pagar" y la anulación no genera asiento.',
      });
    });

    it('e-cheq propio DELIVERED → Debe banco / Haber Cuentas por Pagar con el proveedor', () => {
      const result = buildCheckEventLines(
        input('VOID', own({ accountId: null, isElectronic: true }))
      );
      expect(result).toMatchObject({
        lines: [
          { accountId: 'bco', debit: 500, credit: 0 },
          { accountId: 'pagar', debit: 0, credit: 500, supplierId: 'prov' },
        ],
      });
    });

    it.each([
      ['ENDORSED', 'endosado'],
      ['REJECTED', 'rechazado'],
    ] as const)('cheque %s → sin asiento, con aviso', (status, label) => {
      const result = buildCheckEventLines(input('VOID', thirdParty({ status })));
      expect(result).toEqual({
        skip: true,
        warning: `La anulación del cheque N° 123 (${label}) no genera asiento: registralo en Contabilidad si corresponde.`,
      });
    });
  });

  describe('físico histórico con caja/banco en el pago de origen (F6): como el e-cheq histórico', () => {
    const conFondos = (over: Partial<CheckShape> = {}) =>
      thirdParty({ accountId: null, fundsAtOrigin: true, ...over });

    it('DEPOSIT → sin asiento, con aviso de caja o banco', () => {
      expect(buildCheckEventLines(input('DEPOSIT', conFondos()))).toEqual({
        skip: true,
        warning:
          'El cheque N° 123 ya se registró en caja o banco al confirmar el recibo: el depósito no genera asiento.',
      });
    });

    it('DEBIT de un propio → sin asiento, con aviso de caja o banco', () => {
      expect(
        buildCheckEventLines(input('DEBIT', own({ accountId: null, fundsAtOrigin: true })))
      ).toEqual({
        skip: true,
        warning:
          'El cheque N° 777 ya se registró en caja o banco al confirmar la orden de pago: el débito no genera asiento.',
      });
    });

    it('REJECT → Debe Cheques rechazados / Haber banco (aunque el depósito no asentó)', () => {
      expect(
        buildCheckEventLines(input('REJECT', conFondos({ status: 'DEPOSITED' })))
      ).toMatchObject({
        lines: [
          { accountId: 'rech', debit: 500, customerId: 'cli' },
          { accountId: 'bco', credit: 500 },
        ],
      });
    });

    it('VOID en cartera → Debe Cuentas por Cobrar / Haber banco', () => {
      expect(buildCheckEventLines(input('VOID', conFondos()))).toMatchObject({
        lines: [
          { accountId: 'cobrar', debit: 500, customerId: 'cli' },
          { accountId: 'bco', credit: 500 },
        ],
      });
    });

    it('VOID de un propio entregado → Debe banco / Haber Cuentas por Pagar', () => {
      expect(
        buildCheckEventLines(input('VOID', own({ accountId: null, fundsAtOrigin: true })))
      ).toMatchObject({
        lines: [
          { accountId: 'bco', debit: 500 },
          { accountId: 'pagar', credit: 500, supplierId: 'prov' },
        ],
      });
    });

    it('con cuenta registrada, la caja/banco del origen no cambia nada', () => {
      expect(checkRegisteredIn(thirdParty({ fundsAtOrigin: true }))).toBe('account');
      expect(checkRegisteredIn(conFondos())).toBe('bank');
    });
  });

  describe('propio de una devolución a socio (F5)', () => {
    const socio = (hadEntry: boolean, over: Partial<CheckShape> = {}) =>
      own({
        supplierId: null,
        partnerRepayment: { orderNumber: 'OP-00042', hadEntry },
        ...over,
      });

    it('con asiento: DEBIT → Debe la cuenta del cheque / Haber banco', () => {
      expect(buildCheckEventLines(input('DEBIT', socio(true)))).toMatchObject({
        lines: [
          { accountId: 'vdp', debit: 500 },
          { accountId: 'bco', credit: 500 },
        ],
      });
    });

    it('con asiento: VOID entregado → bloqueado, hay que corregir la devolución', () => {
      expect(buildCheckEventLines(input('VOID', socio(true)))).toEqual({
        blocked:
          'El cheque N° 777 pagó la devolución al socio OP-00042: para anularlo, corregí esa orden de pago.',
      });
      // El e-cheq propio (sin cuenta, va por banco) de una devolución con asiento, también.
      expect(
        buildCheckEventLines(input('VOID', socio(true, { accountId: null, isElectronic: true })))
      ).toMatchObject({ blocked: expect.stringContaining('OP-00042') });
    });

    it('histórica sin asiento: DEBIT y VOID → sin asiento, con aviso', () => {
      const historica = socio(false, { accountId: null });
      expect(buildCheckEventLines(input('DEBIT', historica))).toEqual({
        skip: true,
        warning: 'La devolución al socio OP-00042 no tenía asiento: el débito no genera asiento.',
      });
      expect(buildCheckEventLines(input('VOID', historica))).toEqual({
        skip: true,
        warning:
          'La devolución al socio OP-00042 no tenía asiento: la anulación no genera asiento.',
      });
    });
  });
});

describe('checkOrigin', () => {
  const row = (over: Partial<CheckOriginRow> = {}): CheckOriginRow => ({
    type: 'THIRD_PARTY',
    accountId: null,
    receiptPaymentId: null,
    paymentOrderPaymentId: null,
    receiptPayment: null,
    paymentOrderPayment: null,
    ...over,
  });
  const order = (partnerId: string | null, journalEntryId: string | null) => ({
    cashRegisterId: null,
    bankAccountId: null,
    paymentOrder: { partnerId, fullNumber: 'OP-00042', journalEntryId },
  });

  it('cargado a mano: sin documento ni fondos', () => {
    expect(checkOrigin(row())).toEqual({
      fromDocument: false,
      fundsAtOrigin: false,
      partnerRepayment: null,
    });
  });

  it('tercero: los fondos salen del pago del RC, no del pago de la OP que lo endosó', () => {
    expect(
      checkOrigin(
        row({
          receiptPaymentId: 'rp',
          receiptPayment: { cashRegisterId: 'caja', bankAccountId: null },
          paymentOrderPaymentId: 'op',
          paymentOrderPayment: { ...order(null, null), bankAccountId: 'banco' },
        })
      )
    ).toMatchObject({ fromDocument: true, fundsAtOrigin: true, partnerRepayment: null });
    expect(
      checkOrigin(
        row({
          paymentOrderPaymentId: 'op',
          paymentOrderPayment: { ...order('socio', 'je'), bankAccountId: 'banco' },
        })
      )
    ).toMatchObject({ fundsAtOrigin: false, partnerRepayment: null });
  });

  it('propio de una devolución a socio: tuvo asiento si el cheque tiene cuenta o la OP asiento', () => {
    const propio = (accountId: string | null, journalEntryId: string | null) =>
      checkOrigin(
        row({
          type: 'OWN',
          accountId,
          paymentOrderPaymentId: 'op',
          paymentOrderPayment: order('socio', journalEntryId),
        })
      ).partnerRepayment;
    expect(propio('vdp', null)).toEqual({ orderNumber: 'OP-00042', hadEntry: true });
    expect(propio(null, 'je')).toEqual({ orderNumber: 'OP-00042', hadEntry: true });
    expect(propio(null, null)).toEqual({ orderNumber: 'OP-00042', hadEntry: false });
  });
});
