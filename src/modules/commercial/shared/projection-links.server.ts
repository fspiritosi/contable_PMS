import 'server-only';

import type { Tx } from '@/modules/accounting/features/integrations/core';
import { BusinessError } from '@/shared/lib/action-result';

import { projectionStatusFor } from './projection-status';

/**
 * Quita un vínculo de documento de una proyección de cashflow y le descuenta lo que
 * ese vínculo confirmaba (TSK-792). Lo usan `unlinkDocumentFromProjection` y el motor
 * de corrección al eliminar o anular una factura. Vive fuera de los archivos
 * `'use server'` porque recibe una transacción.
 */
export async function removeProjectionLinkTx(
  tx: Tx,
  companyId: string,
  linkId: string
): Promise<void> {
  const link = await tx.projectionDocumentLink.findFirst({
    where: { id: linkId, companyId },
    select: {
      amount: true,
      projection: { select: { id: true, amount: true, confirmedAmount: true } },
    },
  });
  if (!link) throw new BusinessError('Vínculo no encontrado');

  const confirmed = Number(link.projection.confirmedAmount) - Number(link.amount);
  await tx.projectionDocumentLink.delete({ where: { id: linkId } });
  await tx.cashflowProjection.update({
    where: { id: link.projection.id },
    data: {
      confirmedAmount: Math.max(0, confirmed),
      status: projectionStatusFor(confirmed, Number(link.projection.amount)),
    },
  });
}
