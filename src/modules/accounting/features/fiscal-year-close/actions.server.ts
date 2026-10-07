'use server';

/**
 * Cierre de ejercicio (TSK-760, Fase 9). Envoltorios finos con permisos, empresa activa y
 * `ActionResult`; la lógica transaccional vive en `fiscal-year-close.ts` (no es endpoint, H7).
 */
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';

import { revalidateAccountingRoutes } from '../../shared/utils';
import { NO_SETTINGS_MESSAGE } from '../../shared/utils/period-lock';

import {
  buildFiscalYearStatusTx,
  closeFiscalYearTx,
  computeClosePreviewTx,
  findOpenFiscalYearTx,
  NO_RESULT_ACCOUNT_MESSAGE,
  type CloseFiscalYearTxResult,
} from './fiscal-year-close';
import type { ClosePreview, FiscalYearCloseStatus } from './fiscal-year-close-common';

async function requireContext() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  return { userId, companyId };
}

/** Estado del ejercicio abierto más antiguo y del último cerrado. `null` = sin Ajustes. */
export async function getFiscalYearStatus(): Promise<FiscalYearCloseStatus | null> {
  await checkPermission('accounting.fiscal-year-close', 'view', { redirect: true });
  const { companyId } = await requireContext();
  return buildFiscalYearStatusTx(prisma, companyId);
}

/** Vista previa de la refundición y la apertura, con el mismo cálculo que el cierre. */
export async function previewFiscalYearClose(
  fiscalYearId: string
): Promise<ActionResult<ClosePreview>> {
  await checkPermission('accounting.fiscal-year-close', 'view', { redirect: true });
  const { companyId } = await requireContext();

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: { resultAccount: { select: { id: true, code: true, name: true } } },
    });
    if (!settings) throw new BusinessError(NO_SETTINGS_MESSAGE);
    if (!settings.resultAccount) throw new BusinessError(NO_RESULT_ACCOUNT_MESSAGE);

    const fiscalYear = await findOpenFiscalYearTx(prisma, companyId, fiscalYearId);
    const preview = await computeClosePreviewTx(prisma, companyId, fiscalYear, settings.resultAccount);
    return { success: true, ...preview };
  } catch (error) {
    return toActionResult(error, 'Error al calcular la vista previa del cierre de ejercicio');
  }
}

/** Cierra el ejercicio: refundición, ejercicio siguiente y apertura en una sola transacción. */
export async function closeFiscalYear(input: {
  fiscalYearId: string;
}): Promise<ActionResult<CloseFiscalYearTxResult>> {
  await checkPermission('accounting.fiscal-year-close', 'approve', { redirect: true });
  const { userId, companyId } = await requireContext();

  try {
    const result = await prisma.$transaction(
      (tx) => closeFiscalYearTx(tx, { companyId, userId, fiscalYearId: input.fiscalYearId }),
      { timeout: 30_000, maxWait: 10_000 }
    );
    logger.info('Ejercicio fiscal cerrado', { data: { companyId, userId, ...result } });
    revalidateAccountingRoutes(companyId);
    return { success: true, ...result };
  } catch (error) {
    return toActionResult(error, 'Error al cerrar el ejercicio fiscal');
  }
}
