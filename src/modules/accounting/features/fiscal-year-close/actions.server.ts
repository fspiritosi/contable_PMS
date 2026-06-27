'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { JournalEntryStatus } from '@/generated/prisma/enums';
import { revalidateAccountingRoutes } from '../../shared/utils';
import moment from 'moment';

interface ClosingLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

interface FiscalYearStatus {
  fiscalYearStart: Date;
  fiscalYearEnd: Date;
  resultAccountId: string | null;
  resultAccountName: string | null;
  isClosed: boolean;
  closingEntryId: string | null;
  closingEntryNumber: number | null;
  openingEntryId: string | null;
  openingEntryNumber: number | null;
  nextFiscalYearId: string | null;
}

interface ClosePreview {
  lines: ClosingLine[];
  openingLines: ClosingLine[];
  totalRevenue: number;
  totalExpense: number;
  netResult: number;
}

/**
 * Obtiene el estado del ejercicio fiscal
 */
export async function getFiscalYearStatus(companyId: string): Promise<FiscalYearStatus | null> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.fiscal-year-close', 'view', { redirect: true });

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      include: {
        resultAccount: { select: { name: true } },
      },
    });

    // Condición esperada (sin configuración contable): se devuelve null para que
    // la UI muestre un empty state guía, en vez de propagar un error boundary.
    if (!settings) {
      return null;
    }

    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: {
        companyId,
        startDate: { lte: settings.fiscalYearEnd },
        endDate: { gte: settings.fiscalYearStart },
      },
      select: {
        id: true,
        isClosed: true,
        closingEntryId: true,
        openingEntryId: true,
        closingEntry: { select: { id: true, number: true } },
        openingEntry: { select: { id: true, number: true } },
      },
    });

    const nextFy = fiscalYear?.isClosed
      ? await prisma.fiscalYear.findFirst({
          where: { companyId, startDate: { gt: settings.fiscalYearEnd } },
          select: { id: true },
          orderBy: { startDate: 'asc' },
        })
      : null;

    return {
      fiscalYearStart: settings.fiscalYearStart,
      fiscalYearEnd: settings.fiscalYearEnd,
      resultAccountId: settings.resultAccountId,
      resultAccountName: settings.resultAccount?.name ?? null,
      isClosed: fiscalYear?.isClosed ?? false,
      closingEntryId: fiscalYear?.closingEntry?.id ?? null,
      closingEntryNumber: fiscalYear?.closingEntry?.number ?? null,
      openingEntryId: fiscalYear?.openingEntry?.id ?? null,
      openingEntryNumber: fiscalYear?.openingEntry?.number ?? null,
      nextFiscalYearId: nextFy?.id ?? null,
    };
  } catch (error) {
    logger.error('Error al obtener estado del ejercicio fiscal', { data: { error, companyId } });
    throw error;
  }
}

/**
 * Genera preview del asiento de cierre de ejercicio
 */
export async function previewFiscalYearClose(companyId: string): Promise<ClosePreview> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.fiscal-year-close', 'view', { redirect: true });

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
    });

    if (!settings) {
      throw new Error('No hay configuración contable');
    }

    if (!settings.resultAccountId) {
      throw new Error('No se ha configurado la cuenta de Resultado del Ejercicio en Settings');
    }

    const resultAccount = await prisma.account.findUnique({
      where: { id: settings.resultAccountId },
      select: { id: true, code: true, name: true },
    });

    if (!resultAccount) {
      throw new Error('La cuenta de Resultado del Ejercicio configurada no existe');
    }

    // Query única: saldos agrupados por cuenta para REVENUE y EXPENSE
    const balances = await prisma.$queryRaw<
      { account_id: string; code: string; name: string; account_type: string; total_debit: number; total_credit: number }[]
    >`
      SELECT a.id AS account_id, a.code, a.name, a.type AS account_type,
             COALESCE(SUM(jel.debit), 0)::float AS total_debit,
             COALESCE(SUM(jel.credit), 0)::float AS total_credit
      FROM accounts a
      JOIN journal_entry_lines jel ON jel.account_id = a.id
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE a.company_id = ${companyId}::uuid
        AND a.is_active = true
        AND a.type IN ('REVENUE', 'EXPENSE')
        AND je.company_id = ${companyId}::uuid
        AND je.status = 'POSTED'
        AND je.date >= ${settings.fiscalYearStart}
        AND je.date <= ${settings.fiscalYearEnd}
      GROUP BY a.id, a.code, a.name, a.type
      HAVING ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) >= 0.01
      ORDER BY a.code
    `;

    const lines: ClosingLine[] = [];
    let totalRevenue = 0;
    let totalExpense = 0;

    for (const row of balances) {
      const balance = row.total_debit - row.total_credit;

      if (row.account_type === 'REVENUE') {
        totalRevenue += Math.abs(balance);
      } else {
        totalExpense += Math.abs(balance);
      }

      lines.push({
        accountId: row.account_id,
        accountCode: row.code,
        accountName: row.name,
        debit: balance < 0 ? Math.abs(balance) : 0,
        credit: balance > 0 ? balance : 0,
      });
    }

    // Contrapartida: cuenta de resultado del ejercicio
    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
    const resultDiff = totalDebit - totalCredit;

    lines.push({
      accountId: resultAccount.id,
      accountCode: resultAccount.code,
      accountName: resultAccount.name,
      debit: resultDiff < 0 ? Math.abs(resultDiff) : 0,
      credit: resultDiff > 0 ? resultDiff : 0,
    });

    // Preview de asiento de apertura: saldos patrimoniales
    const patrimonialBalances = await prisma.$queryRaw<
      { account_id: string; code: string; name: string; account_type: string; nature: string; total_debit: number; total_credit: number }[]
    >`
      SELECT a.id AS account_id, a.code, a.name, a.type AS account_type, a.nature,
             COALESCE(SUM(jel.debit), 0)::float AS total_debit,
             COALESCE(SUM(jel.credit), 0)::float AS total_credit
      FROM accounts a
      JOIN journal_entry_lines jel ON jel.account_id = a.id
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE a.company_id = ${companyId}::uuid
        AND a.is_active = true
        AND a.type IN ('ASSET', 'LIABILITY', 'EQUITY')
        AND je.company_id = ${companyId}::uuid
        AND je.status = 'POSTED'
        AND je.date <= ${settings.fiscalYearEnd}
      GROUP BY a.id, a.code, a.name, a.type, a.nature
      HAVING ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) >= 0.01
      ORDER BY a.code
    `;

    const openingLines: ClosingLine[] = [];
    for (const row of patrimonialBalances) {
      const balance = row.total_debit - row.total_credit;
      openingLines.push({
        accountId: row.account_id,
        accountCode: row.code,
        accountName: row.name,
        debit: balance > 0 ? balance : 0,
        credit: balance < 0 ? Math.abs(balance) : 0,
      });
    }

    // Incluir resultado del ejercicio en la apertura (ya va incluido en la cuenta de resultado)
    const netResult = totalRevenue - totalExpense;

    return {
      lines,
      openingLines,
      totalRevenue,
      totalExpense,
      netResult,
    };
  } catch (error) {
    logger.error('Error al generar preview de cierre', { data: { error, companyId } });
    throw error;
  }
}

/**
 * Ejecuta el cierre del ejercicio fiscal
 */
export async function closeFiscalYear(companyId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.fiscal-year-close', 'approve', { redirect: true });

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
    });

    if (!settings) {
      throw new Error('No hay configuración contable');
    }

    if (!settings.resultAccountId) {
      throw new Error('No se ha configurado la cuenta de Resultado del Ejercicio');
    }

    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: {
        companyId,
        startDate: { lte: settings.fiscalYearEnd },
        endDate: { gte: settings.fiscalYearStart },
      },
      select: { id: true, number: true, isClosed: true, startDate: true, endDate: true },
    });

    if (!fiscalYear) {
      throw new Error('No se encontró el ejercicio fiscal');
    }

    if (fiscalYear.isClosed) {
      throw new Error('El ejercicio fiscal ya fue cerrado');
    }

    // Validar que todos los períodos mensuales estén cerrados
    const openPeriods = await prisma.accountingPeriod.findMany({
      where: {
        fiscalYearId: fiscalYear.id,
        type: 'MONTHLY',
        isClosed: false,
      },
      select: { year: true, month: true },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });

    if (openPeriods.length > 0) {
      const periodNames = openPeriods.map(
        (p) => `${p.month.toString().padStart(2, '0')}/${p.year}`
      );
      throw new Error(
        `Debe cerrar todos los períodos mensuales antes de cerrar el ejercicio. Períodos abiertos: ${periodNames.join(', ')}`
      );
    }

    const preview = await previewFiscalYearClose(companyId);

    if (preview.lines.length === 0) {
      throw new Error('No hay cuentas de resultado con saldo para cerrar');
    }

    const closingDesc = `Refundición de resultados — Ejercicio ${moment(settings.fiscalYearStart).format('DD/MM/YYYY')} al ${moment(settings.fiscalYearEnd).format('DD/MM/YYYY')}`;

    const result = await prisma.$transaction(async (tx) => {
      // Asegurar que exista período CLOSING
      let closingPeriod = await tx.accountingPeriod.findFirst({
        where: { fiscalYearId: fiscalYear.id, type: 'CLOSING' },
        select: { id: true },
      });

      if (!closingPeriod) {
        closingPeriod = await tx.accountingPeriod.create({
          data: {
            fiscalYearId: fiscalYear.id,
            year: moment(fiscalYear.endDate).year(),
            month: moment(fiscalYear.endDate).month() + 1,
            type: 'CLOSING',
          },
          select: { id: true },
        });
      }

      // ---- PASO 1: Asiento de refundición de resultados ----
      const [{ last_entry_number: closingNumber }] = await tx.$queryRaw<
        [{ last_entry_number: number }]
      >`
        UPDATE accounting_settings
        SET last_entry_number = last_entry_number + 1, updated_at = NOW()
        WHERE company_id = ${companyId}::uuid
        RETURNING last_entry_number
      `;

      const closingEntry = await tx.journalEntry.create({
        data: {
          companyId,
          number: closingNumber,
          date: settings.fiscalYearEnd,
          description: closingDesc,
          createdBy: userId,
          status: JournalEntryStatus.POSTED,
          postDate: new Date(),
          fiscalYearId: fiscalYear.id,
          periodId: closingPeriod.id,
          lines: {
            create: preview.lines.map((line) => ({
              accountId: line.accountId,
              description: `Refundición — ${line.accountName}`,
              debit: line.debit,
              credit: line.credit,
            })),
          },
        },
        select: { id: true, number: true },
      });

      // ---- PASO 2: Marcar ejercicio cerrado con referencia al asiento ----
      await tx.fiscalYear.update({
        where: { id: fiscalYear.id },
        data: {
          isClosed: true,
          closedAt: new Date(),
          closedBy: userId,
          closingEntryId: closingEntry.id,
        },
      });

      await tx.$queryRaw`
        UPDATE accounting_settings
        SET locked_until_date = ${settings.fiscalYearEnd}, updated_at = NOW()
        WHERE company_id = ${companyId}::uuid
      `;

      // ---- PASO 3: Crear nuevo ejercicio fiscal ----
      const newStartDate = moment(fiscalYear.endDate).add(1, 'day').toDate();
      const newEndDate = moment(newStartDate).add(1, 'year').subtract(1, 'day').toDate();
      const newFyNumber = fiscalYear.number + 1;

      const newFiscalYear = await tx.fiscalYear.create({
        data: {
          companyId,
          number: newFyNumber,
          startDate: newStartDate,
          endDate: newEndDate,
        },
        select: { id: true },
      });

      // Crear períodos: OPENING + 12 MONTHLY + CLOSING
      const periodsToCreate: {
        fiscalYearId: string;
        year: number;
        month: number;
        type: 'OPENING' | 'MONTHLY' | 'CLOSING';
      }[] = [];

      periodsToCreate.push({
        fiscalYearId: newFiscalYear.id,
        year: moment(newStartDate).year(),
        month: moment(newStartDate).month() + 1,
        type: 'OPENING',
      });

      const cursor = moment(newStartDate);
      while (cursor.isSameOrBefore(newEndDate, 'month')) {
        periodsToCreate.push({
          fiscalYearId: newFiscalYear.id,
          year: cursor.year(),
          month: cursor.month() + 1,
          type: 'MONTHLY',
        });
        cursor.add(1, 'month');
      }

      periodsToCreate.push({
        fiscalYearId: newFiscalYear.id,
        year: moment(newEndDate).year(),
        month: moment(newEndDate).month() + 1,
        type: 'CLOSING',
      });

      await tx.accountingPeriod.createMany({ data: periodsToCreate });

      // ---- PASO 4: Asiento de apertura en nuevo ejercicio ----
      const openingPeriod = await tx.accountingPeriod.findFirst({
        where: { fiscalYearId: newFiscalYear.id, type: 'OPENING' },
        select: { id: true },
      });

      if (preview.openingLines.length > 0 && openingPeriod) {
        const [{ last_entry_number: openingNumber }] = await tx.$queryRaw<
          [{ last_entry_number: number }]
        >`
          UPDATE accounting_settings
          SET last_entry_number = last_entry_number + 1, updated_at = NOW()
          WHERE company_id = ${companyId}::uuid
          RETURNING last_entry_number
        `;

        const openingDesc = `Asiento de apertura — Ejercicio ${moment(newStartDate).format('DD/MM/YYYY')} al ${moment(newEndDate).format('DD/MM/YYYY')}`;

        const openingEntry = await tx.journalEntry.create({
          data: {
            companyId,
            number: openingNumber,
            date: newStartDate,
            description: openingDesc,
            createdBy: userId,
            status: JournalEntryStatus.POSTED,
            postDate: new Date(),
            fiscalYearId: newFiscalYear.id,
            periodId: openingPeriod.id,
            lines: {
              create: preview.openingLines.map((line) => ({
                accountId: line.accountId,
                description: `Apertura — ${line.accountName}`,
                debit: line.debit,
                credit: line.credit,
              })),
            },
          },
          select: { id: true, number: true },
        });

        await tx.fiscalYear.update({
          where: { id: newFiscalYear.id },
          data: { openingEntryId: openingEntry.id },
        });
      }

      // Actualizar settings: apuntar al nuevo ejercicio
      await tx.accountingSettings.update({
        where: { companyId },
        data: {
          fiscalYearStart: newStartDate,
          fiscalYearEnd: newEndDate,
        },
      });

      return { closingEntry, newFiscalYearNumber: newFyNumber };
    });

    logger.info('Ejercicio fiscal cerrado', {
      data: {
        companyId,
        closingEntryId: result.closingEntry.id,
        closingEntryNumber: result.closingEntry.number,
        newFiscalYear: result.newFiscalYearNumber,
        userId,
      },
    });

    revalidateAccountingRoutes(companyId);

    return {
      id: result.closingEntry.id,
      number: result.closingEntry.number,
      newFiscalYear: result.newFiscalYearNumber,
    };
  } catch (error) {
    logger.error('Error al cerrar ejercicio fiscal', { data: { error, companyId } });
    throw error;
  }
}
