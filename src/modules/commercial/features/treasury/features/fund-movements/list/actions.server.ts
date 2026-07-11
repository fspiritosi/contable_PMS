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
// MUTATIONS
// ============================================================================

interface FundSettings {
  defaultBankAccountId: string | null;
  defaultCashAccountId: string | null;
}

interface ResolvedFundSide {
  accountId: string; // cuenta contable para el asiento
  label: string; // snapshot para el historial
  entityId: string; // id del banco/caja
}

/**
 * Aplica un lado del movimiento sobre un banco o caja: registra el movimiento,
 * actualiza el saldo y resuelve la cuenta contable. `direction` 'IN' = entran
 * fondos (ingreso), 'OUT' = salen (egreso).
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
): Promise<ResolvedFundSide> {
  const { companyId, userId, amount, date, description, isTransfer, settings } = ctx;

  if (ref.kind === 'BANK') {
    const bank = await tx.bankAccount.findFirst({
      where: { id: ref.id, companyId, status: 'ACTIVE' },
      select: { id: true, balance: true, accountId: true, bankName: true, accountNumber: true },
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

    return { accountId, label: `${bank.bankName} - ${bank.accountNumber}`, entityId: bank.id };
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

  return { accountId, label: `Caja ${cash.name}`, entityId: cash.id };
}

/**
 * Genera el asiento contable de un movimiento de fondos (2 líneas, balanceado)
 * dentro de la transacción dada, y devuelve el asiento creado.
 */
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
      'No hay configuración contable. Configurá las cuentas por defecto en Ajustes contables antes de registrar movimientos de fondos.'
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

  await tx.accountingSettings.update({
    where: { companyId },
    data: { lastEntryNumber: nextNumber },
  });

  return entry;
}

/** Crea un movimiento de fondos: actualiza saldos de banco/caja y genera el asiento. */
export async function createFundMovement(input: FundMovementFormInput) {
  await checkPermission('commercial.treasury.fund-movements', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const data = fundMovementSchema.parse(input);
  const amountNum = parseFloat(data.amount);
  const amount = new Prisma.Decimal(amountNum);
  const date = moment(data.date, 'YYYY-MM-DD').toDate();
  const isTransfer = data.type === 'ACCOUNT_TRANSFER';

  const sourceRef = data.sourceFund ? parseFundRef(data.sourceFund) : null;
  const destRef = data.destinationFund ? parseFundRef(data.destinationFund) : null;

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: {
        partnerContributionsAccountId: true,
        defaultBankAccountId: true,
        defaultCashAccountId: true,
        partnerContributionsAccount: { select: { code: true, name: true } },
      },
    });

    // Capital: requerido para aporte/retiro
    let capitalAccountId: string | null = null;
    let capitalLabel: string | null = null;
    if (data.type === 'PARTNER_CONTRIBUTION' || data.type === 'PARTNER_WITHDRAWAL') {
      capitalAccountId = settings?.partnerContributionsAccountId ?? null;
      if (!capitalAccountId) {
        throw new Error(
          'Configurá la "Cuenta de aportes de socios" en Ajustes contables antes de registrar aportes o retiros.'
        );
      }
      capitalLabel = settings?.partnerContributionsAccount
        ? `${settings.partnerContributionsAccount.code} - ${settings.partnerContributionsAccount.name}`
        : 'Aportes de socios';
    }

    // Snapshot del socio (informativo)
    let partnerName: string | null = null;
    if (data.partnerId) {
      const partner = await prisma.partner.findFirst({
        where: { id: data.partnerId, companyId },
        select: { name: true },
      });
      partnerName = partner?.name ?? null;
    }

    const fundSettings: FundSettings = {
      defaultBankAccountId: settings?.defaultBankAccountId ?? null,
      defaultCashAccountId: settings?.defaultCashAccountId ?? null,
    };

    const result = await prisma.$transaction(async (tx) => {
      const sideCtx = { companyId, userId, amount, date, description: data.description, isTransfer, settings: fundSettings };

      let debitAccountId: string;
      let creditAccountId: string;
      let sourceAccountId: string | null = null;
      let sourceAccountLabel: string | null = null;
      let destinationAccountId: string | null = null;
      let destinationAccountLabel: string | null = null;

      if (data.type === 'PARTNER_CONTRIBUTION') {
        // Entra a banco/caja destino; contrapartida = capital
        const dest = await applyFundSide(tx, destRef!, 'IN', sideCtx);
        debitAccountId = dest.accountId;
        creditAccountId = capitalAccountId!;
        destinationAccountId = dest.entityId;
        destinationAccountLabel = dest.label;
        sourceAccountLabel = capitalLabel;
      } else if (data.type === 'PARTNER_WITHDRAWAL') {
        // Sale de banco/caja origen; contrapartida = capital
        const src = await applyFundSide(tx, sourceRef!, 'OUT', sideCtx);
        debitAccountId = capitalAccountId!;
        creditAccountId = src.accountId;
        sourceAccountId = src.entityId;
        sourceAccountLabel = src.label;
        destinationAccountLabel = capitalLabel;
      } else {
        // ACCOUNT_TRANSFER: sale del origen, entra al destino
        const src = await applyFundSide(tx, sourceRef!, 'OUT', sideCtx);
        const dest = await applyFundSide(tx, destRef!, 'IN', sideCtx);
        debitAccountId = dest.accountId;
        creditAccountId = src.accountId;
        sourceAccountId = src.entityId;
        sourceAccountLabel = src.label;
        destinationAccountId = dest.entityId;
        destinationAccountLabel = dest.label;
      }

      const entry = await createJournalEntryForFundMovement(
        { companyId, date, description: data.description, amount: amountNum, debitAccountId, creditAccountId },
        tx
      );

      return tx.fundMovement.create({
        data: {
          companyId,
          date,
          type: data.type,
          amount,
          description: data.description,
          sourceAccountId,
          sourceAccountLabel,
          destinationAccountId,
          destinationAccountLabel,
          partnerId: data.partnerId || null,
          partnerName,
          journalEntryId: entry.id,
          journalEntryNumber: entry.number,
          createdBy: userId,
        },
      });
    });

    logger.info('Movimiento de fondos creado', { data: { id: result.id, type: data.type, companyId } });
    revalidatePath('/dashboard/commercial/treasury/fund-movements');
    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    revalidatePath('/dashboard/commercial/treasury/cash-registers');

    return { success: true, id: result.id };
  } catch (error) {
    logger.error('Error al crear movimiento de fondos', { data: { error, input } });
    if (error instanceof Error) throw error;
    throw new Error('Error al crear movimiento de fondos');
  }
}

export type FundMovementListItem = Awaited<ReturnType<typeof getFundMovements>>['data'][number];
export type FundOption = { id: string; label: string };
export type FundMovementPartnerOption = Awaited<
  ReturnType<typeof getFundMovementCatalogs>
>['partners'][number];
