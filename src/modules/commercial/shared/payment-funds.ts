/**
 * Caja y banco de un pago de recibo u orden de pago (TSK-735, revisión final).
 *
 * El formulario conserva `cashRegisterId`/`bankAccountId` ocultos al cambiar de medio, y
 * con eso un cheque o una tarjeta de crédito terminaban guardados con la caja o el banco
 * de otro medio (y con la regla vieja el asiento los mandaba a esos fondos). El servidor
 * se queda solo con lo que el medio usa:
 *
 * - caja: solo efectivo;
 * - banco: transferencia, tarjeta de débito y e-cheq (la cuenta de depósito del recibido o
 *   de emisión del propio; el e-cheq endosado se guarda como venga, como antes).
 *
 * Puro: sin Prisma, sin React, sin importar de features.
 */

import type { PaymentMethod } from '@/generated/prisma/enums';

const BANK_METHODS: readonly PaymentMethod[] = ['TRANSFER', 'DEBIT_CARD', 'ECHEQ'];

interface PaymentFundsInput {
  paymentMethod: PaymentMethod;
  cashRegisterId?: string | null;
  bankAccountId?: string | null;
}

/** El pago con la caja/banco que su medio usa; el resto en `null`. */
export function normalizePaymentFunds<T extends PaymentFundsInput>(
  payment: T
): T & { cashRegisterId: string | null; bankAccountId: string | null } {
  return {
    ...payment,
    cashRegisterId: payment.paymentMethod === 'CASH' ? payment.cashRegisterId || null : null,
    bankAccountId: BANK_METHODS.includes(payment.paymentMethod)
      ? payment.bankAccountId || null
      : null,
  };
}
