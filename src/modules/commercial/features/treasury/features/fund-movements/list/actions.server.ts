'use server';

import moment from 'moment';
import { revalidatePath } from 'next/cache';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import { checkPermission } from '@/shared/lib/permissions';
import { Prisma } from '@/generated/prisma/client';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { parseSearchParams, stateToPrismaParams } from '@/shared/components/common/DataTable/helpers';
import {
  fundMovementSchema,
  parseFundRef,
  type FundMovementFormInput,
  type FundSourceKind,
} from '../shared/validators';

// Cliente de transacción de Prisma
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ============================================================================
// QUERIES
// ============================================================================

/** Listado paginado de movimientos de fondos. */
export async function getFundMovements(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.treasury.fund-movements', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);
    const where = { companyId };

    const [movements, total] = await Promise.all([
      prisma.fundMovement.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.fundMovement.count({ where }),
    ]);

    return {
      data: movements.map((m) => ({ ...m, amount: Number(m.amount) })),
      total,
    };
  } catch (error) {
    logger.error('Error al obtener movimientos de fondos', { data: { error, companyId } });
    throw new Error('Error al obtener movimientos de fondos');
  }
}

/** Un movimiento por id (para edición). */
export async function getFundMovementById(id: string) {
  await checkPermission('commercial.treasury.fund-movements', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const movement = await prisma.fundMovement.findFirst({ where: { id, companyId } });
  if (!movement) return null;
  return { ...movement, amount: Number(movement.amount) };
}

/** Catálogos para el formulario: bancos, cajas con sesión abierta, socios y estado de config. */
export async function getFundMovementCatalogs() {
  await checkPermission('commercial.treasury.fund-movements', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [banks, cashRegisters, partners, settings] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { id: true, bankName: true, accountNumber: true },
      orderBy: { bankName: 'asc' },
    }),
    prisma.cashRegister.findMany({
      where: { companyId, status: 'ACTIVE', sessions: { some: { status: 'OPEN' } } },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
    prisma.partner.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.accountingSettings.findUnique({
      where: { companyId },
      select: { partnerContributionsAccountId: true },
    }),
  ]);

  return {
    banks: banks.map((b) => ({ id: b.id, label: `${b.bankName} - ${b.accountNumber}` })),
    cashRegisters: cashRegisters.map((c) => ({ id: c.id, label: `Caja ${c.name}` })),
    partners,
    hasContributionsAccount: Boolean(settings?.partnerContributionsAccountId),
  };
}

// ============================================================================
// HELPERS
// ============================================================================

interface FundSettings {
  defaultBankAccountId: string | null;
  defaultCashAccountId: string | null;
}

/** Valida un banco/caja y devuelve su etiqueta, sin tocar saldos (para DRAFT). */
async function resolveFundRefLabel(
  ref: { kind: FundSourceKind; id: string },
  companyId: string
): Promise<{ kind: FundSourceKind; id: string; label: string }> {
  if (ref.kind === 'BANK') {
    const bank = await prisma.bankAccount.findFirst({
      where: { id: ref.id, companyId, status: 'ACTIVE' },
      select: { bankName: true, accountNumber: true },
    });
    if (!bank) throw new Error('La cuenta bancaria seleccionada no es válida');
    return { kind: 'BANK', id: ref.id, label: `${bank.bankName} - ${bank.accountNumber}` };
  }
  const cash = await prisma.cashRegister.findFirst({
    where: { id: ref.id, companyId, status: 'ACTIVE' },
    select: { name: true },
  });
  if (!cash) throw new Error('La caja seleccionada no es válida');
  return { kind: 'CASH', id: ref.id, label: `Caja ${cash.name}` };
}

/**
 * Aplica un lado del movimiento sobre un banco o caja: registra el movimiento,
 * actualiza el saldo y resuelve la cuenta contable. `direction` 'IN' = entran
 * fondos, 'OUT' = salen.
 */
async function applyFundSide(
  tx: PrismaTransactionClient,
  ref: { kind: FundSourceKind; id: string },
  direction: 'IN' | 'OUT',
  ctx: {
    companyId: string;
    userId: string;
    amount: Prisma.Decimal;
    date: Date;
    description: string;
    isTransfer: boolean;
    settings: FundSettings;
  }
): Promise<{ accountId: string }> {
  const { companyId, userId, amount, date, description, isTransfer, settings } = ctx;

  if (ref.kind === 'BANK') {
    const bank = await tx.bankAccount.findFirst({
      where: { id: ref.id, companyId, status: 'ACTIVE' },
      select: { id: true, balance: true, accountId: true, bankName: true },
    });
    if (!bank) throw new Error('La cuenta bancaria seleccionada no es válida');

    const accountId = bank.accountId ?? settings.defaultBankAccountId;
    if (!accountId) {
      throw new Error(
        `La cuenta bancaria "${bank.bankName}" no tiene cuenta contable asociada. Configurala en la cuenta bancaria o definí una cuenta de banco por defecto en Ajustes contables.`
      );
    }

    const type = isTransfer
      ? direction === 'IN'
        ? 'TRANSFER_IN'
        : 'TRANSFER_OUT'
      : direction === 'IN'
        ? 'DEPOSIT'
        : 'WITHDRAWAL';
    const newBalance = direction === 'IN' ? bank.balance.add(amount) : bank.balance.sub(amount);

    await tx.bankMovement.create({
      data: { bankAccountId: bank.id, companyId, type, amount, date, description, createdBy: userId },
    });
    await tx.bankAccount.update({ where: { id: bank.id }, data: { balance: newBalance } });

    return { accountId };
  }

  // CAJA
  const cash = await tx.cashRegister.findFirst({
    where: { id: ref.id, companyId, status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      accountId: true,
      sessions: { where: { status: 'OPEN' }, select: { id: true, expectedBalance: true }, take: 1 },
    },
  });
  if (!cash) throw new Error('La caja seleccionada no es válida');
  const session = cash.sessions[0];
  if (!session) throw new Error(`La caja "${cash.name}" no tiene una sesión abierta`);

  const accountId = cash.accountId ?? settings.defaultCashAccountId;
  if (!accountId) {
    throw new Error(
      `La caja "${cash.name}" no tiene cuenta contable asociada. Configurala en la caja o definí una cuenta de caja por defecto en Ajustes contables.`
    );
  }

  const newExpected =
    direction === 'IN' ? session.expectedBalance.add(amount) : session.expectedBalance.sub(amount);

  await tx.cashMovement.create({
    data: {
      sessionId: session.id,
      cashRegisterId: cash.id,
      companyId,
      type: direction === 'IN' ? 'INCOME' : 'EXPENSE',
      amount,
      date,
      description,
      createdBy: userId,
    },
  });
  await tx.cashRegisterSession.update({
    where: { id: session.id },
    data: { expectedBalance: newExpected },
  });

  return { accountId };
}

/** Genera el asiento (2 líneas balanceadas) dentro de la transacción. */
async function createJournalEntryForFundMovement(
  input: {
    companyId: string;
    date: Date;
    description: string;
    amount: number;
    debitAccountId: string;
    creditAccountId: string;
  },
  tx: PrismaTransactionClient
) {
  const { companyId, date, description, amount, debitAccountId, creditAccountId } = input;

  const settings = await tx.accountingSettings.findUnique({
    where: { companyId },
    select: { lastEntryNumber: true },
  });
  if (!settings) {
    throw new Error(
      'No hay configuración contable. Configurá las cuentas por defecto en Ajustes contables antes de confirmar movimientos de fondos.'
    );
  }

  const nextNumber = settings.lastEntryNumber + 1;
  const entry = await tx.journalEntry.create({
    data: {
      companyId,
      number: nextNumber,
      date,
      description,
      createdBy: 'system',
      lines: {
        create: [
          { accountId: debitAccountId, debit: new Prisma.Decimal(amount), credit: new Prisma.Decimal(0), description },
          { accountId: creditAccountId, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(amount), description },
        ],
      },
    },
    select: { id: true, number: true },
  });

  await tx.accountingSettings.update({ where: { companyId }, data: { lastEntryNumber: nextNumber } });
  return entry;
}

/** Datos del movimiento resueltos desde el form, para crear/editar en borrador. */
function buildDraftData(data: FundMovementFormInput) {
  const sourceRef = data.sourceFund ? parseFundRef(data.sourceFund) : null;
  const destRef = data.destinationFund ? parseFundRef(data.destinationFund) : null;
  return { sourceRef, destRef };
}

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Crea un movimiento de fondos en BORRADOR (sin asiento ni impacto en saldos).
 * Si `confirm` es true, lo confirma en la misma operación.
 */
export async function createFundMovement(input: FundMovementFormInput, confirm = false) {
  await checkPermission('commercial.treasury.fund-movements', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const data = fundMovementSchema.parse(input);
  const { sourceRef, destRef } = buildDraftData(data);

  try {
    // fundOut = origen (retiro/transferencia); fundIn = destino (aporte/transferencia)
    const fundOut = sourceRef ? await resolveFundRefLabel(sourceRef, companyId) : null;
    const fundIn = destRef ? await resolveFundRefLabel(destRef, companyId) : null;

    let partnerName: string | null = null;
    if (data.partnerId) {
      const partner = await prisma.partner.findFirst({
        where: { id: data.partnerId, companyId },
        select: { name: true },
      });
      partnerName = partner?.name ?? null;
    }

    const created = await prisma.fundMovement.create({
      data: {
        companyId,
        status: 'DRAFT',
        date: moment(data.date, 'YYYY-MM-DD').toDate(),
        type: data.type,
        amount: new Prisma.Decimal(parseFloat(data.amount)),
        description: data.description,
        fundOutKind: fundOut?.kind ?? null,
        fundOutId: fundOut?.id ?? null,
        fundOutLabel: fundOut?.label ?? null,
        fundInKind: fundIn?.kind ?? null,
        fundInId: fundIn?.id ?? null,
        fundInLabel: fundIn?.label ?? null,
        partnerId: data.partnerId || null,
        partnerName,
        createdBy: userId,
      },
      select: { id: true },
    });

    logger.info('Movimiento de fondos creado (borrador)', { data: { id: created.id, companyId } });

    if (confirm) {
      await confirmFundMovement(created.id);
    } else {
      revalidatePath('/dashboard/commercial/treasury/fund-movements');
    }

    return { success: true, id: created.id };
  } catch (error) {
    logger.error('Error al crear movimiento de fondos', { data: { error, input } });
    if (error instanceof Error) throw error;
    throw new Error('Error al crear movimiento de fondos');
  }
}

/** Actualiza un movimiento en BORRADOR (no permitido si ya está confirmado). */
export async function updateFundMovement(id: string, input: FundMovementFormInput) {
  await checkPermission('commercial.treasury.fund-movements', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const existing = await prisma.fundMovement.findFirst({ where: { id, companyId }, select: { status: true } });
  if (!existing) throw new Error('Movimiento no encontrado');
  if (existing.status !== 'DRAFT') throw new Error('Solo se pueden editar movimientos en borrador');

  const data = fundMovementSchema.parse(input);
  const { sourceRef, destRef } = buildDraftData(data);

  try {
    const fundOut = sourceRef ? await resolveFundRefLabel(sourceRef, companyId) : null;
    const fundIn = destRef ? await resolveFundRefLabel(destRef, companyId) : null;

    let partnerName: string | null = null;
    if (data.partnerId) {
      const partner = await prisma.partner.findFirst({
        where: { id: data.partnerId, companyId },
        select: { name: true },
      });
      partnerName = partner?.name ?? null;
    }

    await prisma.fundMovement.update({
      where: { id },
      data: {
        date: moment(data.date, 'YYYY-MM-DD').toDate(),
        type: data.type,
        amount: new Prisma.Decimal(parseFloat(data.amount)),
        description: data.description,
        fundOutKind: fundOut?.kind ?? null,
        fundOutId: fundOut?.id ?? null,
        fundOutLabel: fundOut?.label ?? null,
        fundInKind: fundIn?.kind ?? null,
        fundInId: fundIn?.id ?? null,
        fundInLabel: fundIn?.label ?? null,
        partnerId: data.partnerId || null,
        partnerName,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/fund-movements');
    return { success: true, id };
  } catch (error) {
    logger.error('Error al actualizar movimiento de fondos', { data: { error, id, input } });
    if (error instanceof Error) throw error;
    throw new Error('Error al actualizar movimiento de fondos');
  }
}

/**
 * Confirma un movimiento en borrador: actualiza saldos de banco/caja y genera
 * el asiento contable, de forma atómica. Lo deja CONFIRMED.
 */
export async function confirmFundMovement(id: string) {
  await checkPermission('commercial.treasury.fund-movements', 'update', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const movement = await prisma.fundMovement.findFirst({ where: { id, companyId } });
  if (!movement) throw new Error('Movimiento no encontrado');
  if (movement.status !== 'DRAFT') throw new Error('El movimiento ya fue confirmado o anulado');

  const settings = await prisma.accountingSettings.findUnique({
    where: { companyId },
    select: {
      partnerContributionsAccountId: true,
      defaultBankAccountId: true,
      defaultCashAccountId: true,
    },
  });

  const isTransfer = movement.type === 'ACCOUNT_TRANSFER';
  let capitalAccountId: string | null = null;
  if (movement.type === 'PARTNER_CONTRIBUTION' || movement.type === 'PARTNER_WITHDRAWAL') {
    capitalAccountId = settings?.partnerContributionsAccountId ?? null;
    if (!capitalAccountId) {
      throw new Error(
        'Configurá la "Cuenta de aportes de socios" en Ajustes contables antes de confirmar aportes o retiros.'
      );
    }
  }

  const fundSettings: FundSettings = {
    defaultBankAccountId: settings?.defaultBankAccountId ?? null,
    defaultCashAccountId: settings?.defaultCashAccountId ?? null,
  };
  const amount = new Prisma.Decimal(Number(movement.amount));

  try {
    await prisma.$transaction(async (tx) => {
      const sideCtx = {
        companyId,
        userId,
        amount,
        date: movement.date,
        description: movement.description,
        isTransfer,
        settings: fundSettings,
      };

      let debitAccountId: string;
      let creditAccountId: string;

      if (movement.type === 'PARTNER_CONTRIBUTION') {
        if (!movement.fundInKind || !movement.fundInId) throw new Error('Falta el banco/caja destino');
        const dest = await applyFundSide(
          tx,
          { kind: movement.fundInKind as FundSourceKind, id: movement.fundInId },
          'IN',
          sideCtx
        );
        debitAccountId = dest.accountId;
        creditAccountId = capitalAccountId!;
      } else if (movement.type === 'PARTNER_WITHDRAWAL') {
        if (!movement.fundOutKind || !movement.fundOutId) throw new Error('Falta el banco/caja origen');
        const src = await applyFundSide(
          tx,
          { kind: movement.fundOutKind as FundSourceKind, id: movement.fundOutId },
          'OUT',
          sideCtx
        );
        debitAccountId = capitalAccountId!;
        creditAccountId = src.accountId;
      } else {
        if (!movement.fundOutKind || !movement.fundOutId) throw new Error('Falta el banco/caja origen');
        if (!movement.fundInKind || !movement.fundInId) throw new Error('Falta el banco/caja destino');
        const src = await applyFundSide(
          tx,
          { kind: movement.fundOutKind as FundSourceKind, id: movement.fundOutId },
          'OUT',
          sideCtx
        );
        const dest = await applyFundSide(
          tx,
          { kind: movement.fundInKind as FundSourceKind, id: movement.fundInId },
          'IN',
          sideCtx
        );
        debitAccountId = dest.accountId;
        creditAccountId = src.accountId;
      }

      const entry = await createJournalEntryForFundMovement(
        {
          companyId,
          date: movement.date,
          description: movement.description,
          amount: Number(movement.amount),
          debitAccountId,
          creditAccountId,
        },
        tx
      );

      await tx.fundMovement.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          journalEntryId: entry.id,
          journalEntryNumber: entry.number,
          confirmedAt: new Date(),
        },
      });
    });

    logger.info('Movimiento de fondos confirmado', { data: { id, companyId } });
    revalidatePath('/dashboard/commercial/treasury/fund-movements');
    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    revalidatePath('/dashboard/commercial/treasury/cash-registers');
    return { success: true };
  } catch (error) {
    logger.error('Error al confirmar movimiento de fondos', { data: { error, id } });
    if (error instanceof Error) throw error;
    throw new Error('Error al confirmar movimiento de fondos');
  }
}

/** Elimina un movimiento en BORRADOR (los confirmados no se pueden borrar acá). */
export async function deleteFundMovement(id: string) {
  await checkPermission('commercial.treasury.fund-movements', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const existing = await prisma.fundMovement.findFirst({ where: { id, companyId }, select: { status: true } });
  if (!existing) throw new Error('Movimiento no encontrado');
  if (existing.status !== 'DRAFT') {
    throw new Error('Solo se pueden eliminar movimientos en borrador');
  }

  await prisma.fundMovement.delete({ where: { id } });
  logger.info('Movimiento de fondos eliminado (borrador)', { data: { id, companyId } });
  revalidatePath('/dashboard/commercial/treasury/fund-movements');
  return { success: true };
}

export type FundMovementListItem = Awaited<ReturnType<typeof getFundMovements>>['data'][number];
export type FundMovementRecord = NonNullable<Awaited<ReturnType<typeof getFundMovementById>>>;
export type FundOption = { id: string; label: string };
export type FundMovementPartnerOption = Awaited<
  ReturnType<typeof getFundMovementCatalogs>
>['partners'][number];
