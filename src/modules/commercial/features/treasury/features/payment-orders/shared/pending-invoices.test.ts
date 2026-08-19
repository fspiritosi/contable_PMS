import { describe, expect, it } from 'vitest';

import {
  calculatePendingAmount,
  hasPendingBalance,
  type PendingAmountInput,
} from './pending-invoices';

/** Factura de $1000 sin pagos ni notas de crédito, como base de cada caso. */
function factura(overrides: Partial<PendingAmountInput> = {}): PendingAmountInput {
  return {
    total: 1000,
    payments: [],
    creditNoteApplications: [],
    linkedCreditDebitNotes: [],
    ...overrides,
  };
}

describe('cálculo del saldo pendiente de una factura de compra', () => {
  it('sin pagos, el pendiente es el total', () => {
    expect(calculatePendingAmount(factura())).toEqual({
      paidAmount: 0,
      pendingAmount: 1000,
    });
  });

  it('descuenta los pagos aplicados', () => {
    const { paidAmount, pendingAmount } = calculatePendingAmount(
      factura({ payments: [300, 200] })
    );

    expect(paidAmount).toBe(500);
    expect(pendingAmount).toBe(500);
  });

  it('descuenta las notas de crédito aplicadas explícitamente', () => {
    const { pendingAmount } = calculatePendingAmount(
      factura({ creditNoteApplications: [{ amount: 400, creditNoteId: 'nc-1' }] })
    );

    expect(pendingAmount).toBe(600);
  });

  it('descuenta las notas de crédito vinculadas sin registro explícito', () => {
    const { pendingAmount } = calculatePendingAmount(
      factura({
        linkedCreditDebitNotes: [
          { id: 'nc-1', total: 250, isCreditNote: true, status: 'CONFIRMED' },
        ],
      })
    );

    expect(pendingAmount).toBe(750);
  });

  it('no cuenta dos veces una nota de crédito ya aplicada explícitamente', () => {
    const { pendingAmount } = calculatePendingAmount(
      factura({
        creditNoteApplications: [{ amount: 250, creditNoteId: 'nc-1' }],
        linkedCreditDebitNotes: [
          { id: 'nc-1', total: 250, isCreditNote: true, status: 'CONFIRMED' },
        ],
      })
    );

    expect(pendingAmount).toBe(750);
  });

  it('ignora notas en borrador o anuladas, y las de débito', () => {
    const { pendingAmount } = calculatePendingAmount(
      factura({
        linkedCreditDebitNotes: [
          { id: 'nc-1', total: 100, isCreditNote: true, status: 'DRAFT' },
          { id: 'nc-2', total: 100, isCreditNote: true, status: 'CANCELLED' },
          { id: 'nd-1', total: 100, isCreditNote: false, status: 'CONFIRMED' },
        ],
      })
    );

    expect(pendingAmount).toBe(1000);
  });

  it('nunca deja el pendiente por debajo de cero aunque la NC exceda el saldo', () => {
    const { pendingAmount } = calculatePendingAmount(
      factura({
        payments: [900],
        linkedCreditDebitNotes: [
          { id: 'nc-1', total: 500, isCreditNote: true, status: 'CONFIRMED' },
        ],
      })
    );

    expect(pendingAmount).toBe(0);
  });
});

/**
 * Regresión de TSK-584. La usuaria informó: "si debemos 2 de 258, espero que
 * las 256 no aparezcan en pendiente cero". `getPendingPurchaseInvoices`
 * filtraba solo por estado (CONFIRMED / PARTIAL_PAID) y calculaba el pendiente
 * después, sin descartar las que quedaban en cero: una factura totalmente
 * compensada por una nota de crédito seguía apareciendo en la lista de pago.
 */
describe('facturas que deben ofrecerse para pagar (TSK-584)', () => {
  it('excluye la factura totalmente cancelada por una nota de crédito', () => {
    const { pendingAmount } = calculatePendingAmount(
      factura({
        creditNoteApplications: [{ amount: 1000, creditNoteId: 'nc-1' }],
      })
    );

    expect(pendingAmount).toBe(0);
    expect(hasPendingBalance(pendingAmount)).toBe(false);
  });

  it('excluye la factura totalmente pagada', () => {
    const { pendingAmount } = calculatePendingAmount(factura({ payments: [1000] }));

    expect(hasPendingBalance(pendingAmount)).toBe(false);
  });

  it('conserva la factura con saldo, aunque sea parcial', () => {
    const { pendingAmount } = calculatePendingAmount(factura({ payments: [999] }));

    expect(pendingAmount).toBe(1);
    expect(hasPendingBalance(pendingAmount)).toBe(true);
  });

  it('descarta restos por redondeo de centavos, que no son deuda real', () => {
    // Decimal(12,2) más sumas en punto flotante dejan colas de 1e-13.
    expect(hasPendingBalance(0.0000000001)).toBe(false);
    expect(hasPendingBalance(0.01)).toBe(true);
  });
});
