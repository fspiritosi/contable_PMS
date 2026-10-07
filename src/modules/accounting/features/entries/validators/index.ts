/**
 * Validadores del asiento manual (TSK-760, Fase 4).
 *
 * Sin `'use server'` (H7): solo los importan las actions, no deben ser endpoints
 * invocables desde el navegador. Los errores son `BusinessError` para que lleguen
 * legibles al cliente como `ActionResult`. El balance, los importes, el período y
 * la numeración los valida el núcleo (`createJournalEntryTx` / `postJournalEntryTx`).
 */
import { type CreateJournalEntryInput } from '../../../shared/types';
import moment from 'moment';

import { prisma } from '@/shared/lib/prisma';
import { BusinessError } from '@/shared/lib/action-result';
import { logger } from '@/shared/lib/logger';
import { toNumber } from '../../../shared/utils/decimal';

interface LineWithAmounts {
  accountId: string;
  debit: unknown;
  credit: unknown;
}

/**
 * Valida que las cuentas existan, pertenezcan a la empresa y sean imputables (hojas)
 */
export async function validateJournalEntryAccounts(companyId: string, accountIds: string[]) {
  const accounts = await prisma.account.findMany({
    where: {
      id: { in: accountIds },
      companyId,
      isActive: true
    },
    select: {
      id: true,
      code: true,
      name: true,
      nature: true,
      isLeaf: true,
      requiresAuxiliary: true,
    },
  });

  // Una misma cuenta puede repetirse en varias líneas: se compara contra las distintas.
  if (accounts.length !== new Set(accountIds).size) {
    throw new BusinessError('Una o más cuentas no existen o no pertenecen a la empresa');
  }

  const nonLeafAccounts = accounts.filter(a => !a.isLeaf);
  if (nonLeafAccounts.length > 0) {
    throw new BusinessError(
      `Las siguientes cuentas no son imputables (tienen subcuentas): ${nonLeafAccounts.map(a => a.code).join(', ')}`
    );
  }

  return accounts;
}

/**
 * Valida auxiliares requeridos en las líneas del asiento.
 * Debe llamarse DESPUÉS de validateJournalEntryAccounts para tener las cuentas cargadas.
 */
export async function validateAuxiliaries(
  companyId: string,
  lines: CreateJournalEntryInput['lines'],
  accounts: { id: string; code: string; requiresAuxiliary: string | null }[]
) {
  for (const line of lines) {
    const account = accounts.find(a => a.id === line.accountId);
    if (!account?.requiresAuxiliary) continue;

    const lineRef = `cuenta ${account.code}`;
    switch (account.requiresAuxiliary) {
      case 'CUSTOMER':
        if (!line.customerId) {
          throw new BusinessError(`La ${lineRef} requiere un cliente como auxiliar`);
        }
        break;
      case 'SUPPLIER':
        if (!line.supplierId) {
          throw new BusinessError(`La ${lineRef} requiere un proveedor como auxiliar`);
        }
        break;
      case 'COST_CENTER':
        if (!line.costCenterId) {
          throw new BusinessError(`La ${lineRef} requiere un centro de costo como auxiliar`);
        }
        break;
    }
  }
}

/**
 * Valida que la fecha no esté en un período bloqueado.
 * Usa el modelo AccountingPeriod si hay períodos creados; fallback a lockedUntilDate.
 *
 * @deprecated TSK-760: solo la usa `reverseJournalEntry` hasta la Fase 10, que la
 * reemplaza por `reverseJournalEntryTx` (y entonces se borra). Usar `assertPeriodOpen`.
 */
export async function validatePeriodLock(
  companyId: string,
  date: Date,
  settings?: { lockedUntilDate: Date | null } | null
) {
  const entryDate = moment(date);

  const period = await prisma.accountingPeriod.findFirst({
    where: {
      fiscalYear: { companyId },
      year: entryDate.year(),
      month: entryDate.month() + 1,
      type: 'MONTHLY',
    },
    select: { isClosed: true },
  });

  if (period) {
    if (period.isClosed) {
      throw new Error(
        `No se puede operar en el período ${entryDate.format('MM/YYYY')}. ` +
        `El período está cerrado.`
      );
    }
    return;
  }

  // Fallback: lockedUntilDate (backward compat)
  const lockSettings = settings ?? await prisma.accountingSettings.findUnique({
    where: { companyId },
    select: { lockedUntilDate: true },
  });

  if (lockSettings?.lockedUntilDate) {
    const lockDate = moment(lockSettings.lockedUntilDate);

    if (entryDate.isSameOrBefore(lockDate, 'day')) {
      throw new Error(
        `No se puede operar en el período ${entryDate.format('MM/YYYY')}. ` +
        `Los períodos están bloqueados hasta ${lockDate.format('MM/YYYY')}.`
      );
    }
  }
}

/**
 * Valida que las cuentas se usen según su naturaleza (DEBIT/CREDIT)
 * Emite warnings, no errores (permite flexibilidad contable)
 */
export async function validateAccountNatures(
  companyId: string,
  lines: LineWithAmounts[]
) {
  const accountIds = lines.map(line => line.accountId);
  const accounts = await prisma.account.findMany({
    where: {
      id: { in: accountIds },
      companyId,
    },
    select: { id: true, code: true, name: true, nature: true },
  });

  const warnings: string[] = [];

  for (const line of lines) {
    const account = accounts.find(a => a.id === line.accountId);
    if (!account) continue;

    const debit = toNumber(line.debit);
    const credit = toNumber(line.credit);

    if (account.nature === 'DEBIT' && credit > debit) {
      warnings.push(
        `Cuenta "${account.code} - ${account.name}" tiene naturaleza deudora ` +
        `pero se registra más crédito ($${credit}) que débito ($${debit})`
      );
    }

    if (account.nature === 'CREDIT' && debit > credit) {
      warnings.push(
        `Cuenta "${account.code} - ${account.name}" tiene naturaleza acreedora ` +
        `pero se registra más débito ($${debit}) que crédito ($${credit})`
      );
    }
  }

  if (warnings.length > 0) {
    logger.warn('Advertencias de naturaleza de cuentas', {
      data: { warnings, companyId }
    });
  }

  return warnings;
}

/**
 * Resuelve el fiscalYearId y periodId para una fecha dada.
 * Retorna null si no se encuentra ejercicio (no bloquea, el asiento queda sin período).
 *
 * @deprecated TSK-760: solo la usa `reverseJournalEntry` hasta la Fase 10. Usar
 * `assertPeriodOpen`, que además crea el ejercicio y valida el cierre.
 */
export async function resolveFiscalPeriod(companyId: string, date: Date) {
  const entryDate = moment(date);

  const fiscalYear = await prisma.fiscalYear.findFirst({
    where: {
      companyId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { id: true },
  });

  if (!fiscalYear) return null;

  const period = await prisma.accountingPeriod.findFirst({
    where: {
      fiscalYearId: fiscalYear.id,
      year: entryDate.year(),
      month: entryDate.month() + 1,
      type: 'MONTHLY',
    },
    select: { id: true },
  });

  return {
    fiscalYearId: fiscalYear.id,
    periodId: period?.id ?? null,
  };
}
