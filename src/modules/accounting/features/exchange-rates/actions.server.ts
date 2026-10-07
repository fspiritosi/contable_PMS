'use server';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { revalidatePath } from 'next/cache';
import { createJournalEntryTx } from '../../shared/utils/journal-entry-tx';
import { NOT_CLOSE_GENERATED_OPENING_SQL } from '../../shared/utils/closing-entries';
import type { JournalEntryLineDraft } from '../../shared/utils/journal-entry-lines';
import { formatDayUtc } from '../../shared/utils/utc-month';

// ============================================
// CRUD DE TIPOS DE CAMBIO
// ============================================

export async function getExchangeRates(currency?: string, fromDate?: Date, toDate?: Date) {
  await checkPermission('accounting.settings', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const rates = await prisma.exchangeRate.findMany({
      where: {
        companyId,
        ...(currency && { currency }),
        ...(fromDate && toDate && { date: { gte: fromDate, lte: toDate } }),
      },
      orderBy: [{ currency: 'asc' }, { date: 'desc' }],
      take: 500,
    });

    return rates.map((r) => ({
      id: r.id,
      currency: r.currency,
      date: r.date,
      buyRate: Number(r.buyRate),
      sellRate: Number(r.sellRate),
      source: r.source,
    }));
  } catch (error) {
    logger.error('Error al obtener tipos de cambio', { data: { error, companyId } });
    throw error;
  }
}

interface CreateExchangeRateInput {
  currency: string;
  date: Date;
  buyRate: number;
  sellRate: number;
  source?: string;
}

export async function createExchangeRate(input: CreateExchangeRateInput) {
  await checkPermission('accounting.settings', 'create', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const rate = await prisma.exchangeRate.upsert({
      where: {
        companyId_currency_date: {
          companyId,
          currency: input.currency,
          date: input.date,
        },
      },
      update: {
        buyRate: input.buyRate,
        sellRate: input.sellRate,
        source: input.source ?? 'MANUAL',
      },
      create: {
        companyId,
        currency: input.currency,
        date: input.date,
        buyRate: input.buyRate,
        sellRate: input.sellRate,
        source: input.source ?? 'MANUAL',
      },
      select: { id: true },
    });

    logger.info('Tipo de cambio guardado', {
      data: { companyId, currency: input.currency, date: input.date },
    });
    revalidatePath('/dashboard/company/accounting/exchange-rates');

    return rate;
  } catch (error) {
    logger.error('Error al guardar tipo de cambio', { data: { error, companyId } });
    throw error;
  }
}

export async function deleteExchangeRate(id: string) {
  await checkPermission('accounting.settings', 'delete', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    await prisma.exchangeRate.delete({ where: { id } });

    logger.info('Tipo de cambio eliminado', { data: { companyId, id } });
    revalidatePath('/dashboard/company/accounting/exchange-rates');
  } catch (error) {
    logger.error('Error al eliminar tipo de cambio', { data: { error, companyId, id } });
    throw error;
  }
}

export async function getExchangeRateForDate(
  currency: string,
  date: Date
): Promise<{ buyRate: number; sellRate: number } | null> {
  const companyId = await getActiveCompanyId();
  if (!companyId) return null;

  try {
    const rate = await prisma.exchangeRate.findUnique({
      where: {
        companyId_currency_date: {
          companyId,
          currency,
          date,
        },
      },
      select: { buyRate: true, sellRate: true },
    });

    if (rate) {
      return { buyRate: Number(rate.buyRate), sellRate: Number(rate.sellRate) };
    }

    // Fallback: buscar el tipo de cambio más cercano anterior
    const closest = await prisma.exchangeRate.findFirst({
      where: {
        companyId,
        currency,
        date: { lte: date },
      },
      orderBy: { date: 'desc' },
      select: { buyRate: true, sellRate: true },
    });

    if (closest) {
      return { buyRate: Number(closest.buyRate), sellRate: Number(closest.sellRate) };
    }

    return null;
  } catch (error) {
    logger.error('Error al obtener tipo de cambio', {
      data: { error, companyId, currency, date },
    });
    return null;
  }
}

// ============================================
// DIFERENCIA DE CAMBIO
// ============================================

interface ExchangeDiffResult {
  accountId: string;
  accountCode: string;
  accountName: string;
  currency: string;
  originalBalance: number;
  previousArsBalance: number;
  newArsBalance: number;
  difference: number;
}

export async function previewExchangeDifference(
  closingDate: Date
): Promise<ExchangeDiffResult[]> {
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Obtener cuentas en moneda extranjera con saldo
    const foreignAccounts = await prisma.account.findMany({
      where: {
        companyId,
        isActive: true,
        currency: { not: 'ARS' },
      },
      select: { id: true, code: true, name: true, currency: true, nature: true },
      orderBy: { code: 'asc' },
    });

    if (foreignAccounts.length === 0) return [];

    const results: ExchangeDiffResult[] = [];

    for (const account of foreignAccounts) {
      // Saldo en moneda original (sumando originalAmount)
      const originalLines = await prisma.$queryRaw<
        [{ total_original: number; total_debit: number; total_credit: number }]
      >`
        SELECT
          COALESCE(SUM(CASE WHEN jel.debit > 0 THEN COALESCE(jel.original_amount, jel.debit) ELSE 0 END)
                 - SUM(CASE WHEN jel.credit > 0 THEN COALESCE(jel.original_amount, jel.credit) ELSE 0 END), 0)::float AS total_original,
          COALESCE(SUM(jel.debit), 0)::float AS total_debit,
          COALESCE(SUM(jel.credit), 0)::float AS total_credit
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        WHERE jel.account_id = ${account.id}::uuid
          AND je.company_id = ${companyId}::uuid
          AND je.status = 'POSTED'
          AND je.date <= ${closingDate}
          AND ${NOT_CLOSE_GENERATED_OPENING_SQL} -- saldo acumulado sin la apertura del cierre (TSK-760 H4)
      `;

      const originalBalance = originalLines[0].total_original;
      const previousArsBalance = originalLines[0].total_debit - originalLines[0].total_credit;

      if (Math.abs(originalBalance) < 0.01) continue;

      // Obtener tipo de cambio de cierre
      const rate = await getExchangeRateForDate(account.currency, closingDate);
      if (!rate) continue;

      const newArsBalance = originalBalance * rate.sellRate;
      const difference = newArsBalance - previousArsBalance;

      if (Math.abs(difference) < 0.01) continue;

      results.push({
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        currency: account.currency,
        originalBalance,
        previousArsBalance,
        newArsBalance,
        difference,
      });
    }

    return results;
  } catch (error) {
    logger.error('Error al calcular diferencia de cambio', {
      data: { error, companyId, closingDate },
    });
    throw error;
  }
}

/**
 * Asiento de diferencia de cambio al `closingDate` (TSK-760, #16): POSTED, a nombre del
 * usuario, creado con el núcleo (período cerrado, ejercicio, período y número
 * atómico; antes no cargaba ejercicio ni período). Sin UI: devuelve `ActionResult`.
 */
export async function generateExchangeDifferenceEntry(
  closingDate: Date
): Promise<ActionResult<{ id: string; number: number }>> {
  await checkPermission('accounting.entries', 'create', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  try {
    const diffs = await previewExchangeDifference(closingDate);

    if (diffs.length === 0) {
      throw new BusinessError('No hay diferencias de cambio para registrar');
    }

    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: { resultAccountId: true },
    });

    if (!settings?.resultAccountId) {
      throw new BusinessError(
        'Configure la cuenta de Resultado del Ejercicio antes de generar diferencias de cambio'
      );
    }

    // Buscar cuenta de diferencia de cambio (gastos o ingresos financieros)
    // Usamos una cuenta genérica — el usuario puede mapear una cuenta específica
    const exchangeDiffAccount = await prisma.account.findFirst({
      where: {
        companyId,
        isActive: true,
        name: { contains: 'diferencia de cambio', mode: 'insensitive' },
      },
      select: { id: true },
    });

    const diffAccountId = exchangeDiffAccount?.id ?? settings.resultAccountId;

    const lines: JournalEntryLineDraft[] = [];
    let totalGain = 0;
    let totalLoss = 0;

    for (const diff of diffs) {
      const description = `Dif. cambio ${diff.currency} — ${diff.accountName}`;
      if (diff.difference > 0) {
        // Ganancia: la cuenta en ME vale más en ARS
        lines.push({ accountId: diff.accountId, description, debit: diff.difference, credit: 0 });
        totalGain += diff.difference;
      } else {
        // Pérdida: la cuenta en ME vale menos en ARS
        lines.push({ accountId: diff.accountId, description, debit: 0, credit: Math.abs(diff.difference) });
        totalLoss += Math.abs(diff.difference);
      }
    }

    // Contrapartida en cuenta de diferencia de cambio
    if (totalGain > 0) {
      lines.push({
        accountId: diffAccountId,
        description: 'Diferencia de cambio — Ganancia',
        debit: 0,
        credit: totalGain,
      });
    }

    if (totalLoss > 0) {
      lines.push({
        accountId: diffAccountId,
        description: 'Diferencia de cambio — Pérdida',
        debit: totalLoss,
        credit: 0,
      });
    }

    const entry = await prisma.$transaction((tx) =>
      createJournalEntryTx(tx, {
        companyId,
        date: closingDate,
        description: `Diferencia de cambio al ${formatDayUtc(closingDate)}`,
        lines,
        status: 'POSTED',
        createdBy: userId,
        source: 'exchange-difference',
      })
    );

    logger.info('Asiento de diferencia de cambio generado', {
      data: { companyId, entryId: entry.id, entryNumber: entry.number },
    });

    revalidatePath('/dashboard/company/accounting/entries');

    return { success: true, id: entry.id, number: entry.number };
  } catch (error) {
    return toActionResult(error, 'Error al generar asiento de diferencia de cambio');
  }
}
