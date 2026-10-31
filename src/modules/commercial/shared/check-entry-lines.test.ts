import { describe, expect, it } from 'vitest';

import { buildCheckEventLines, type CheckEventInput } from './check-entry-lines';

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
});
