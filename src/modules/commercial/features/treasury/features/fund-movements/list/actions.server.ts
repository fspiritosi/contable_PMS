'use server';

import { revalidatePath } from 'next/cache';

import { Prisma } from '@/generated/prisma/client';
import type { FundMovementType } from '@/generated/prisma/enums';
import type { DocumentEntryOptions } from '@/modules/accounting/features/integrations/commercial';
import {
  createJournalEntryTx,
  rewriteDraftJournalEntryTx,
} from '@/modules/accounting/features/integrations/core';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { ActionResult, BusinessError, toActionResult } from '@/shared/lib/action-result';
import { getActiveCompanyId } from '@/shared/lib/company';
import {
  countActiveConcepts,
  getActiveConceptOptions,
  resolveConceptForUsage,
  type ConceptOption,
} from '@/shared/lib/concepts/concepts.server';
import { fundMovementUsage } from '@/shared/lib/concepts/usages';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { PARTNER_CONTRIBUTION_ACCOUNT_TYPES } from '../../partners/shared/types';
import { sumLines } from '../shared/lines-calc';
import {
  fundMovementSchema,
  parseFundMovementDate,
  parseFundRef,
  type FundMovementFormInput,
  type FundSourceKind,
} from '../shared/validators';

// Cliente de transacción de Prisma
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Resultado de una mutación. Los errores esperables viajan como dato, no como
 * excepción (TSK-481). `BusinessError` y `toActionResult` viven en
 * `@/shared/lib/action-result` desde TSK-721, compartidos con la confirmación de
 * facturas.
 */
export type FundMovementActionResult = ActionResult<{ id?: string }>;

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

  const movement = await prisma.fundMovement.findFirst({
    where: { id, companyId },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  if (!movement) return null;
  return {
    ...movement,
    amount: Number(movement.amount),
    // TSK-791: la cuenta contable de la línea no viaja al cliente (Gestión no ve cuentas).
    lines: movement.lines.map((line) => ({
      id: line.id,
      movementId: line.movementId,
      description: line.description,
      amount: Number(line.amount),
      position: line.position,
      conceptId: line.conceptId,
      conceptName: line.conceptName,
      createdAt: line.createdAt,
      updatedAt: line.updatedAt,
    })),
  };
}

/** Tipos de movimiento de fondo que imputan por concepto (TSK-791). */
export type FundMovementConceptType = Exclude<FundMovementType, 'ACCOUNT_TRANSFER'>;

/** Un concepto como lo ve Gestión: id, nombre y modo, nunca la cuenta (TSK-791). */
export type FundMovementConceptOption = ConceptOption;

/** Conceptos activos por tipo de movimiento, para los combos del formulario. */
export type FundMovementConceptCatalog = Record<
  FundMovementConceptType,
  FundMovementConceptOption[]
>;

/**
 * Catálogos para el formulario: bancos, cajas con sesión abierta, socios (con
 * su cuenta de aportes), cuenta de aportes por defecto y los conceptos activos
 * de cada tipo (TSK-791). La cuenta de gastos bancarios por defecto (TSK-718)
 * ya no viaja: la cuenta de cada línea sale de su concepto.
 */
export async function getFundMovementCatalogs() {
  await checkPermission('commercial.treasury.fund-movements', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [banks, cashRegisters, partners, settings, conceptsByUsage] = await Promise.all([
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
      select: {
        id: true,
        name: true,
        contributionsAccount: { select: { id: true, code: true, name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.accountingSettings.findUnique({
      where: { companyId },
      select: {
        partnerContributionsAccount: { select: { id: true, code: true, name: true } },
      },
    }),
    // Gestión los lee con su propio permiso: no necesita `accounting.concepts`.
    getActiveConceptOptions(prisma, companyId, [
      'FUND_BANK_CHARGES',
      'FUND_PARTNER_CONTRIBUTION',
      'FUND_PARTNER_WITHDRAWAL',
    ]),
  ]);

  const concepts: FundMovementConceptCatalog = {
    BANK_CHARGES: conceptsByUsage.FUND_BANK_CHARGES,
    PARTNER_CONTRIBUTION: conceptsByUsage.FUND_PARTNER_CONTRIBUTION,
    PARTNER_WITHDRAWAL: conceptsByUsage.FUND_PARTNER_WITHDRAWAL,
  };

  return {
    banks: banks.map((b) => ({ id: b.id, label: `${b.bankName} - ${b.accountNumber}` })),
    cashRegisters: cashRegisters.map((c) => ({ id: c.id, label: `Caja ${c.name}` })),
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name,
      contributionsAccount: p.contributionsAccount,
    })),
    // TSK-717: reemplaza `hasContributionsAccount: boolean`. El modal necesita
    // código y nombre para decir "se usará la cuenta por defecto X".
    defaultContributionsAccount: settings?.partnerContributionsAccount ?? null,
    concepts,
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
    if (!bank) throw new BusinessError('La cuenta bancaria seleccionada no es válida');
    return { kind: 'BANK', id: ref.id, label: `${bank.bankName} - ${bank.accountNumber}` };
  }
  const cash = await prisma.cashRegister.findFirst({
    where: { id: ref.id, companyId, status: 'ACTIVE' },
    select: { name: true },
  });
  if (!cash) throw new BusinessError('La caja seleccionada no es válida');
  return { kind: 'CASH', id: ref.id, label: `Caja ${cash.name}` };
}

/**
 * De dónde salió la cuenta de capital del asiento (para el log y los tests).
 * `concept`: la cuenta propia del concepto del movimiento (TSK-791).
 */
type CapitalAccountSource = 'partner' | 'default' | 'concept';

interface ResolvedCapitalAccount {
  accountId: string;
  source: CapitalAccountSource;
  partnerName: string;
}

/**
 * Socio de un aporte o retiro al confirmar (pasos 1 y 2 de
 * `resolvePartnerCapitalAccount`). Se separó en TSK-791 porque el socio sigue
 * siendo obligatorio aunque el concepto tenga cuenta propia y su cuenta de
 * aportes no se use.
 */
async function findMovementPartner(
  tx: PrismaTransactionClient,
  companyId: string,
  partnerId: string | null
) {
  if (!partnerId) {
    throw new BusinessError(
      'Este movimiento no tiene socio asignado. Editá el movimiento y elegí el socio antes de confirmarlo.'
    );
  }

  const partner = await tx.partner.findFirst({
    where: { id: partnerId, companyId },
    select: {
      name: true,
      contributionsAccount: { select: { id: true, code: true, name: true } },
    },
  });
  if (!partner) {
    throw new BusinessError(
      'El socio del movimiento ya no existe. Editá el movimiento y elegí otro socio.'
    );
  }
  return partner;
}

/**
 * Cuenta de capital de un aporte o retiro (TSK-717):
 * `partner.contributionsAccountId ?? settings.partnerContributionsAccountId`.
 *
 * Se ejecuta DENTRO de la transacción de `confirmFundMovement`, con el mismo
 * `tx` que escribe el asiento. Todos los errores son `BusinessError`: viajan
 * al modal como `{ success: false, error }` y el movimiento queda en DRAFT.
 *
 *  1. Sin `partnerId`           → borrador anterior a TSK-717: error, editar y elegir socio.
 *  2. Socio inexistente         → borrado o de otra empresa: error, elegir otro socio.
 *                                 No bloquea por `isActive`: el borrador se creó cuando estaba activo.
 *  3. Cuenta propia asignada    → tiene que ser imputable (hoja, activa, sin corte vigente) y
 *                                 de tipo ASSET/LIABILITY/EQUITY. Si no lo es → error.
 *                                 NUNCA cae a la global en este caso: sería imputar en silencio a
 *                                 otra cuenta, justo lo que la clienta denunció en 413/706.
 *  4. Sin cuenta propia         → global si existe (`source: 'default'`); si tampoco → error que
 *                                 nombra al socio y dice dónde configurarla.
 */
async function resolvePartnerCapitalAccount(
  tx: PrismaTransactionClient,
  companyId: string,
  partnerId: string | null,
  defaultAccountId: string | null
): Promise<ResolvedCapitalAccount> {
  const partner = await findMovementPartner(tx, companyId, partnerId);

  // Con la FK `SetNull` nunca hay id sin cuenta, así que alcanza con mirar la relación.
  if (partner.contributionsAccount) {
    const { id, code, name } = partner.contributionsAccount;
    // Imputabilidad con `buildImputableAccountsWhere` y no a mano: incluye el
    // corte por ejercicio (`disabledFrom`) que `assertLineAccounts` se olvidaba (TSK-585).
    const imputable = await tx.account.findFirst({
      where: {
        ...buildImputableAccountsWhere({ companyId, types: PARTNER_CONTRIBUTION_ACCOUNT_TYPES }),
        id,
      },
      select: { id: true },
    });
    if (!imputable) {
      throw new BusinessError(
        `La cuenta de aportes "${code} - ${name}" del socio "${partner.name}" no está activa o no es imputable. Corregila en Tesorería → Socios → Editar.`
      );
    }
    return { accountId: id, source: 'partner', partnerName: partner.name };
  }

  if (!defaultAccountId) {
    throw new BusinessError(
      `El socio "${partner.name}" no tiene cuenta de aportes y no hay una cuenta por defecto. Asignale una en Tesorería → Socios → Editar, o configurá la "Cuenta de aportes de socios por defecto" en Ajustes contables.`
    );
  }
  return { accountId: defaultAccountId, source: 'default', partnerName: partner.name };
}

/** Un concepto de gastos bancarios ya validado, con su cuenta (TSK-791). */
interface ResolvedLineConcept {
  id: string;
  name: string;
  accountId: string;
}

/**
 * Valida el concepto de una línea de gastos bancarios y devuelve su cuenta. Se
 * usa al guardar y al confirmar: Contabilidad puede haberlo desactivado, haberle
 * quitado el uso o haberle cambiado la cuenta entre una cosa y otra (TSK-791).
 *
 * `cache` evita volver a consultar el mismo concepto cuando varias líneas lo
 * repiten (es habitual: "Comisión" e "IVA sobre comisión" del mismo mes).
 */
async function resolveLineConcept(
  db: PrismaTransactionClient,
  companyId: string,
  conceptId: string,
  cache: Map<string, ResolvedLineConcept>
): Promise<ResolvedLineConcept> {
  const cached = cache.get(conceptId);
  if (cached) return cached;

  const concept = await resolveConceptForUsage(db, {
    companyId,
    conceptId,
    usage: 'FUND_BANK_CHARGES',
  });
  // Un concepto de gastos bancarios siempre tiene cuenta propia (lo exige el ABM
  // de Contabilidad); se verifica igual para no imputar a una cuenta nula.
  if (!concept.accountId) {
    throw new BusinessError(
      `El concepto «${concept.name}» no tiene cuenta propia. Pedile a Contabilidad que la corrija en Empresa → Contabilidad → Conceptos.`
    );
  }
  const resolved = { id: concept.id, name: concept.name, accountId: concept.accountId };
  cache.set(conceptId, resolved);
  return resolved;
}

/**
 * Cuenta de capital de un aporte o retiro al confirmar, con conceptos (TSK-791).
 * El concepto se vuelve a resolver acá porque Contabilidad pudo cambiarlo
 * mientras el movimiento estaba en borrador. Corre dentro de la transacción y
 * ANTES de `applyFundSide`, así un rechazo no mueve saldos.
 *
 *  - Sin concepto y con conceptos activos para el tipo → error: editar y elegir uno
 *    (borradores creados antes de que existieran conceptos para el tipo).
 *  - Sin concepto y sin conceptos activos → exactamente como antes (TSK-717).
 *  - Concepto "cuenta del socio"          → `resolvePartnerCapitalAccount`, como antes.
 *  - Concepto con cuenta propia           → la cuenta del concepto. El socio sigue
 *                                           siendo obligatorio, aunque su cuenta no se use.
 */
async function resolveMovementCapitalAccount(
  tx: PrismaTransactionClient,
  companyId: string,
  movement: {
    type: 'PARTNER_CONTRIBUTION' | 'PARTNER_WITHDRAWAL';
    partnerId: string | null;
    conceptId: string | null;
  },
  defaultAccountId: string | null
): Promise<ResolvedCapitalAccount & { conceptName: string | null }> {
  const usage = fundMovementUsage(movement.type);
  // Aporte y retiro siempre tienen uso de concepto: esto no debería pasar nunca.
  if (!usage) throw new BusinessError('Tipo de movimiento no soportado');

  if (!movement.conceptId) {
    if ((await countActiveConcepts(tx, companyId, usage)) > 0) {
      throw new BusinessError(
        'Este movimiento no tiene concepto. Editalo y elegí uno antes de confirmarlo.'
      );
    }
    const capital = await resolvePartnerCapitalAccount(
      tx,
      companyId,
      movement.partnerId,
      defaultAccountId
    );
    return { ...capital, conceptName: null };
  }

  const concept = await resolveConceptForUsage(tx, {
    companyId,
    conceptId: movement.conceptId,
    usage,
  });
  if (concept.accountMode === 'PARTNER_ACCOUNT') {
    const capital = await resolvePartnerCapitalAccount(
      tx,
      companyId,
      movement.partnerId,
      defaultAccountId
    );
    return { ...capital, conceptName: concept.name };
  }
  // `resolveConceptForUsage` ya garantiza la cuenta de un concepto de cuenta
  // propia; se verifica igual para no caer en silencio a la cuenta del socio.
  if (!concept.accountId) {
    throw new BusinessError(
      `El concepto «${concept.name}» no tiene cuenta propia. Pedile a Contabilidad que la corrija en Empresa → Contabilidad → Conceptos.`
    );
  }
  const partner = await findMovementPartner(tx, companyId, movement.partnerId);
  return {
    accountId: concept.accountId,
    source: 'concept',
    partnerName: partner.name,
    conceptName: concept.name,
  };
}

/**
 * Nombre del socio para el snapshot `partnerName`. En aporte y retiro el socio
 * define la cuenta del asiento (TSK-717), así que si el id no es de la empresa
 * el borrador no se guarda. Transferencia y gastos bancarios no cambian: si
 * llegara un id suelto, se guarda `null` como hasta ahora.
 */
async function resolvePartnerName(
  data: FundMovementFormInput,
  companyId: string
): Promise<string | null> {
  if (!data.partnerId) return null;
  const partner = await prisma.partner.findFirst({
    where: { id: data.partnerId, companyId },
    select: { name: true },
  });
  const isPartnerMovement =
    data.type === 'PARTNER_CONTRIBUTION' || data.type === 'PARTNER_WITHDRAWAL';
  if (!partner && isPartnerMovement) {
    throw new BusinessError('El socio seleccionado no es válido');
  }
  return partner?.name ?? null;
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
    fundMovementId: string;
  }
): Promise<{ accountId: string }> {
  const { companyId, userId, amount, date, description, isTransfer, settings, fundMovementId } = ctx;

  if (ref.kind === 'BANK') {
    const bank = await tx.bankAccount.findFirst({
      where: { id: ref.id, companyId, status: 'ACTIVE' },
      select: { id: true, balance: true, accountId: true, bankName: true },
    });
    if (!bank) throw new BusinessError('La cuenta bancaria seleccionada no es válida');

    const accountId = bank.accountId ?? settings.defaultBankAccountId;
    if (!accountId) {
      throw new BusinessError(
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
      data: {
        bankAccountId: bank.id,
        companyId,
        type,
        amount,
        date,
        description,
        fundMovementId,
        createdBy: userId,
      },
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
  if (!cash) throw new BusinessError('La caja seleccionada no es válida');
  const session = cash.sessions[0];
  if (!session) throw new BusinessError(`La caja "${cash.name}" no tiene una sesión abierta`);

  const accountId = cash.accountId ?? settings.defaultCashAccountId;
  if (!accountId) {
    throw new BusinessError(
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
      fundMovementId,
      createdBy: userId,
    },
  });
  await tx.cashRegisterSession.update({
    where: { id: session.id },
    data: { expectedBalance: newExpected },
  });

  return { accountId };
}

/** Una línea del asiento, tal como la arma cada tipo de movimiento. */
interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

/**
 * Genera el asiento dentro de la transacción, con las líneas que le pasa el
 * llamador. Los aportes, retiros y transferencias arman dos líneas (un débito y
 * un crédito); los gastos bancarios arman una por concepto más el crédito del
 * total (TSK-585).
 *
 * Mientras armaba las dos líneas acá adentro, el balance estaba garantizado por
 * construcción. Al generalizarla pasó a depender de cada llamador, así que la
 * partida doble se comprueba explícitamente antes de escribir nada.
 *
 * Con `opts.rewriteEntryId` (corrección del movimiento, TSK-792) reescribe ese asiento en
 * borrador conservando su id y su número, en lugar de crear uno nuevo.
 */
async function createJournalEntryForFundMovement(
  input: {
    companyId: string;
    date: Date;
    description: string;
    /** Líneas del asiento. Se verifica acá que sumen lo mismo al debe y al haber. */
    lines: JournalLineInput[];
    /** Origen para el log del núcleo (`fund-movement:<id>`). */
    source: string;
  },
  tx: PrismaTransactionClient,
  opts?: DocumentEntryOptions
): Promise<{ id: string; number: number }> {
  const { companyId, date, description, lines } = input;

  // Partida doble: se suma con Decimal y no con floats, para que un asiento
  // válido no se rechace por el arrastre binario de 0.1 + 0.2.
  if (lines.length === 0) {
    logger.error('Asiento de movimiento de fondos sin líneas', {
      data: { companyId, description },
    });
    throw new BusinessError('El asiento del movimiento no tiene líneas. Avisá al equipo.');
  }
  const totalDebe = lines.reduce(
    (t, l) => t.add(new Prisma.Decimal(l.debit)),
    new Prisma.Decimal(0)
  );
  const totalHaber = lines.reduce(
    (t, l) => t.add(new Prisma.Decimal(l.credit)),
    new Prisma.Decimal(0)
  );
  if (!totalDebe.equals(totalHaber)) {
    logger.error('Asiento de movimiento de fondos desbalanceado', {
      data: { companyId, description, debe: totalDebe.toString(), haber: totalHaber.toString() },
    });
    throw new BusinessError(
      'El asiento no balancea: el total del debe no coincide con el del haber. Revisá los importes o avisá al equipo.'
    );
  }

  // Período, numeración atómica, ejercicio/período y validación de cuentas: el
  // núcleo contable (TSK-760). Un mes cerrado lanza `BusinessError` y la
  // transacción entera (saldos, movimientos de banco/caja) se deshace.
  const entryLines = lines.map((line) => ({
    accountId: line.accountId,
    debit: new Prisma.Decimal(line.debit),
    credit: new Prisma.Decimal(line.credit),
    description: line.description,
  }));
  if (opts?.rewriteEntryId) {
    return rewriteDraftJournalEntryTx(tx, {
      companyId,
      entryId: opts.rewriteEntryId,
      date,
      description,
      lines: entryLines,
      source: input.source,
    });
  }
  return createJournalEntryTx(tx, {
    companyId,
    date,
    description,
    status: 'DRAFT',
    createdBy: 'system',
    source: input.source,
    lines: entryLines,
  });
}

/** Una línea de gastos bancarios lista para persistir. */
interface FundMovementLineData {
  conceptId: string;
  /** Snapshot del nombre del concepto, para el historial (TSK-791). */
  conceptName: string;
  /** Cuenta resuelta desde el concepto en el servidor: nunca viene del cliente. */
  accountId: string;
  /** Detalle opcional, trimmeado; puede ser ''. */
  description: string;
  amount: Prisma.Decimal;
  position: number;
}

/**
 * Líneas listas para persistir. Solo las tiene el tipo BANK_CHARGES; el resto
 * de los tipos guarda el movimiento sin líneas, aunque el cliente mande alguna.
 * El importe se redondea acá a los 2 decimales de la columna, para que la base
 * no lo redondee por su cuenta y el total quede diferente de la suma.
 *
 * TSK-791: cada línea trae un concepto y la cuenta se resuelve desde él con
 * `resolveConceptForUsage`, que reemplaza a `assertLineAccounts`: valida que el
 * concepto sea de la empresa, esté activo, tenga el uso y que su cuenta siga
 * siendo imputable y de un tipo admitido (egreso o activo, TSK-579). Así un id
 * manipulado en el payload no puede imputar a otra empresa ni a una cuenta
 * inválida.
 */
async function buildLinesData(
  db: PrismaTransactionClient,
  companyId: string,
  data: FundMovementFormInput
): Promise<FundMovementLineData[]> {
  if (data.type !== 'BANK_CHARGES') return [];
  const cache = new Map<string, ResolvedLineConcept>();
  const lines: FundMovementLineData[] = [];
  for (const [index, line] of (data.lines ?? []).entries()) {
    const concept = await resolveLineConcept(db, companyId, line.conceptId, cache);
    lines.push({
      conceptId: concept.id,
      conceptName: concept.name,
      accountId: concept.accountId,
      description: line.description.trim(),
      amount: new Prisma.Decimal(parseFloat(line.amount)).toDecimalPlaces(2),
      position: index,
    });
  }
  return lines;
}

/**
 * Concepto de un aporte o retiro al guardar el borrador (TSK-791). Que sea
 * obligatorio depende de los conceptos activos del tipo, así que se decide acá
 * y no en el schema:
 *  - viene un concepto  → se valida y se guarda con su nombre (snapshot);
 *  - no viene y hay conceptos activos para el tipo → error;
 *  - no viene y no hay conceptos activos → se guarda sin concepto, como antes.
 * Los demás tipos no llevan concepto en el movimiento: gastos bancarios lo lleva
 * en cada línea y la transferencia nunca usa conceptos.
 */
async function resolveMovementConcept(
  db: PrismaTransactionClient,
  companyId: string,
  data: FundMovementFormInput
): Promise<{ conceptId: string | null; conceptName: string | null }> {
  const isPartnerMovement =
    data.type === 'PARTNER_CONTRIBUTION' || data.type === 'PARTNER_WITHDRAWAL';
  const usage = isPartnerMovement ? fundMovementUsage(data.type) : null;
  if (!usage) return { conceptId: null, conceptName: null };

  if (data.conceptId) {
    const concept = await resolveConceptForUsage(db, {
      companyId,
      conceptId: data.conceptId,
      usage,
    });
    return { conceptId: concept.id, conceptName: concept.name };
  }
  if ((await countActiveConcepts(db, companyId, usage)) > 0) {
    throw new BusinessError('Elegí el concepto del movimiento');
  }
  return { conceptId: null, conceptName: null };
}

/**
 * Importe del movimiento. En gastos bancarios lo calcula el servidor sumando las
 * líneas ya redondeadas: `amount` ni siquiera llega para ese tipo (TSK-585).
 * Así el total guardado es exactamente la suma de las líneas, que es lo que
 * después se acredita al banco en el asiento.
 */
function resolveMovementAmount(
  data: FundMovementFormInput,
  linesData: FundMovementLineData[]
): number {
  // El `superRefine` del schema exige `amount` (requerido + formato) para
  // todo tipo que no sea BANK_CHARGES, así que acá siempre llega un string
  // válido: la aserción documenta esa garantía en vez de esconder un `?? '0'`
  // que nunca debería ejecutarse.
  if (data.type !== 'BANK_CHARGES') return parseFloat(data.amount!);
  return sumLines(
    linesData.map((line) => ({
      conceptId: line.conceptId,
      description: line.description,
      amount: line.amount.toString(),
    }))
  );
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
export async function createFundMovement(
  input: FundMovementFormInput,
  confirm = false
): Promise<FundMovementActionResult> {
  await checkPermission('commercial.treasury.fund-movements', 'create', { redirect: true });

  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new BusinessError('No autenticado');
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new BusinessError('No hay empresa activa');

    const data = fundMovementSchema.parse(input);
    const { sourceRef, destRef } = buildDraftData(data);
    const linesData = await buildLinesData(prisma, companyId, data);
    const concept = await resolveMovementConcept(prisma, companyId, data);

    // fundOut = origen (retiro/transferencia); fundIn = destino (aporte/transferencia)
    const fundOut = sourceRef ? await resolveFundRefLabel(sourceRef, companyId) : null;
    const fundIn = destRef ? await resolveFundRefLabel(destRef, companyId) : null;
    const partnerName = await resolvePartnerName(data, companyId);

    const created = await prisma.fundMovement.create({
      data: {
        companyId,
        status: 'DRAFT',
        date: parseFundMovementDate(data.date),
        type: data.type,
        amount: new Prisma.Decimal(resolveMovementAmount(data, linesData)),
        description: data.description,
        fundOutKind: fundOut?.kind ?? null,
        fundOutId: fundOut?.id ?? null,
        fundOutLabel: fundOut?.label ?? null,
        fundInKind: fundIn?.kind ?? null,
        fundInId: fundIn?.id ?? null,
        fundInLabel: fundIn?.label ?? null,
        partnerId: data.partnerId || null,
        partnerName,
        conceptId: concept.conceptId,
        conceptName: concept.conceptName,
        createdBy: userId,
        ...(linesData.length > 0 ? { lines: { create: linesData } } : {}),
      },
      select: { id: true },
    });

    logger.info('Movimiento de fondos creado (borrador)', { data: { id: created.id, companyId } });

    if (confirm) {
      // El borrador ya quedó creado: si la confirmación falla, se informa el
      // motivo y el movimiento sigue disponible para corregir y reconfirmar.
      const confirmed = await confirmFundMovement(created.id);
      if (!confirmed.success) return confirmed;
    } else {
      revalidatePath('/dashboard/commercial/treasury/fund-movements');
    }

    return { success: true, id: created.id };
  } catch (error) {
    return toActionResult(error, 'Error al crear movimiento de fondos');
  }
}

/** Actualiza un movimiento en BORRADOR (no permitido si ya está confirmado). */
export async function updateFundMovement(
  id: string,
  input: FundMovementFormInput
): Promise<FundMovementActionResult> {
  await checkPermission('commercial.treasury.fund-movements', 'update', { redirect: true });

  try {
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new BusinessError('No hay empresa activa');

    const existing = await prisma.fundMovement.findFirst({
      where: { id, companyId },
      select: { status: true },
    });
    if (!existing) throw new BusinessError('Movimiento no encontrado');
    if (existing.status !== 'DRAFT') {
      throw new BusinessError('Solo se pueden editar movimientos en borrador');
    }

    const data = fundMovementSchema.parse(input);
    const { sourceRef, destRef } = buildDraftData(data);
    const linesData = await buildLinesData(prisma, companyId, data);
    const concept = await resolveMovementConcept(prisma, companyId, data);

    const fundOut = sourceRef ? await resolveFundRefLabel(sourceRef, companyId) : null;
    const fundIn = destRef ? await resolveFundRefLabel(destRef, companyId) : null;
    const partnerName = await resolvePartnerName(data, companyId);

    // Las líneas se reemplazan enteras: se borran las anteriores y se
    // recrean con la posición del formulario, en la misma transacción.
    await prisma.$transaction(async (tx) => {
      await tx.fundMovement.update({
        where: { id },
        data: {
          date: parseFundMovementDate(data.date),
          type: data.type,
          amount: new Prisma.Decimal(resolveMovementAmount(data, linesData)),
          description: data.description,
          fundOutKind: fundOut?.kind ?? null,
          fundOutId: fundOut?.id ?? null,
          fundOutLabel: fundOut?.label ?? null,
          fundInKind: fundIn?.kind ?? null,
          fundInId: fundIn?.id ?? null,
          fundInLabel: fundIn?.label ?? null,
          partnerId: data.partnerId || null,
          partnerName,
          conceptId: concept.conceptId,
          conceptName: concept.conceptName,
        },
      });

      await tx.fundMovementLine.deleteMany({ where: { movementId: id } });
      if (linesData.length > 0) {
        await tx.fundMovementLine.createMany({
          data: linesData.map((line) => ({ ...line, movementId: id })),
        });
      }
    });

    revalidatePath('/dashboard/commercial/treasury/fund-movements');
    return { success: true, id };
  } catch (error) {
    return toActionResult(error, 'Error al actualizar movimiento de fondos');
  }
}

/**
 * Confirma un movimiento en borrador: actualiza saldos de banco/caja y genera
 * el asiento contable, de forma atómica. Lo deja CONFIRMED.
 */
export async function confirmFundMovement(id: string): Promise<FundMovementActionResult> {
  await checkPermission('commercial.treasury.fund-movements', 'update', { redirect: true });

  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new BusinessError('No autenticado');
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new BusinessError('No hay empresa activa');

    const movement = await prisma.fundMovement.findFirst({
      where: { id, companyId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!movement) throw new BusinessError('Movimiento no encontrado');
    if (movement.status !== 'DRAFT') {
      throw new BusinessError('El movimiento ya fue confirmado o anulado');
    }

    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: {
        partnerContributionsAccountId: true,
        defaultBankAccountId: true,
        defaultCashAccountId: true,
      },
    });
    // Sin Ajustes no hay asiento posible: se avisa antes de mover saldos.
    if (!settings) {
      throw new BusinessError(
        'No hay configuración contable. Configurá las cuentas por defecto en Ajustes contables antes de confirmar movimientos de fondos.'
      );
    }

    const isTransfer = movement.type === 'ACCOUNT_TRANSFER';
    // TSK-717: la cuenta del asiento la decide el socio (propia o por defecto)
    // dentro de la transacción, en `resolvePartnerCapitalAccount`. La global ya
    // no es condición necesaria para confirmar. TSK-791: antes pasa por el
    // concepto del movimiento (`resolveMovementCapitalAccount`).
    const defaultContributionsAccountId = settings.partnerContributionsAccountId ?? null;
    let capitalSource: CapitalAccountSource | null = null; // para el log final

    const fundSettings: FundSettings = {
      defaultBankAccountId: settings.defaultBankAccountId ?? null,
      defaultCashAccountId: settings.defaultCashAccountId ?? null,
    };
    const amount = new Prisma.Decimal(Number(movement.amount));

    await prisma.$transaction(async (tx) => {
      const sideCtx = {
        companyId,
        userId,
        amount,
        date: movement.date,
        description: movement.description,
        isTransfer,
        settings: fundSettings,
        fundMovementId: id,
      };

      const amountNumber = Number(movement.amount);
      /** Las dos líneas clásicas: un débito y un crédito por el total. */
      const parLineas = (debitAccountId: string, creditAccountId: string): JournalLineInput[] => [
        {
          accountId: debitAccountId,
          debit: amountNumber,
          credit: 0,
          description: movement.description,
        },
        {
          accountId: creditAccountId,
          debit: 0,
          credit: amountNumber,
          description: movement.description,
        },
      ];

      let entryLines: JournalLineInput[];
      // Snapshot del nombre del concepto del movimiento, si lo tiene (TSK-791).
      let movementConceptName: string | null = null;

      if (movement.type === 'PARTNER_CONTRIBUTION') {
        if (!movement.fundInKind || !movement.fundInId)
          throw new BusinessError('Falta el banco/caja destino');
        // Antes de `applyFundSide`, para que un socio sin cuenta o un concepto
        // inválido fallen antes de mover saldos.
        const capital = await resolveMovementCapitalAccount(
          tx,
          companyId,
          { type: movement.type, partnerId: movement.partnerId, conceptId: movement.conceptId },
          defaultContributionsAccountId
        );
        capitalSource = capital.source;
        movementConceptName = capital.conceptName;
        const dest = await applyFundSide(
          tx,
          { kind: movement.fundInKind as FundSourceKind, id: movement.fundInId },
          'IN',
          sideCtx
        );
        // Debe banco/caja · Haber cuenta del socio
        entryLines = parLineas(dest.accountId, capital.accountId);
      } else if (movement.type === 'PARTNER_WITHDRAWAL') {
        if (!movement.fundOutKind || !movement.fundOutId)
          throw new BusinessError('Falta el banco/caja origen');
        const capital = await resolveMovementCapitalAccount(
          tx,
          companyId,
          { type: movement.type, partnerId: movement.partnerId, conceptId: movement.conceptId },
          defaultContributionsAccountId
        );
        capitalSource = capital.source;
        movementConceptName = capital.conceptName;
        const src = await applyFundSide(
          tx,
          { kind: movement.fundOutKind as FundSourceKind, id: movement.fundOutId },
          'OUT',
          sideCtx
        );
        // Debe cuenta del socio · Haber banco/caja
        entryLines = parLineas(capital.accountId, src.accountId);
      } else if (movement.type === 'BANK_CHARGES') {
        // Los fondos salen del banco/caja como en un retiro, pero el asiento
        // lleva un débito por cada concepto y un solo crédito por el total.
        if (!movement.fundOutKind || !movement.fundOutId)
          throw new BusinessError('Falta el banco/caja origen');
        if (movement.lines.length === 0) {
          throw new BusinessError('El movimiento no tiene conceptos cargados');
        }
        // TSK-791: borradores viejos (líneas con cuenta y sin concepto) no se
        // confirman hasta elegir el concepto de cada línea.
        if (movement.lines.some((line) => !line.conceptId)) {
          throw new BusinessError(
            'Hay conceptos sin elegir: editá el movimiento y elegí el concepto de cada línea.'
          );
        }
        // Cada concepto se vuelve a resolver ANTES de `applyFundSide`: si
        // Contabilidad lo desactivó, le quitó el uso o su cuenta dejó de ser
        // imputable, se rechaza sin mover saldos. Si le cambió la cuenta, gana
        // la cuenta actual, que queda fija en la línea al confirmar.
        const cache = new Map<string, ResolvedLineConcept>();
        const resolvedLines: {
          line: (typeof movement.lines)[number];
          concept: ResolvedLineConcept;
        }[] = [];
        for (const line of movement.lines) {
          // El `some` de arriba garantiza que todas las líneas tienen concepto.
          const concept = await resolveLineConcept(tx, companyId, line.conceptId!, cache);
          resolvedLines.push({ line, concept });
        }

        const src = await applyFundSide(
          tx,
          { kind: movement.fundOutKind as FundSourceKind, id: movement.fundOutId },
          'OUT',
          sideCtx
        );
        for (const { line, concept } of resolvedLines) {
          await tx.fundMovementLine.update({
            where: { id: line.id },
            data: { accountId: concept.accountId, conceptName: concept.name },
          });
        }
        entryLines = [
          ...resolvedLines.map(({ line, concept }) => ({
            accountId: concept.accountId,
            debit: Number(line.amount),
            credit: 0,
            // Sin detalle, la línea del asiento lleva el nombre del concepto.
            description: line.description || concept.name,
          })),
          {
            accountId: src.accountId,
            debit: 0,
            credit: amountNumber,
            description: movement.description,
          },
        ];
      } else if (movement.type === 'ACCOUNT_TRANSFER') {
        if (!movement.fundOutKind || !movement.fundOutId)
          throw new BusinessError('Falta el banco/caja origen');
        if (!movement.fundInKind || !movement.fundInId)
          throw new BusinessError('Falta el banco/caja destino');
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
        entryLines = parLineas(dest.accountId, src.accountId);
      } else {
        // Descarte exhaustivo: si se agrega un quinto FundMovementType y no se
        // contempla acá, esto deja de tipar y rompe el build en vez de llegar
        // a producción y fallar recién en runtime (TSK-585).
        const _exhaustive: never = movement.type;
        logger.error('Tipo de movimiento de fondos sin asiento definido', {
          data: { id, companyId, type: _exhaustive },
        });
        throw new BusinessError('Tipo de movimiento no soportado');
      }

      const entry = await createJournalEntryForFundMovement(
        {
          companyId,
          date: movement.date,
          description: movement.description,
          lines: entryLines,
          source: `fund-movement:${id}`,
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
          // El nombre vigente del concepto al confirmar queda como snapshot.
          ...(movementConceptName ? { conceptName: movementConceptName } : {}),
        },
      });
    });

    logger.info('Movimiento de fondos confirmado', {
      data: { id, companyId, type: movement.type, partnerId: movement.partnerId, capitalSource },
    });
    revalidatePath('/dashboard/commercial/treasury/fund-movements');
    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    revalidatePath('/dashboard/commercial/treasury/cash-registers');
    return { success: true, id };
  } catch (error) {
    return toActionResult(error, 'Error al confirmar movimiento de fondos');
  }
}

/** Elimina un movimiento en BORRADOR (los confirmados no se pueden borrar acá). */
export async function deleteFundMovement(id: string): Promise<FundMovementActionResult> {
  await checkPermission('commercial.treasury.fund-movements', 'delete', { redirect: true });

  try {
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new BusinessError('No hay empresa activa');

    const existing = await prisma.fundMovement.findFirst({
      where: { id, companyId },
      select: { status: true },
    });
    if (!existing) throw new BusinessError('Movimiento no encontrado');
    if (existing.status !== 'DRAFT') {
      throw new BusinessError('Solo se pueden eliminar movimientos en borrador');
    }

    await prisma.fundMovement.delete({ where: { id } });
    logger.info('Movimiento de fondos eliminado (borrador)', { data: { id, companyId } });
    revalidatePath('/dashboard/commercial/treasury/fund-movements');
    return { success: true, id };
  } catch (error) {
    return toActionResult(error, 'Error al eliminar movimiento de fondos');
  }
}

export type FundMovementListItem = Awaited<ReturnType<typeof getFundMovements>>['data'][number];
export type FundMovementRecord = NonNullable<Awaited<ReturnType<typeof getFundMovementById>>>;
export type FundOption = { id: string; label: string };
/** Referencia mínima a una cuenta del plan, para mostrar `code - name` (TSK-717). */
export type FundMovementAccountRef = { id: string; code: string; name: string };
export type FundMovementPartnerOption = Awaited<
  ReturnType<typeof getFundMovementCatalogs>
>['partners'][number];
