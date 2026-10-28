'use server';

import { revalidatePath } from 'next/cache';

import type {
  InvestmentHoldingStatus,
  InvestmentInstrumentType,
  InvestmentMovementKind,
} from '@/generated/prisma/enums';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import { loadHoldingMovementsTx } from '@/modules/commercial/shared/effects/investment.server';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { ActionResult, BusinessError, toActionResult } from '@/shared/lib/action-result';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';

import { positionAt } from '../shared/position';
import { holdingFormSchema, type HoldingFormInput } from '../shared/validators';

const MODULE = 'commercial.treasury.investments' as const;
const REVALIDATE = '/dashboard/commercial/treasury/investments';

export type InvestmentHoldingRow = {
  id: string;
  name: string;
  instrumentType: InvestmentInstrumentType;
  bankAccountId: string;
  bankAccountLabel: string;
  maturityDate: Date | null;
  status: InvestmentHoldingStatus;
  account: { id: string; code: string; name: string };
  bookValue: number;
  nominals: number | null;
  /** Valor en libros / nominales; null si no hay nominales o son 0 (R2). */
  averagePrice: number | null;
};

export type HoldingMovementRow = {
  id: string;
  date: Date;
  kind: InvestmentMovementKind;
  /** Variación del valor en libros, con signo. */
  amount: number;
  nominals: number | null;
  /** Resultado de la venta (bruto − costo); null si no es una venta. */
  result: number | null;
  fundMovementId: string | null;
  valuationId: string | null;
};

export type InvestmentHoldingDetail = InvestmentHoldingRow & { movements: HoldingMovementRow[] };

const round6 = (n: number) => Math.round((n + Number.EPSILON) * 1_000_000) / 1_000_000;

const holdingSelect = {
  id: true,
  name: true,
  instrumentType: true,
  bankAccountId: true,
  maturityDate: true,
  status: true,
  bankAccount: { select: { bankName: true, accountNumber: true, accountType: true } },
  account: { select: { id: true, code: true, name: true } },
} as const;

async function requireCompanyId(): Promise<string> {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  return companyId;
}

/** Etiqueta del banco o broker; los brokers no llevan número de cuenta. */
function bankLabel(bank: { bankName: string; accountNumber: string; accountType: string }) {
  return bank.accountType === 'BROKER' || !bank.accountNumber
    ? bank.bankName
    : `${bank.bankName} - ${bank.accountNumber}`;
}

/** Posición actual: suma de los movimientos, vía el módulo puro (R2 para el promedio). */
async function currentPosition(holdingId: string) {
  const { bookValue, nominals } = positionAt(
    await loadHoldingMovementsTx(prisma as unknown as Tx, holdingId)
  );
  const averagePrice = nominals ? round6(bookValue / nominals) : null;
  return { bookValue, nominals, averagePrice };
}

type HoldingRecord = Awaited<ReturnType<typeof findHoldings>>[number];

function findHoldings(where: object) {
  return prisma.investmentHolding.findMany({
    where,
    select: holdingSelect,
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });
}

async function toRow(holding: HoldingRecord): Promise<InvestmentHoldingRow> {
  const { bankAccount, ...rest } = holding;
  return {
    ...rest,
    bankAccountLabel: bankLabel(bankAccount),
    ...(await currentPosition(holding.id)),
  };
}

/** Tenencias de la empresa con su posición actual. */
export async function getInvestmentHoldings(
  filters: { bankAccountId?: string; status?: InvestmentHoldingStatus } = {}
): Promise<InvestmentHoldingRow[]> {
  await checkPermission(MODULE, 'view', { redirect: true });
  const companyId = await requireCompanyId();

  const holdings = await findHoldings({
    companyId,
    ...(filters.bankAccountId ? { bankAccountId: filters.bankAccountId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  });
  return Promise.all(holdings.map(toRow));
}

/** Una tenencia con su historia de movimientos, o null si no existe. */
export async function getInvestmentHoldingById(
  id: string
): Promise<InvestmentHoldingDetail | null> {
  await checkPermission(MODULE, 'view', { redirect: true });
  const companyId = await requireCompanyId();

  const [holding] = await findHoldings({ id, companyId });
  if (!holding) return null;

  const movements = await prisma.investmentMovement.findMany({
    where: { holdingId: id },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      date: true,
      kind: true,
      bookDelta: true,
      nominalsDelta: true,
      result: true,
      fundMovementId: true,
      valuationId: true,
    },
  });

  return {
    ...(await toRow(holding)),
    movements: movements.map((m) => ({
      id: m.id,
      date: m.date,
      kind: m.kind,
      amount: Number(m.bookDelta),
      nominals: m.nominalsDelta === null ? null : Number(m.nominalsDelta),
      result: m.result === null ? null : Number(m.result),
      fundMovementId: m.fundMovementId,
      valuationId: m.valuationId,
    })),
  };
}

export interface HoldingFormCatalogs {
  banks: { id: string; label: string; isBroker: boolean }[];
  accounts: { id: string; code: string; name: string }[];
}

/** Bancos/brokers activos y cuentas de activo imputables, para el formulario. */
export async function getHoldingFormCatalogs(): Promise<HoldingFormCatalogs> {
  await checkPermission(MODULE, 'view', { redirect: true });
  const companyId = await requireCompanyId();

  const [banks, accounts] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { id: true, bankName: true, accountNumber: true, accountType: true },
      orderBy: [{ bankName: 'asc' }, { accountNumber: 'asc' }],
    }),
    prisma.account.findMany({
      where: buildImputableAccountsWhere({ companyId, types: ['ASSET'] }),
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    }),
  ]);
  return {
    banks: banks.map((b) => ({
      id: b.id,
      label: bankLabel(b),
      isBroker: b.accountType === 'BROKER',
    })),
    accounts,
  };
}

/** La custodia es una cuenta activa de la empresa y la cuenta contable, de activo imputable. */
async function assertHoldingTargets(
  companyId: string,
  bankAccountId: string | null,
  accountId: string | null
) {
  const [bank, account] = await Promise.all([
    bankAccountId === null
      ? true
      : prisma.bankAccount.findFirst({
          where: { id: bankAccountId, companyId, status: 'ACTIVE' },
          select: { id: true },
        }),
    accountId === null
      ? true
      : prisma.account.findFirst({
          where: { id: accountId, ...buildImputableAccountsWhere({ companyId, types: ['ASSET'] }) },
          select: { id: true },
        }),
  ]);
  if (!bank) throw new BusinessError('El banco o broker no existe o no está activo');
  if (!account) {
    throw new BusinessError('La cuenta contable debe ser imputable y de tipo Activo');
  }
}

const toDate = (value?: string) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

export async function createInvestmentHolding(
  input: HoldingFormInput
): Promise<ActionResult<{ id: string }>> {
  await checkPermission(MODULE, 'create', { redirect: true });
  try {
    const companyId = await requireCompanyId();
    const userId = await getCurrentUserId();
    if (!userId) throw new BusinessError('No autenticado');
    const data = holdingFormSchema.parse(input);
    await assertHoldingTargets(companyId, data.bankAccountId, data.accountId);

    const holding = await prisma.investmentHolding.create({
      data: {
        companyId,
        bankAccountId: data.bankAccountId,
        instrumentType: data.instrumentType,
        name: data.name,
        maturityDate: toDate(data.maturityDate),
        accountId: data.accountId,
        currency: 'ARS',
        createdBy: userId,
      },
      select: { id: true },
    });
    revalidatePath(REVALIDATE);
    return { success: true, id: holding.id };
  } catch (error) {
    return toActionResult(error, 'Error al crear la tenencia');
  }
}

export async function updateInvestmentHolding(
  id: string,
  input: HoldingFormInput
): Promise<ActionResult> {
  await checkPermission(MODULE, 'update', { redirect: true });
  try {
    const companyId = await requireCompanyId();
    const data = holdingFormSchema.parse(input);
    const current = await prisma.investmentHolding.findFirst({
      where: { id, companyId },
      select: {
        bankAccountId: true,
        accountId: true,
        instrumentType: true,
        _count: { select: { movements: true } },
      },
    });
    if (!current) throw new BusinessError('Tenencia no encontrada');

    const hasMovements = current._count.movements > 0;
    const bankChanged = current.bankAccountId !== data.bankAccountId;
    const accountChanged = current.accountId !== data.accountId;
    // Los asientos viejos quedarían contra otra cuenta (o con otra custodia).
    if ((bankChanged || accountChanged) && hasMovements) {
      throw new BusinessError('La tenencia ya tiene movimientos: no se puede cambiar su cuenta');
    }
    // El tipo define si se lleva en nominales y si vence: cambiaría el sentido de lo cargado.
    if (current.instrumentType !== data.instrumentType && hasMovements) {
      throw new BusinessError(
        'La tenencia ya tiene movimientos: no se puede cambiar su tipo de instrumento'
      );
    }
    // Solo se valida lo que cambia: renombrar no depende de que el banco siga activo.
    if (bankChanged || accountChanged) {
      await assertHoldingTargets(
        companyId,
        bankChanged ? data.bankAccountId : null,
        accountChanged ? data.accountId : null
      );
    }

    await prisma.investmentHolding.update({
      where: { id },
      data: {
        bankAccountId: data.bankAccountId,
        instrumentType: data.instrumentType,
        name: data.name,
        maturityDate: toDate(data.maturityDate),
        accountId: data.accountId,
      },
    });
    revalidatePath(REVALIDATE);
    return { success: true };
  } catch (error) {
    return toActionResult(error, 'Error al actualizar la tenencia');
  }
}

export async function deleteInvestmentHolding(id: string): Promise<ActionResult> {
  await checkPermission(MODULE, 'delete', { redirect: true });
  try {
    const companyId = await requireCompanyId();
    const holding = await prisma.investmentHolding.findFirst({
      where: { id, companyId },
      select: { _count: { select: { movements: true, fundMovements: true } } },
    });
    if (!holding) throw new BusinessError('Tenencia no encontrada');
    if (holding._count.movements > 0 || holding._count.fundMovements > 0) {
      throw new BusinessError('La tenencia tiene movimientos y no se puede eliminar');
    }
    await prisma.investmentHolding.delete({ where: { id } });
    revalidatePath(REVALIDATE);
    logger.info('Tenencia eliminada', { data: { id } });
    return { success: true };
  } catch (error) {
    return toActionResult(error, 'Error al eliminar la tenencia');
  }
}
