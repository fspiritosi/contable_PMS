import type { UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';

import type { ReceiptWithDetails } from '../../../../shared/types';
import type { CreateReceiptFormData, createReceiptSchema } from '../../../../shared/validators';
import type { getAvailableBankAccounts, getAvailableCashRegisters } from '../../actions.server';

/** Valores del formulario tal como se editan (antes de que Zod aplique defaults). */
export type ReceiptFormInput = z.input<typeof createReceiptSchema>;
export type ReceiptForm = UseFormReturn<ReceiptFormInput, unknown, CreateReceiptFormData>;
export type AvailableCashRegister = Awaited<ReturnType<typeof getAvailableCashRegisters>>[number];
export type AvailableBankAccount = Awaited<ReturnType<typeof getAvailableBankAccounts>>[number];

type AmountRow = { amount?: string | null };
/** Montos del formulario (los parciales de `useWatch` también sirven). */
export type ReceiptAmounts = {
  items?: AmountRow[];
  payments?: AmountRow[];
  withholdings?: AmountRow[];
};

const toCents = (value: string | null | undefined) => Math.round(parseFloat(value || '0') * 100);
const sumCents = (rows: AmountRow[] | undefined) =>
  (rows ?? []).reduce((sum, row) => sum + toCents(row.amount), 0);

/** Totales del recibo en pesos, sumados en centavos para evitar errores de punto flotante. */
export function receiptTotals(values: ReceiptAmounts) {
  const items = sumCents(values.items);
  const payments = sumCents(values.payments);
  const withholdings = sumCents(values.withholdings);
  return {
    totalItems: items / 100,
    totalPayments: payments / 100,
    totalWithholdings: withholdings / 100,
    difference: (items - payments - withholdings) / 100,
  };
}

/** Lo que falta cubrir con el pago `index`, descontando los demás pagos y las retenciones. */
export function remainingForPayment(values: ReceiptAmounts, index: number): number {
  const others = (values.payments ?? []).filter((_, i) => i !== index);
  const cents = sumCents(values.items) - sumCents(values.withholdings) - sumCents(others);
  return Math.max(0, cents / 100);
}

export const emptyReceiptValues = (date: Date): CreateReceiptFormData => ({
  customerId: '',
  date,
  notes: null,
  items: [],
  payments: [],
  withholdings: [],
});

/** Recibo cargado con `getReceipt` → valores del formulario (modo edición). */
export function receiptToFormValues(receipt: ReceiptWithDetails): CreateReceiptFormData {
  return {
    customerId: receipt.customer.id,
    date: new Date(receipt.date),
    notes: receipt.notes,
    items: receipt.items.map((item) => ({
      invoiceId: item.invoice.id,
      amount: item.amount.toFixed(2),
    })),
    payments: receipt.payments.map((p) => ({
      paymentMethod: p.paymentMethod,
      amount: p.amount.toFixed(2),
      cashRegisterId: p.cashRegisterId,
      bankAccountId: p.bankAccountId,
      checkNumber: p.checkNumber,
      cardLast4: p.cardLast4,
      reference: p.reference,
      checkBankName: p.checkBankName,
      checkIssueDate: p.checkIssueDate ? new Date(p.checkIssueDate) : null,
      checkDueDate: p.checkDueDate ? new Date(p.checkDueDate) : null,
      checkDrawerName: p.checkDrawerName,
      checkDrawerTaxId: p.checkDrawerTaxId,
    })),
    withholdings: receipt.withholdings.map((w) => ({
      taxType: w.taxType,
      rate: w.rate.toString(),
      amount: w.amount.toFixed(2),
      certificateNumber: w.certificateNumber,
    })),
  };
}
