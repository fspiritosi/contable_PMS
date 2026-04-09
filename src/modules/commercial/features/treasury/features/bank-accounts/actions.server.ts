'use server';

import { auth } from '@clerk/nextjs/server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import { bankAccountSchema, type BankAccountFormData } from '../../shared/validators';
import { checkPermission } from '@/shared/lib/permissions';

/**
 * Crea una nueva cuenta bancaria
 */
export async function createBankAccount(data: BankAccountFormData) {
  await checkPermission('commercial.treasury.bank-accounts', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Validar datos
    const validated = bankAccountSchema.parse(data);

    // Para tipos no bancarios, generar número de cuenta si no se proporcionó
    const NON_BANK_TYPES = ['CASH', 'VIRTUAL_WALLET'];
    const accountNumber = !validated.accountNumber && NON_BANK_TYPES.includes(validated.accountType)
      ? `${validated.accountType}-${Date.now()}`
      : validated.accountNumber || '';

    // Verificar número de cuenta duplicado
    if (accountNumber) {
      const existing = await prisma.bankAccount.findFirst({
        where: {
          companyId,
          accountNumber,
        },
        select: { id: true },
      });

      if (existing) {
        throw new Error('Ya existe una cuenta con ese número');
      }
    }

    // Crear cuenta bancaria
    const balance = validated.balance ? new Prisma.Decimal(validated.balance) : new Prisma.Decimal(0);

    const bankAccount = await prisma.bankAccount.create({
      data: {
        companyId,
        bankName: validated.bankName || validated.accountType,
        accountNumber,
        accountType: validated.accountType,
        cbu: validated.cbu || null,
        alias: validated.alias || null,
        currency: validated.currency,
        balance,
        accountId: validated.accountId || null,
        createdBy: userId,
      },
    });

    logger.info('Cuenta bancaria creada', {
      data: {
        bankAccountId: bankAccount.id,
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return { success: true, id: bankAccount.id };
  } catch (error) {
    logger.error('Error al crear cuenta bancaria', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al crear cuenta bancaria');
  }
}

/**
 * Actualiza una cuenta bancaria existente
 */
export async function updateBankAccount(id: string, data: BankAccountFormData) {
  await checkPermission('commercial.treasury.bank-accounts', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Validar datos
    const validated = bankAccountSchema.parse(data);

    // Verificar que la cuenta existe y pertenece a la empresa
    const existing = await prisma.bankAccount.findFirst({
      where: { id, companyId },
      select: { id: true, accountNumber: true },
    });

    if (!existing) {
      throw new Error('Cuenta bancaria no encontrada');
    }

    // Para tipos no bancarios, generar número de cuenta si no se proporcionó
    const NON_BANK_TYPES = ['CASH', 'VIRTUAL_WALLET'];
    const accountNumber = !validated.accountNumber && NON_BANK_TYPES.includes(validated.accountType)
      ? existing.accountNumber
      : validated.accountNumber || existing.accountNumber;

    // Verificar número de cuenta duplicado (excluyendo la cuenta actual)
    if (accountNumber !== existing.accountNumber) {
      const duplicate = await prisma.bankAccount.findFirst({
        where: {
          companyId,
          accountNumber,
          id: { not: id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new Error('Ya existe una cuenta con ese número');
      }
    }

    // Actualizar cuenta bancaria (no actualizar balance aquí, solo con movimientos)
    const bankAccount = await prisma.bankAccount.update({
      where: { id },
      data: {
        bankName: validated.bankName || validated.accountType,
        accountNumber,
        accountType: validated.accountType,
        cbu: validated.cbu || null,
        alias: validated.alias || null,
        currency: validated.currency,
        accountId: validated.accountId || null,
      },
    });

    logger.info('Cuenta bancaria actualizada', {
      data: {
        bankAccountId: bankAccount.id,
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return { success: true, id: bankAccount.id };
  } catch (error) {
    logger.error('Error al actualizar cuenta bancaria', { data: { error, id } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al actualizar cuenta bancaria');
  }
}

/**
 * Obtiene una cuenta bancaria por ID
 */
export async function getBankAccountById(id: string) {
  await checkPermission('commercial.treasury.bank-accounts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        accountType: true,
        cbu: true,
        alias: true,
        currency: true,
        balance: true,
        accountId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!bankAccount) {
      return null;
    }

    // Calcular saldo real desde los movimientos bancarios
    const INCOME_TYPES = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST', 'CHECK'];
    const movements = await prisma.bankMovement.findMany({
      where: { bankAccountId: id, companyId },
      select: { type: true, amount: true },
    });

    let calculatedBalance = 0;
    for (const m of movements) {
      const amount = Number(m.amount);
      if (INCOME_TYPES.includes(m.type)) {
        calculatedBalance += amount;
      } else {
        calculatedBalance -= amount;
      }
    }

    // Sincronizar el saldo almacenado si difiere del calculado
    const storedBalance = Number(bankAccount.balance);
    if (Math.abs(storedBalance - calculatedBalance) > 0.01) {
      logger.warn('Saldo almacenado difiere del calculado, sincronizando', {
        data: {
          bankAccountId: id,
          storedBalance,
          calculatedBalance,
          difference: storedBalance - calculatedBalance,
        },
      });
      await prisma.bankAccount.update({
        where: { id },
        data: { balance: new Prisma.Decimal(calculatedBalance) },
      });
    }

    return {
      ...bankAccount,
      balance: calculatedBalance,
    };
  } catch (error) {
    logger.error('Error al obtener cuenta bancaria', { data: { error, id } });
    throw new Error('Error al obtener cuenta bancaria');
  }
}

/**
 * Desactiva una cuenta bancaria
 */
export async function deactivateBankAccount(id: string) {
  await checkPermission('commercial.treasury.bank-accounts', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que la cuenta existe y pertenece a la empresa
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        balance: true,
      },
    });

    if (!bankAccount) {
      throw new Error('Cuenta bancaria no encontrada');
    }

    // Advertir si tiene saldo
    if (!bankAccount.balance.isZero()) {
      logger.warn('Desactivando cuenta bancaria con saldo', {
        data: {
          bankAccountId: id,
          balance: bankAccount.balance.toNumber(),
        },
      });
    }

    // Desactivar cuenta
    await prisma.bankAccount.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });

    logger.info('Cuenta bancaria desactivada', {
      data: {
        bankAccountId: id,
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return { success: true };
  } catch (error) {
    logger.error('Error al desactivar cuenta bancaria', { data: { error, id } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al desactivar cuenta bancaria');
  }
}

/**
 * Activa una cuenta bancaria desactivada
 */
export async function activateBankAccount(id: string) {
  await checkPermission('commercial.treasury.bank-accounts', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que la cuenta existe y pertenece a la empresa
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id, companyId },
      select: { id: true, bankName: true, accountNumber: true },
    });

    if (!bankAccount) {
      throw new Error('Cuenta bancaria no encontrada');
    }

    // Activar cuenta
    await prisma.bankAccount.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    logger.info('Cuenta bancaria activada', {
      data: {
        bankAccountId: id,
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return { success: true };
  } catch (error) {
    logger.error('Error al activar cuenta bancaria', { data: { error, id } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al activar cuenta bancaria');
  }
}

/**
 * Cierra una cuenta bancaria (permanente)
 */
export async function closeBankAccount(id: string) {
  await checkPermission('commercial.treasury.bank-accounts', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que la cuenta existe y pertenece a la empresa
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        balance: true,
      },
    });

    if (!bankAccount) {
      throw new Error('Cuenta bancaria no encontrada');
    }

    // No permitir cerrar cuenta con saldo
    if (!bankAccount.balance.isZero()) {
      throw new Error('No se puede cerrar una cuenta con saldo. Debe estar en $0.00');
    }

    // Cerrar cuenta
    await prisma.bankAccount.update({
      where: { id },
      data: { status: 'CLOSED' },
    });

    logger.info('Cuenta bancaria cerrada', {
      data: {
        bankAccountId: id,
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return { success: true };
  } catch (error) {
    logger.error('Error al cerrar cuenta bancaria', { data: { error, id } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al cerrar cuenta bancaria');
  }
}
