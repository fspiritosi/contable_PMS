'use server';

import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { revalidatePath } from 'next/cache';
import { createJournalEntryTx } from '../../shared/utils/journal-entry-tx';
import { NOT_CLOSE_GENERATED_OPENING_SQL } from '../../shared/utils/closing-entries';
import type { JournalEntryLineDraft } from '../../shared/utils/journal-entry-lines';
import { endOfMonthUtc, formatMonth, startOfMonthUtc } from '../../shared/utils/utc-month';

// ============================================
// LIQUIDACIÓN IVA — DDJJ MENSUAL
// ============================================

interface VatSettlementPreview {
  period: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
  status: 'A_PAGAR' | 'A_FAVOR';
}

export async function previewVatSettlement(
  year: number,
  month: number
): Promise<VatSettlementPreview> {
  await checkPermission('accounting.reports', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: {
        vatDebitAccountId: true,
        vatCreditAccountId: true,
        vatAccounts: { select: { accountId: true, side: true } },
      },
    });

    if (!settings) throw new BusinessError('Configuración contable no encontrada');

    // Recolectar todas las cuentas de IVA
    const debitAccountIds: string[] = [];
    const creditAccountIds: string[] = [];

    if (settings.vatDebitAccountId) debitAccountIds.push(settings.vatDebitAccountId);
    if (settings.vatCreditAccountId) creditAccountIds.push(settings.vatCreditAccountId);

    for (const va of settings.vatAccounts) {
      if (va.side === 'DEBIT') debitAccountIds.push(va.accountId);
      else creditAccountIds.push(va.accountId);
    }

    // Mes en UTC (TSK-760, D8): el mismo rango que el período contable del asiento.
    const startDate = startOfMonthUtc({ year, month });
    const endDate = endOfMonthUtc({ year, month });

    // Calcular IVA Débito del período
    const debitResult = await prisma.$queryRaw<[{ total: number }]>`
      SELECT COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)::float AS total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.company_id = ${companyId}::uuid
        AND je.status = 'POSTED'
        AND je.date >= ${startDate}
        AND je.date <= ${endDate}
        AND ${NOT_CLOSE_GENERATED_OPENING_SQL} -- la apertura del cierre no es IVA del mes (TSK-760 H4)
        AND jel.account_id = ANY(${debitAccountIds}::uuid[])
    `;

    // Calcular IVA Crédito del período
    const creditResult = await prisma.$queryRaw<[{ total: number }]>`
      SELECT COALESCE(SUM(jel.debit) - SUM(jel.credit), 0)::float AS total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.company_id = ${companyId}::uuid
        AND je.status = 'POSTED'
        AND je.date >= ${startDate}
        AND je.date <= ${endDate}
        AND ${NOT_CLOSE_GENERATED_OPENING_SQL} -- la apertura del cierre no es IVA del mes (TSK-760 H4)
        AND jel.account_id = ANY(${creditAccountIds}::uuid[])
    `;

    const totalDebit = debitResult[0].total;
    const totalCredit = creditResult[0].total;
    const balance = totalDebit - totalCredit;

    return {
      period: formatMonth({ year, month }),
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      balance: Math.round(balance * 100) / 100,
      status: balance > 0 ? 'A_PAGAR' : 'A_FAVOR',
    };
  } catch (error) {
    logger.error('Error al previsualizar liquidación IVA', {
      data: { error, companyId, year, month },
    });
    throw error;
  }
}

/**
 * Asiento de liquidación de IVA del mes (TSK-760, #15): POSTED, `'system'`, fechado el
 * último día del mes (UTC) y creado con el núcleo (período cerrado, ejercicio, período
 * y número atómico). Sin UI: devuelve `ActionResult` para cuando la tenga.
 */
export async function generateVatSettlementEntry(
  year: number,
  month: number
): Promise<ActionResult<{ id: string; number: number; preview: VatSettlementPreview }>> {
  await checkPermission('accounting.entries', 'create', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: {
        vatDebitAccountId: true,
        vatCreditAccountId: true,
        vatPayableAccountId: true,
        vatBalanceAccountId: true,
      },
    });

    if (!settings) throw new BusinessError('Configuración contable no encontrada');

    const { vatDebitAccountId, vatCreditAccountId } = settings;
    if (!vatDebitAccountId || !vatCreditAccountId) {
      throw new BusinessError('Configure las cuentas de IVA DF y CF antes de liquidar');
    }

    if (!settings.vatPayableAccountId && !settings.vatBalanceAccountId) {
      throw new BusinessError('Configure las cuentas de IVA a Pagar y/o IVA Saldo a Favor');
    }

    const preview = await previewVatSettlement(year, month);

    if (preview.totalDebit === 0 && preview.totalCredit === 0) {
      throw new BusinessError('No hay movimientos de IVA en el período');
    }

    const lines: JournalEntryLineDraft[] = [
      // Cancelar IVA Débito (siempre al debe)
      {
        accountId: vatDebitAccountId,
        debit: preview.totalDebit,
        credit: 0,
        description: `IVA Débito Fiscal ${preview.period}`,
      },
      // Cancelar IVA Crédito (siempre al haber)
      {
        accountId: vatCreditAccountId,
        debit: 0,
        credit: preview.totalCredit,
        description: `IVA Crédito Fiscal ${preview.period}`,
      },
    ];

    if (preview.status === 'A_PAGAR') {
      if (!settings.vatPayableAccountId) {
        throw new BusinessError('Configure la cuenta de IVA a Pagar');
      }
      lines.push({
        accountId: settings.vatPayableAccountId,
        debit: 0,
        credit: preview.balance,
        description: `IVA a Pagar ${preview.period}`,
      });
    } else {
      if (!settings.vatBalanceAccountId) {
        throw new BusinessError('Configure la cuenta de IVA Saldo a Favor');
      }
      lines.push({
        accountId: settings.vatBalanceAccountId,
        debit: Math.abs(preview.balance),
        credit: 0,
        description: `IVA Saldo a Favor ${preview.period}`,
      });
    }

    const entry = await prisma.$transaction((tx) =>
      createJournalEntryTx(tx, {
        companyId,
        date: endOfMonthUtc({ year, month }),
        description: `Liquidación IVA ${preview.period}`,
        // Sin líneas 0/0 (sin DF, sin CF o saldo cero): las rechaza el CHECK de la DB.
        lines: lines.filter((line) => Number(line.debit) !== 0 || Number(line.credit) !== 0),
        status: 'POSTED',
        createdBy: 'system',
        source: `vat-settlement:${year}-${month}`,
      })
    );

    logger.info('Asiento de liquidación IVA generado', {
      data: { companyId, entryId: entry.id, entryNumber: entry.number, year, month },
    });

    revalidatePath('/dashboard/company/accounting/entries');

    return { success: true, id: entry.id, number: entry.number, preview };
  } catch (error) {
    return toActionResult(error, 'Error al generar asiento de liquidación IVA');
  }
}
