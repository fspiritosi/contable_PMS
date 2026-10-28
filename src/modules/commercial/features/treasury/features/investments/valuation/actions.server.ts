'use server';

import { revalidatePath } from 'next/cache';

import moment from 'moment';

import { Prisma } from '@/generated/prisma/client';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';

import { valuationSchema, type ValuationFormInput } from './validators';
import {
  generateInvestmentValuationTx,
  loadValuationCandidatesTx,
  undoInvestmentValuationTx,
  type ValuationCandidates,
} from './valuation.server';

/**
 * Valuación de inversiones al cierre del ejercicio (TSK-793). Solo permisos,
 * sesión y transacción: la lógica vive en `valuation.server.ts` (lección R7 del
 * TSK-792: las funciones que reciben `tx` no pueden ser actions públicas).
 */

const MODULE = 'commercial.treasury.investments' as const;
const REVALIDATE = '/dashboard/commercial/treasury/investments';
// Una tenencia por línea con varias consultas cada una: holgura como el motor de corrección.
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUPLICATE_MESSAGE =
  'Ya hay una valuación para este ejercicio. Deshacela para volver a generarla';

async function requireCompanyId(): Promise<string> {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  return companyId;
}

async function requireCtx() {
  const companyId = await requireCompanyId();
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  return { companyId, userId };
}

export interface ValuationFiscalYear {
  id: string;
  number: number;
  startDate: string;
  endDate: string;
  isClosed: boolean;
}

/** Ejercicios de la empresa para el selector: los abiertos primero, y dentro de cada grupo el más reciente. */
export async function getValuationFiscalYears(): Promise<ValuationFiscalYear[]> {
  await checkPermission(MODULE, 'view', { redirect: true });
  const companyId = await requireCompanyId();
  const years = await prisma.fiscalYear.findMany({
    where: { companyId },
    orderBy: { number: 'desc' },
    select: { id: true, number: true, startDate: true, endDate: true, isClosed: true },
  });
  const format = (date: Date) => moment.utc(date).format('DD/MM/YYYY');
  return [...years]
    .sort((a, b) => Number(a.isClosed) - Number(b.isClosed))
    .map((y) => ({
      id: y.id,
      number: y.number,
      startDate: format(y.startDate),
      endDate: format(y.endDate),
      isClosed: y.isClosed,
    }));
}

/** Ejercicio, valuación existente y tenencias con posición al cierre. */
export async function getValuationCandidates(fiscalYearId: string): Promise<ValuationCandidates> {
  await checkPermission(MODULE, 'view', { redirect: true });
  const companyId = await requireCompanyId();
  return loadValuationCandidatesTx(prisma as unknown as Tx, companyId, fiscalYearId);
}

export async function generateInvestmentValuation(
  input: ValuationFormInput
): Promise<ActionResult<{ id: string; journalEntryNumber: number | null }>> {
  await checkPermission(MODULE, 'approve', { redirect: true });
  const ctx = await requireCtx();

  try {
    const parsed = valuationSchema.safeParse(input);
    if (!parsed.success) {
      throw new BusinessError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
    }
    const result = await prisma.$transaction(
      (tx) => generateInvestmentValuationTx(tx, ctx, parsed.data),
      TX_OPTIONS
    );
    logger.info('Valuación de inversiones generada', {
      data: { companyId: ctx.companyId, valuationId: result.id, entry: result.journalEntryNumber },
    });
    revalidatePath(REVALIDATE, 'layout');
    return { success: true, ...result };
  } catch (error) {
    // Dos generaciones a la vez: la segunda choca con el único (empresa, ejercicio).
    const normalized =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
        ? new BusinessError(DUPLICATE_MESSAGE)
        : error;
    return toActionResult(normalized, 'Error al generar la valuación de inversiones');
  }
}

export async function undoInvestmentValuation(valuationId: string): Promise<ActionResult> {
  await checkPermission(MODULE, 'approve', { redirect: true });
  const ctx = await requireCtx();

  try {
    if (!UUID_REGEX.test(valuationId)) throw new BusinessError('Valuación no encontrada');
    await prisma.$transaction((tx) => undoInvestmentValuationTx(tx, ctx, valuationId), TX_OPTIONS);
    logger.info('Valuación de inversiones deshecha', {
      data: { companyId: ctx.companyId, valuationId },
    });
    revalidatePath(REVALIDATE, 'layout');
    return { success: true };
  } catch (error) {
    return toActionResult(error, 'Error al deshacer la valuación de inversiones');
  }
}
