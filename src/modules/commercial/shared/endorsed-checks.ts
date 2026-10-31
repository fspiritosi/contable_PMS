/**
 * Cheques endosados en una orden de pago, para resolver la cuenta de cada pago (TSK-735).
 *
 * `PaymentOrderPayment.endorsedCheckId` no tiene relación Prisma a `Check`: los cheques
 * se buscan por id en una sola query. La usan el asiento de la OP
 * (`accounting/features/integrations/commercial`) y su pre-validación
 * (`treasury/shared/entry-preflight.ts`), con el mismo filtro por empresa: un id de otra
 * empresa cuenta como cheque inexistente y la resolución lo bloquea.
 *
 * Trae también el importe (el endoso es por el importe completo) y el pago del recibo con
 * el que ingresó: sin recibo, el cheque se cargó a mano; con caja/banco en ese pago, el
 * asiento viejo del RC lo mandó a fondos (TSK-735, revisión final).
 */

import type { Prisma } from '@/generated/prisma/client';

import type { EndorsedCheckInfo } from './payment-accounts';

const ENDORSED_CHECK_SELECT = {
  id: true,
  accountId: true,
  customerId: true,
  isElectronic: true,
  checkNumber: true,
  amount: true,
  bankAccount: { select: { accountId: true, bankName: true, accountNumber: true } },
  receiptPayment: {
    select: {
      cashRegister: { select: { name: true, accountId: true } },
      bankAccount: { select: { bankName: true, accountNumber: true, accountId: true } },
    },
  },
} satisfies Prisma.CheckSelect;

type CheckReader = Pick<Prisma.TransactionClient, 'check'>;

/** Cheques de la empresa por id; los que no aparecen quedan fuera del mapa. */
export async function loadEndorsedChecks(
  client: CheckReader,
  companyId: string,
  ids: readonly string[]
): Promise<Map<string, EndorsedCheckInfo>> {
  if (ids.length === 0) return new Map();
  const checks = await client.check.findMany({
    where: { id: { in: [...new Set(ids)] }, companyId },
    select: ENDORSED_CHECK_SELECT,
  });
  return new Map(
    checks.map(({ id, amount, ...check }) => [id, { ...check, amount: Number(amount) }])
  );
}

/** Pagos con su `endorsedCheck` (null si el cheque ya no existe), listos para `classifyPayments`. */
export async function withEndorsedChecks<T extends { endorsedCheckId: string | null }>(
  client: CheckReader,
  companyId: string,
  payments: readonly T[]
): Promise<(T & { endorsedCheck: EndorsedCheckInfo | null })[]> {
  const ids = payments.flatMap((p) => (p.endorsedCheckId ? [p.endorsedCheckId] : []));
  const byId = await loadEndorsedChecks(client, companyId, ids);
  return payments.map((p) => ({
    ...p,
    endorsedCheck: p.endorsedCheckId ? (byId.get(p.endorsedCheckId) ?? null) : null,
  }));
}
