'use server';

import moment from 'moment';
import { revalidatePath } from 'next/cache';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import { checkPermission } from '@/shared/lib/permissions';
import { Prisma } from '@/generated/prisma/client';
import { AccountType } from '@/generated/prisma/enums';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { parseSearchParams, stateToPrismaParams } from '@/shared/components/common/DataTable/helpers';
import { fundMovementSchema, type FundMovementFormInput } from '../shared/validators';

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

/** Catálogos para el formulario de alta: cuentas patrimoniales, socios y estado de la cuenta de aportes. */
export async function getFundMovementCatalogs() {
  await checkPermission('commercial.treasury.fund-movements', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [accounts, partners, settings] = await Promise.all([
    prisma.account.findMany({
      where: buildImputableAccountsWhere({
        companyId,
        types: [AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY],
      }),
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: 'asc' },
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
    accounts,
    partners,
    hasContributionsAccount: Boolean(settings?.partnerContributionsAccountId),
  };
}

// ============================================================================
// MUTATIONS
// ============================================================================

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
          {
            accountId: debitAccountId,
            debit: new Prisma.Decimal(amount),
            credit: new Prisma.Decimal(0),
            description,
          },
          {
            accountId: creditAccountId,
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(amount),
            description,
          },
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

/** Crea un movimiento de fondos y su asiento contable automático. */
export async function createFundMovement(input: FundMovementFormInput) {
  await checkPermission('commercial.treasury.fund-movements', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const data = fundMovementSchema.parse(input);
  const amount = parseFloat(data.amount);
  const date = moment(data.date, 'YYYY-MM-DD').toDate();

  try {
    // Cargar cuenta de aportes (aporte/retiro) y validar las cuentas elegidas
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: {
        partnerContributionsAccountId: true,
        partnerContributionsAccount: { select: { id: true, code: true, name: true } },
      },
    });

    const accountIds = [data.sourceAccountId, data.destinationAccountId].filter(
      (id): id is string => Boolean(id)
    );
    const accounts = await prisma.account.findMany({
      where: { companyId, id: { in: accountIds } },
      select: { id: true, code: true, name: true },
    });
    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    const label = (id?: string | null) => {
      if (!id) return null;
      const a = accountMap.get(id);
      return a ? `${a.code} - ${a.name}` : null;
    };

    // Determinar las cuentas del asiento (debe/haber) según el tipo
    let debitAccountId: string;
    let creditAccountId: string;
    let sourceAccountId: string | null = null;
    let destinationAccountId: string | null = null;

    if (data.type === 'PARTNER_CONTRIBUTION' || data.type === 'PARTNER_WITHDRAWAL') {
      const capitalAccountId = settings?.partnerContributionsAccountId;
      if (!capitalAccountId) {
        throw new Error(
          'Configurá la "Cuenta de aportes de socios" en Ajustes contables antes de registrar aportes o retiros.'
        );
      }
      if (data.type === 'PARTNER_CONTRIBUTION') {
        destinationAccountId = data.destinationAccountId || null;
        if (!destinationAccountId || !accountMap.has(destinationAccountId)) {
          throw new Error('La cuenta de destino no es válida');
        }
        debitAccountId = destinationAccountId; // entra a banco/caja
        creditAccountId = capitalAccountId; // aumenta el capital
      } else {
        sourceAccountId = data.sourceAccountId || null;
        if (!sourceAccountId || !accountMap.has(sourceAccountId)) {
          throw new Error('La cuenta de origen no es válida');
        }
        debitAccountId = capitalAccountId; // disminuye el capital
        creditAccountId = sourceAccountId; // sale de banco/caja
      }
    } else {
      // ACCOUNT_TRANSFER
      sourceAccountId = data.sourceAccountId || null;
      destinationAccountId = data.destinationAccountId || null;
      if (!sourceAccountId || !accountMap.has(sourceAccountId)) {
        throw new Error('La cuenta de origen no es válida');
      }
      if (!destinationAccountId || !accountMap.has(destinationAccountId)) {
        throw new Error('La cuenta de destino no es válida');
      }
      debitAccountId = destinationAccountId; // entra a la cuenta destino
      creditAccountId = sourceAccountId; // sale de la cuenta origen
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

    const capitalLabel = settings?.partnerContributionsAccount
      ? `${settings.partnerContributionsAccount.code} - ${settings.partnerContributionsAccount.name}`
      : null;

    const result = await prisma.$transaction(async (tx) => {
      const entry = await createJournalEntryForFundMovement(
        { companyId, date, description: data.description, amount, debitAccountId, creditAccountId },
        tx
      );

      return tx.fundMovement.create({
        data: {
          companyId,
          date,
          type: data.type,
          amount: new Prisma.Decimal(amount),
          description: data.description,
          sourceAccountId,
          sourceAccountLabel:
            data.type === 'PARTNER_WITHDRAWAL' ? capitalLabel : label(sourceAccountId),
          destinationAccountId,
          destinationAccountLabel: label(destinationAccountId),
          partnerId: data.partnerId || null,
          partnerName,
          journalEntryId: entry.id,
          journalEntryNumber: entry.number,
          createdBy: userId,
        },
      });
    });

    logger.info('Movimiento de fondos creado', {
      data: { id: result.id, type: data.type, companyId },
    });
    revalidatePath('/dashboard/commercial/treasury/fund-movements');

    return { success: true, id: result.id };
  } catch (error) {
    logger.error('Error al crear movimiento de fondos', { data: { error, input } });
    if (error instanceof Error) throw error;
    throw new Error('Error al crear movimiento de fondos');
  }
}

export type FundMovementListItem = Awaited<ReturnType<typeof getFundMovements>>['data'][number];
export type FundMovementAccountOption = Awaited<
  ReturnType<typeof getFundMovementCatalogs>
>['accounts'][number];
export type FundMovementPartnerOption = Awaited<
  ReturnType<typeof getFundMovementCatalogs>
>['partners'][number];
