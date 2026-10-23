import { PAYMENT_METHOD_LABELS } from '@/modules/commercial/features/treasury/shared/validators';
import { formatCurrency } from '@/shared/utils/formatters';

/** Un medio de pago de una OP/RC, tal como lo muestra la propuesta. */
export interface PaymentLabelInput {
  paymentMethod: keyof typeof PAYMENT_METHOD_LABELS;
  amount: { toString(): string } | number;
  /** Tarjeta, banco o caja del pago. */
  detail?: string | null;
  checkNumber?: string | null;
}

/**
 * "Transferencia · Banco Nación · $ 800.000,00": el mismo texto en las opciones de
 * medio a elegir (plan) y en las filas de la tarjeta de la OP/RC (foto).
 */
export function paymentLabel(payment: PaymentLabelInput): string {
  return [
    PAYMENT_METHOD_LABELS[payment.paymentMethod],
    payment.detail ?? null,
    payment.checkNumber ? `N° ${payment.checkNumber}` : null,
    formatCurrency(Number(payment.amount)),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Detalle de un pago: la tarjeta (con sus cuotas), el banco o la caja. */
export function paymentDetail(payment: {
  card?: { name: string } | null;
  installmentsCount?: number | null;
  bankAccount?: { bankName: string } | null;
  cashRegister?: { name: string } | null;
}): string | null {
  if (payment.card) {
    return payment.installmentsCount
      ? `${payment.card.name} en ${payment.installmentsCount} cuotas`
      : payment.card.name;
  }
  return payment.bankAccount?.bankName ?? payment.cashRegister?.name ?? null;
}
