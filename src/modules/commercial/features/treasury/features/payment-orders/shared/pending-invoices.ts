/**
 * Cálculo del saldo pendiente de una factura de compra.
 *
 * Vive aparte de la server action porque es la regla que decide qué facturas
 * se ofrecen para pagar, y conviene poder probarla sin base de datos.
 */

/**
 * Por debajo de este importe no hay deuda real: los totales son Decimal(12,2)
 * y al sumarlos en punto flotante quedan colas del orden de 1e-13.
 */
export const PENDING_AMOUNT_TOLERANCE = 0.005;

export interface LinkedCreditDebitNote {
  id: string;
  total: number;
  isCreditNote: boolean;
  status: string;
}

export interface PendingAmountInput {
  /** Total de la factura. */
  total: number;
  /** Importes ya pagados a través de órdenes de pago. */
  payments: number[];
  /** Notas de crédito con aplicación registrada explícitamente. */
  creditNoteApplications: { amount: number; creditNoteId: string }[];
  /** Notas vinculadas por `originalInvoiceId`, sin registro de aplicación. */
  linkedCreditDebitNotes: LinkedCreditDebitNote[];
}

export interface PendingAmountResult {
  paidAmount: number;
  pendingAmount: number;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/**
 * Devuelve cuánto se cubrió de la factura y cuánto queda por pagar.
 *
 * Las notas de crédito descuentan por dos vías: la aplicación explícita y, como
 * respaldo, las notas vinculadas a la factura que todavía no la tienen. El
 * respaldo se acota al saldo remanente para que una nota no descuente de más ni
 * se compute dos veces cuando ya figura como aplicación explícita.
 */
export function calculatePendingAmount(input: PendingAmountInput): PendingAmountResult {
  const paymentsPaid = sum(input.payments);
  const explicitCreditNotes = sum(input.creditNoteApplications.map((app) => app.amount));

  const alreadyApplied = new Set(input.creditNoteApplications.map((app) => app.creditNoteId));
  const linkedRaw = sum(
    input.linkedCreditDebitNotes
      .filter(
        (note) =>
          note.isCreditNote &&
          note.status !== 'DRAFT' &&
          note.status !== 'CANCELLED' &&
          !alreadyApplied.has(note.id)
      )
      .map((note) => note.total)
  );

  const remaining = Math.max(0, input.total - paymentsPaid - explicitCreditNotes);
  const linkedCreditNotes = Math.min(linkedRaw, remaining);

  const paidAmount = paymentsPaid + explicitCreditNotes + linkedCreditNotes;

  return { paidAmount, pendingAmount: input.total - paidAmount };
}

/**
 * Una factura solo debe ofrecerse para pagar si le queda saldo (TSK-584): las
 * que llegaron a cero por pago o por nota de crédito conservan su estado
 * CONFIRMED / PARTIAL_PAID, así que el estado por sí solo no alcanza para
 * filtrarlas.
 */
export function hasPendingBalance(pendingAmount: number): boolean {
  return pendingAmount > PENDING_AMOUNT_TOLERANCE;
}
