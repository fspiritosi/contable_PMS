import { isCreditNote } from './voucher-utils';

/**
 * Datos mínimos de una factura de compra necesarios para calcular el saldo pendiente.
 * Acepta Number() (ya convertido desde Decimal) para uso compartido entre server/client.
 */
export interface PurchaseInvoiceBalanceInput {
  voucherType: string;
  total: number;
  paymentOrderItems: { amount: number }[];
  creditNoteApplicationsReceived: { amount: number; creditNoteId: string }[];
  /**
   * NC vinculadas por originalInvoiceId sin registro explícito en creditNoteApplicationsReceived.
   * Se filtran por estado (no DRAFT/CANCELLED) y se capean contra el saldo pendiente.
   */
  creditDebitNotes: { id: string; voucherType: string; total: number; status: string }[];
}

/**
 * Resultado del cálculo de saldo de una factura de compra.
 */
export interface PurchaseInvoiceBalance {
  total: number;
  paidByPaymentOrders: number;
  appliedByCreditNotes: number;
  pendingBalance: number;
}

/**
 * Calcula el saldo pendiente de una factura de compra, considerando pagos por OP y
 * NC aplicadas (explícitas + fallback por originalInvoiceId).
 *
 * Reglas:
 * - Si es NC, las NC aplicadas se ignoran (se aplica al revés: la NC se "aplica a" facturas).
 * - Las NC vinculadas por originalInvoiceId pero sin application explícita se cuentan como
 *   aplicadas hasta capear al saldo pendiente.
 */
export function calculatePurchaseInvoiceBalance(
  invoice: PurchaseInvoiceBalanceInput
): PurchaseInvoiceBalance {
  const isNC = isCreditNote(invoice.voucherType);

  if (isNC) {
    const appliedByCreditNotes = invoice.creditNoteApplicationsReceived.reduce(
      (sum, app) => sum + app.amount,
      0
    );
    return {
      total: invoice.total,
      paidByPaymentOrders: 0,
      appliedByCreditNotes,
      pendingBalance: Math.max(0, invoice.total - appliedByCreditNotes),
    };
  }

  const paidByPaymentOrders = invoice.paymentOrderItems.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  const explicitCNIds = new Set(
    invoice.creditNoteApplicationsReceived.map((app) => app.creditNoteId)
  );
  const cnAppliedExplicit = invoice.creditNoteApplicationsReceived.reduce(
    (sum, app) => sum + app.amount,
    0
  );
  const cnLinkedRaw = invoice.creditDebitNotes
    .filter(
      (doc) =>
        isCreditNote(doc.voucherType) &&
        doc.status !== 'DRAFT' &&
        doc.status !== 'CANCELLED' &&
        !explicitCNIds.has(doc.id)
    )
    .reduce((sum, doc) => sum + doc.total, 0);
  const maxFallbackCN = Math.max(0, invoice.total - paidByPaymentOrders - cnAppliedExplicit);
  const cnLinked = Math.min(cnLinkedRaw, maxFallbackCN);

  const appliedByCreditNotes = cnAppliedExplicit + cnLinked;
  const pendingBalance = Math.max(0, invoice.total - paidByPaymentOrders - appliedByCreditNotes);

  return {
    total: invoice.total,
    paidByPaymentOrders,
    appliedByCreditNotes,
    pendingBalance,
  };
}

/**
 * Indica si la factura admite pago (no es NC y tiene saldo pendiente).
 */
export function canPayPurchaseInvoice(invoice: PurchaseInvoiceBalanceInput): boolean {
  if (isCreditNote(invoice.voucherType)) return false;
  return calculatePurchaseInvoiceBalance(invoice).pendingBalance > 0;
}