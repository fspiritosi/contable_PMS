import { AccountNature, AccountType } from '@/generated/prisma/enums';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';

/**
 * Valida que el código de cuenta sea único para la empresa
 */
export async function validateAccountCode(companyId: string, code: string, excludeId?: string) {
  const existingAccount = await prisma.account.findFirst({
    where: {
      companyId,
      code,
      id: excludeId ? { not: excludeId } : undefined,
    },
  });

  if (existingAccount) {
    throw new Error(`Ya existe una cuenta con el código ${code}`);
  }
}

/**
 * Valida que el parent exista y pertenezca a la misma empresa
 */
export async function validateAccountParent(companyId: string, parentId?: string) {
  if (!parentId) return;

  const parent = await prisma.account.findUnique({
    where: { id: parentId },
  });

  if (!parent) {
    throw new Error('La cuenta padre no existe');
  }

  if (parent.companyId !== companyId) {
    throw new Error('La cuenta padre no pertenece a la empresa');
  }
}

/**
 * Valida que la cuenta padre exista, pertenezca a la empresa y sea del MISMO tipo
 * que la cuenta hija. Además evita ciclos triviales (que sea su propio padre).
 * Ticket #376: el selector de padre se limita al mismo `type`.
 */
export async function validateAccountParentSameType(
  companyId: string,
  parentId: string | undefined,
  childType: AccountType,
  selfAccountId?: string
) {
  if (!parentId) return;

  if (selfAccountId && parentId === selfAccountId) {
    throw new Error('Una cuenta no puede ser su propia cuenta padre');
  }

  const parent = await prisma.account.findUnique({
    where: { id: parentId },
    select: { id: true, companyId: true, type: true },
  });

  if (!parent) {
    throw new Error('La cuenta padre no existe');
  }

  if (parent.companyId !== companyId) {
    throw new Error('La cuenta padre no pertenece a la empresa');
  }

  if (parent.type !== childType) {
    throw new Error('La cuenta padre debe ser del mismo tipo que la cuenta');
  }
}

/**
 * Valida que la naturaleza de la cuenta sea correcta según su tipo
 */
export function validateAccountNature(type: AccountType, nature: AccountNature) {
  const validNatures: Record<AccountType, AccountNature> = {
    [AccountType.ASSET]: AccountNature.DEBIT,
    [AccountType.LIABILITY]: AccountNature.CREDIT,
    [AccountType.EQUITY]: AccountNature.CREDIT,
    [AccountType.REVENUE]: AccountNature.CREDIT,
    [AccountType.EXPENSE]: AccountNature.DEBIT,
  };

  if (validNatures[type] !== nature) {
    throw new Error(`La naturaleza ${nature} no es válida para una cuenta de tipo ${type}`);
  }
}

/**
 * Valida que las cuentas del asiento existan y pertenezcan a la empresa
 */
export async function validateJournalEntryAccounts(companyId: string, accountIds: string[]) {
  const accounts = await prisma.account.findMany({
    where: {
      id: { in: accountIds },
      companyId,
    },
    select: { id: true },
  });

  if (accounts.length !== accountIds.length) {
    throw new Error('Una o más cuentas no existen o no pertenecen a la empresa');
  }
}

/**
 * Valida que el asiento esté balanceado (Debe = Haber)
 */
export function validateJournalEntryBalance(debitTotal: number, creditTotal: number) {
  if (Math.abs(debitTotal - creditTotal) >= 0.01) {
    throw new Error('El asiento debe estar balanceado (Debe = Haber)');
  }
}

/**
 * Valida que la fecha del asiento esté dentro del ejercicio fiscal
 */
export async function validateJournalEntryDate(companyId: string, date: Date) {
  const settings = await prisma.accountingSettings.findUnique({
    where: { companyId },
  });

  if (!settings) {
    throw new Error('La empresa no tiene configuración contable');
  }

  if (date < settings.fiscalYearStart || date > settings.fiscalYearEnd) {
    throw new Error('La fecha del asiento debe estar dentro del ejercicio fiscal');
  }
}

/**
 * Valida que el ejercicio fiscal sea válido
 */
export function validateFiscalYear(startDate: Date, endDate: Date) {
  if (endDate <= startDate) {
    throw new Error('La fecha de fin debe ser posterior a la fecha de inicio');
  }

  // Validar que sea un año o menos
  const yearInMs = 366 * 24 * 60 * 60 * 1000; // 366 días para contemplar años bisiestos
  if (endDate.getTime() - startDate.getTime() > yearInMs) {
    throw new Error('El ejercicio fiscal no puede ser mayor a un año');
  }
}
