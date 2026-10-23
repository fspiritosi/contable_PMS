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
  | { kind: 'NEEDS_CHOICE' }
  | { kind: 'INSUFFICIENT' };

/** Un solo medio: ese. Varios: el de `choice` (si no hay → NEEDS_CHOICE). Si el medio no alcanza → INSUFFICIENT. */
export function planPaymentReduction(
  payments: readonly PaymentLine[],
  reduction: number,
  choice?: string
): PaymentReduction {
  if (payments.length === 0) return { kind: 'INSUFFICIENT' };

  let target: PaymentLine | undefined;
  if (payments.length === 1) {
    target = payments[0];
  } else {
    target = choice ? payments.find((p) => p.id === choice) : undefined;
    if (!target) return { kind: 'NEEDS_CHOICE' };
  }

  const afterCents = toCents(target.amount) - toCents(reduction);
  if (afterCents < 0) return { kind: 'INSUFFICIENT' };
  return { kind: 'OK', paymentId: target.id, after: fromCents(afterCents) };
}
