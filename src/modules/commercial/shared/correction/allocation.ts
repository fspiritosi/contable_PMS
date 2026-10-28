// Reparto de una reducción de importe entre cancelaciones y medios de pago (TSK-792, §4.3).
// Trabaja en centavos enteros; la salida se devuelve en pesos con 2 decimales.

export interface Cancellation {
  itemId: string;
  documentId: string;
  source: 'PAYMENT_ORDER' | 'RECEIPT' | 'CREDIT_NOTE';
  amount: number;
  date: Date;
  createdAt: Date;
}

export interface CancellationAdjustment {
  itemId: string;
  documentId: string;
  source: Cancellation['source'];
  before: number;
  after: number;
}

const toCents = (value: number): number => Math.round(value * 100);
const fromCents = (cents: number): number => cents / 100;

/** Reparte `reduction` desde la cancelación más reciente (date desc, createdAt desc) hacia la más antigua. */
export function allocateReduction(
  cancellations: readonly Cancellation[],
  reduction: number
): CancellationAdjustment[] {
  let remaining = Math.max(0, toCents(reduction));
  if (remaining === 0) return [];

  const ordered = [...cancellations].sort(
    (a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime()
  );

  const adjustments: CancellationAdjustment[] = [];
  for (const c of ordered) {
    if (remaining === 0) break;
    const cents = toCents(c.amount);
    const taken = Math.min(remaining, cents);
    if (taken === 0) continue;
    remaining -= taken;
    adjustments.push({
      itemId: c.itemId,
      documentId: c.documentId,
      source: c.source,
      before: fromCents(cents),
      after: fromCents(cents - taken),
    });
  }
  return adjustments;
}

export interface PaymentLine {
  id: string;
  amount: number;
  label: string;
}

export type PaymentReduction =
  | { kind: 'OK'; paymentId: string; after: number }
  | { kind: 'NEEDS_CHOICE'; options: PaymentLine[] }
  | { kind: 'INSUFFICIENT' };

/** Medios que cubren solos la reducción: los únicos que se pueden ofrecer para descontarla. */
export function paymentsCovering(
  payments: readonly PaymentLine[],
  reduction: number
): PaymentLine[] {
  const cents = toCents(reduction);
  return payments.filter((p) => toCents(p.amount) >= cents);
}

/**
 * Un solo medio: ese. Varios: solo los que cubren la reducción son opciones, y se usa
 * el de `choice` si es una de ellas (si no → NEEDS_CHOICE con las opciones). Si ningún
 * medio alcanza → INSUFFICIENT.
 */
export function planPaymentReduction(
  payments: readonly PaymentLine[],
  reduction: number,
  choice?: string
): PaymentReduction {
  const options = paymentsCovering(payments, reduction);
  if (options.length === 0) return { kind: 'INSUFFICIENT' };

  let target: PaymentLine | undefined;
  if (payments.length === 1) {
    target = options[0];
  } else {
    target = choice ? options.find((p) => p.id === choice) : undefined;
    if (!target) return { kind: 'NEEDS_CHOICE', options };
  }
  return {
    kind: 'OK',
    paymentId: target.id,
    after: fromCents(toCents(target.amount) - toCents(reduction)),
  };
}
