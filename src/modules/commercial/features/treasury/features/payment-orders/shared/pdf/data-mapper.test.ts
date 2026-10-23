import { describe, expect, it } from 'vitest';

import { mapPaymentOrderDataForPDF } from './data-mapper';

type PaymentOrderInput = Parameters<typeof mapPaymentOrderDataForPDF>[0];

const company = { name: 'Empresa', taxId: null, address: null, phone: null, email: null };

function paymentOrderWith(invoice: PaymentOrderInput['items'][number]['invoice'], amount: number): PaymentOrderInput {
  return {
    id: 'op-1',
    number: 1,
    fullNumber: 'OP-00001',
    date: new Date('2026-10-15T00:00:00.000Z'),
    totalAmount: amount,
    notes: null,
    status: 'CONFIRMED',
    supplier: { businessName: 'Proveedor SA', tradeName: null, taxId: null, address: null, phone: null, email: null },
    items: [{ id: 'item-1', amount, invoice }],
    payments: [],
  };
}

describe('mapPaymentOrderDataForPDF — saldo de cada factura (TSK-792)', () => {
  it('suma las OP vigentes y las NC aplicadas para el pagado y el pendiente', () => {
    const pdf = mapPaymentOrderDataForPDF(
      paymentOrderWith(
        {
          id: 'fc-1',
          fullNumber: 'FC A 0001-00000001',
          issueDate: new Date('2026-10-01T00:00:00.000Z'),
          total: 1000,
          paymentOrderItems: [{ amount: 600 }],
          creditNoteApplicationsReceived: [{ amount: 150 }],
        },
        600
      ),
      company
    );

    expect(pdf.invoices[0]).toMatchObject({ total: 1000, paidAmount: 750, pendingAmount: 250, amountToPay: 600 });
  });

  it('sin imputaciones vigentes (OP en borrador o anulada filtrada por la consulta) la factura queda pendiente entera', () => {
    const pdf = mapPaymentOrderDataForPDF(
      paymentOrderWith(
        {
          id: 'fc-2',
          fullNumber: 'FC A 0001-00000002',
          issueDate: new Date('2026-10-01T00:00:00.000Z'),
          total: 1000,
          paymentOrderItems: [],
          creditNoteApplicationsReceived: [],
        },
        1000
      ),
      company
    );

    expect(pdf.invoices[0]).toMatchObject({ paidAmount: 0, pendingAmount: 1000, amountToPay: 1000 });
  });
});
