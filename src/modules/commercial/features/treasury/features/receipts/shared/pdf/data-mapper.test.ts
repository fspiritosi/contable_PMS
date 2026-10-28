import { describe, expect, it } from 'vitest';

import { mapReceiptDataForPDF } from './data-mapper';

type ReceiptInput = Parameters<typeof mapReceiptDataForPDF>[0];

const company = { name: 'Empresa', taxId: null, address: null, phone: null, email: null };

function receiptWith(invoice: ReceiptInput['items'][number]['invoice'], amount: number): ReceiptInput {
  return {
    id: 'rc-1',
    number: 1,
    fullNumber: 'R-00001',
    date: new Date('2026-10-15T00:00:00.000Z'),
    totalAmount: amount,
    notes: null,
    status: 'CONFIRMED',
    customer: { name: 'Cliente SA', taxId: null, address: null, phone: null, email: null },
    items: [{ id: 'item-1', amount, invoice }],
    payments: [],
  };
}

describe('mapReceiptDataForPDF — saldo de cada factura (TSK-792)', () => {
  it('suma los recibos vigentes y las NC aplicadas para el cobrado y el pendiente', () => {
    const pdf = mapReceiptDataForPDF(
      receiptWith(
        {
          id: 'fv-1',
          fullNumber: 'FV B 0001-00000001',
          issueDate: new Date('2026-10-01T00:00:00.000Z'),
          total: 1000,
          receiptItems: [{ amount: 600 }],
          creditNoteApplicationsReceived: [{ amount: 150 }],
        },
        600
      ),
      company
    );

    expect(pdf.invoices[0]).toMatchObject({ total: 1000, paidAmount: 750, pendingAmount: 250, amountToCollect: 600 });
  });

  it('sin imputaciones vigentes (recibo en borrador o anulado filtrado por la consulta) la factura queda pendiente entera', () => {
    const pdf = mapReceiptDataForPDF(
      receiptWith(
        {
          id: 'fv-2',
          fullNumber: 'FV B 0001-00000002',
          issueDate: new Date('2026-10-01T00:00:00.000Z'),
          total: 1000,
          receiptItems: [],
          creditNoteApplicationsReceived: [],
        },
        1000
      ),
      company
    );

    expect(pdf.invoices[0]).toMatchObject({ paidAmount: 0, pendingAmount: 1000, amountToCollect: 1000 });
  });
});
