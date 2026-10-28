'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { toActionResult, type ActionFailure, type ActionResult } from '@/shared/lib/action-result';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';

import type { ApplyRejectionReason } from '../correction/engine.server';
import { applyCorrection, previewCorrection } from '../correction/engine.server';
import { CORRECTION_HANDLERS } from '../correction/registry.server';
import type { CorrectionProposal, CorrectionRequest } from '../correction/types';

const uuid = z.string().uuid();

const requestSchema = z.object({
  mode: z.enum(['EDIT', 'DELETE', 'CANCEL']),
  ref: z.object({
    kind: z.enum([
      'PURCHASE_INVOICE',
      'SALES_INVOICE',
      'PAYMENT_ORDER',
      'RECEIPT',
      'FUND_MOVEMENT',
    ]),
    id: uuid,
  }),
  choices: z.record(uuid, uuid).optional(),
  data: z.unknown().optional(),
});

/** Rutas que una corrección puede dejar desactualizadas (comprobantes, tesorería, asientos). */
const AFFECTED_PATHS = [
  '/dashboard/commercial/purchases',
  '/dashboard/commercial/invoices',
  '/dashboard/commercial/treasury/payment-orders',
  '/dashboard/commercial/treasury/receipts',
  '/dashboard/commercial/treasury/fund-movements',
  '/dashboard/commercial/treasury/bank-accounts',
  '/dashboard/commercial/treasury/cash-registers',
  '/dashboard/commercial/treasury/checks',
  '/dashboard/company/accounting/entries',
];

type Authorized =
  | { ok: true; request: CorrectionRequest; ctx: { companyId: string; userId: string } }
  | { ok: false; failure: ActionFailure };

/**
 * Valida el pedido y verifica el permiso. Se llama FUERA del try de cada action: el
 * `redirect()` de `checkPermission` lanza NEXT_REDIRECT y no debe caer en `toActionResult`.
 */
async function authorize(raw: unknown): Promise<Authorized> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      failure: { success: false, error: 'La solicitud de corrección no es válida.' },
    };
  }
  const request = parsed.data as CorrectionRequest;
  await checkPermission(
    CORRECTION_HANDLERS[request.ref.kind].permissionModule,
    request.mode === 'EDIT' ? 'update' : 'delete',
    { redirect: true }
  );
  const [companyId, userId] = await Promise.all([getActiveCompanyId(), getCurrentUserId()]);
  if (!companyId || !userId) {
    return {
      ok: false,
      failure: { success: false, error: 'No se pudo identificar la empresa o el usuario.' },
    };
  }
  return { ok: true, request, ctx: { companyId, userId } };
}

/** Vista previa de la corrección: no modifica nada. */
export async function previewDocumentCorrection(
  rawRequest: CorrectionRequest
): Promise<ActionResult<{ proposal: CorrectionProposal }>> {
  const auth = await authorize(rawRequest);
  if (!auth.ok) return auth.failure;
  try {
    const { request, ctx } = auth;
    return { success: true, proposal: await previewCorrection(ctx, request) };
  } catch (error) {
    return toActionResult(error, 'Error al previsualizar la corrección');
  }
}

/** Aplica la corrección si la huella coincide con la propuesta que vio el usuario. */
export async function applyDocumentCorrection(
  rawRequest: CorrectionRequest,
  fingerprint: string
): Promise<
  ActionResult<{ applied: boolean; reason?: ApplyRejectionReason; proposal?: CorrectionProposal }>
> {
  const auth = await authorize(rawRequest);
  if (!auth.ok) return auth.failure;
  try {
    const { request, ctx } = auth;
    const result = await applyCorrection(ctx, request, fingerprint);
    if (!result.applied) {
      return { success: true, applied: false, reason: result.reason, proposal: result.proposal };
    }
    logger.info('Corrección aplicada', { data: { request: { ...request, data: undefined } } });
    for (const path of AFFECTED_PATHS) revalidatePath(path);
    return { success: true, applied: true };
  } catch (error) {
    return toActionResult(error, 'Error al aplicar la corrección');
  }
}
