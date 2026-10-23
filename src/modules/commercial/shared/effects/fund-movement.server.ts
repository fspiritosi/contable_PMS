import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type {
  BankMovementType,
  FundMovementStatus,
  FundMovementType,
} from '@/generated/prisma/enums';
import type { DocumentEntryOptions } from '@/modules/accounting/features/integrations/commercial';
import {
  createJournalEntryTx,
  rewriteDraftJournalEntryTx,
  type Tx,
} from '@/modules/accounting/features/integrations/core';
import type { FundSourceKind } from '@/modules/commercial/features/treasury/features/fund-movements/shared/validators';
import { PARTNER_CONTRIBUTION_ACCOUNT_TYPES } from '@/modules/commercial/features/treasury/features/partners/shared/types';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { BusinessError } from '@/shared/lib/action-result';
import { countActiveConcepts, resolveConceptForUsage } from '@/shared/lib/concepts/concepts.server';
import { fundMovementUsage } from '@/shared/lib/concepts/usages';
import { logger } from '@/shared/lib/logger';

import { dedupeImpediments, impediments } from '../correction/impediments';
import type { Impediment } from '../correction/types';
import type { EffectsCtx, EffectsResult } from './types';

/**
 * Efectos de un movimiento de fondo (TSK-792): lo que el MF mueve fuera de sí mismo
 * al confirmarse (saldos de banco y caja y el asiento) y su inversa exacta.
 *
 * Los vínculos de trazabilidad (`BankMovement.fundMovementId` y
 * `CashMovement.fundMovementId`) los escribe `apply` y los usa `revert` para
 * encontrar exactamente lo que se creó.
 */

// ============================================================================
// LADOS DEL MOVIMIENTO
// ============================================================================

/** Un banco o una caja concretos sobre los que el MF mueve fondos. */
export interface FundRef {
  kind: FundSourceKind;
  id: string;
}

interface FundSidesShape {
  type: FundMovementType;
  fundOutKind: string | null;
  fundOutId: string | null;
  fundInKind: string | null;
  fundInId: string | null;
}

const toFundRef = (kind: string | null, id: string | null): FundRef | null =>
  kind && id ? { kind: kind === 'BANK' ? 'BANK' : 'CASH', id } : null;

/**
 * Bancos o cajas que el MF mueve al confirmarse, según su tipo: de dónde salen los
 * fondos (retiro, gastos bancarios, transferencia) y a dónde entran (aporte,
 * transferencia). Un lado que el tipo no usa es `null` aunque el MF lo tenga cargado.
 *
 * Es el mismo criterio para aplicar los efectos y para contar los movimientos que
 * debería tener un MF confirmado (impedimento `untraceable`).
 */
export function fundMovementSides(movement: FundSidesShape): {
  out: FundRef | null;
  in: FundRef | null;
} {
  const usesOut = movement.type !== 'PARTNER_CONTRIBUTION';
  const usesIn = movement.type === 'PARTNER_CONTRIBUTION' || movement.type === 'ACCOUNT_TRANSFER';
  return {
    out: usesOut ? toFundRef(movement.fundOutKind, movement.fundOutId) : null,
    in: usesIn ? toFundRef(movement.fundInKind, movement.fundInId) : null,
  };
}

/** Cuántos `BankMovement` y `CashMovement` crea el MF al confirmarse. */
function countCreatedMovements(movement: FundSidesShape): { bank: number; cash: number } {
  const sides = fundMovementSides(movement);
  const refs = [sides.out, sides.in].filter((ref): ref is FundRef => ref !== null);
  return {
    bank: refs.filter((ref) => ref.kind === 'BANK').length,
    cash: refs.filter((ref) => ref.kind === 'CASH').length,
  };
}

/** Un MF en borrador no aplicó efectos y uno anulado ya los deshizo. */
const hasAppliedEffects = (status: FundMovementStatus) =>
  status !== 'DRAFT' && status !== 'CANCELLED';

// ============================================================================
// CUENTAS DEL ASIENTO
// ============================================================================

interface FundSettings {
  defaultBankAccountId: string | null;
  defaultCashAccountId: string | null;
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
async function findMovementPartner(tx: Tx, companyId: string, partnerId: string | null) {
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
 * Se ejecuta DENTRO de la transacción que aplica los efectos, con el mismo `tx`
 * que escribe el asiento. Todos los errores son `BusinessError`: viajan al modal
 * como `{ success: false, error }` y el movimiento queda en DRAFT.
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
  tx: Tx,
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
export interface ResolvedLineConcept {
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
export async function resolveLineConcept(
  db: Tx,
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
  tx: Tx,
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

// ============================================================================
// SALDOS DE BANCO Y CAJA
// ============================================================================

/**
 * Aplica un lado del movimiento sobre un banco o caja: registra el movimiento
 * (vinculado al MF), actualiza el saldo y resuelve la cuenta contable.
 * `direction` 'IN' = entran fondos, 'OUT' = salen.
 */
async function applyFundSide(
  tx: Tx,
  ref: FundRef,
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
  const { companyId, userId, amount, date, description, isTransfer, settings, fundMovementId } =
    ctx;

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

// ============================================================================
// ASIENTO
// ============================================================================

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
  tx: Tx,
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

// ============================================================================
// APPLY / REVERT / IMPEDIMENTOS
// ============================================================================

/** El MF con sus líneas, tal como lo lee `applyFundMovementEffectsTx`. */
type MovementWithLines = Prisma.FundMovementGetPayload<{ include: { lines: true } }>;

/**
 * Mueve los saldos de cada banco o caja del MF y arma las líneas del asiento según
 * su tipo. Resuelve la cuenta de capital y los conceptos ANTES de mover saldos.
 * En gastos bancarios fija en cada línea la cuenta y el nombre vigentes del concepto.
 */
async function applySidesAndBuildEntryLinesTx(
  tx: Tx,
  ctx: EffectsCtx,
  movement: MovementWithLines,
  settings: {
    partnerContributionsAccountId: string | null;
    defaultBankAccountId: string | null;
    defaultCashAccountId: string | null;
  }
): Promise<{
  entryLines: JournalLineInput[];
  capitalSource: CapitalAccountSource | null;
  movementConceptName: string | null;
}> {
  const { companyId, userId } = ctx;
  const isTransfer = movement.type === 'ACCOUNT_TRANSFER';
  // TSK-717: la cuenta del asiento la decide el socio (propia o por defecto)
  // dentro de la transacción, en `resolvePartnerCapitalAccount`. La global ya
  // no es condición necesaria para confirmar. TSK-791: antes pasa por el
  // concepto del movimiento (`resolveMovementCapitalAccount`).
  const defaultContributionsAccountId = settings.partnerContributionsAccountId ?? null;
  let capitalSource: CapitalAccountSource | null = null; // para el log

  const sideCtx = {
    companyId,
    userId,
    amount: new Prisma.Decimal(Number(movement.amount)),
    date: movement.date,
    description: movement.description,
    isTransfer,
    settings: {
      defaultBankAccountId: settings.defaultBankAccountId ?? null,
      defaultCashAccountId: settings.defaultCashAccountId ?? null,
    },
    fundMovementId: movement.id,
  };
  const sides = fundMovementSides(movement);
  const requireOut = () => {
    if (!sides.out) throw new BusinessError('Falta el banco/caja origen');
    return sides.out;
  };
  const requireIn = () => {
    if (!sides.in) throw new BusinessError('Falta el banco/caja destino');
    return sides.in;
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
    const destRef = requireIn();
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
    const dest = await applyFundSide(tx, destRef, 'IN', sideCtx);
    // Debe banco/caja · Haber cuenta del socio
    entryLines = parLineas(dest.accountId, capital.accountId);
  } else if (movement.type === 'PARTNER_WITHDRAWAL') {
    const srcRef = requireOut();
    const capital = await resolveMovementCapitalAccount(
      tx,
      companyId,
      { type: movement.type, partnerId: movement.partnerId, conceptId: movement.conceptId },
      defaultContributionsAccountId
    );
    capitalSource = capital.source;
    movementConceptName = capital.conceptName;
    const src = await applyFundSide(tx, srcRef, 'OUT', sideCtx);
    // Debe cuenta del socio · Haber banco/caja
    entryLines = parLineas(capital.accountId, src.accountId);
  } else if (movement.type === 'BANK_CHARGES') {
    // Los fondos salen del banco/caja como en un retiro, pero el asiento
    // lleva un débito por cada concepto y un solo crédito por el total.
    const srcRef = requireOut();
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

    const src = await applyFundSide(tx, srcRef, 'OUT', sideCtx);
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
    const srcRef = requireOut();
    const destRef = requireIn();
    const src = await applyFundSide(tx, srcRef, 'OUT', sideCtx);
    const dest = await applyFundSide(tx, destRef, 'IN', sideCtx);
    entryLines = parLineas(dest.accountId, src.accountId);
  } else {
    // Descarte exhaustivo: si se agrega un quinto FundMovementType y no se
    // contempla acá, esto deja de tipar y rompe el build en vez de llegar
    // a producción y fallar recién en runtime (TSK-585).
    const _exhaustive: never = movement.type;
    logger.error('Tipo de movimiento de fondos sin asiento definido', {
      data: { id: movement.id, companyId, type: _exhaustive },
    });
    throw new BusinessError('Tipo de movimiento no soportado');
  }

  return { entryLines, capitalSource, movementConceptName };
}

/**
 * Lo que hace la confirmación del MF dentro de la transacción salvo el cambio de
 * estado: mueve los saldos de banco y caja (con los movimientos vinculados al MF),
 * fija la cuenta y el nombre del concepto en las líneas de gastos bancarios, genera
 * el asiento y deja en el MF `journalEntryId`, `journalEntryNumber` y el nombre
 * vigente del concepto.
 *
 * Las cuentas y los conceptos se resuelven ANTES de mover saldos, así un rechazo no
 * deja nada a medias (igual la transacción entera se deshace).
 *
 * Con `opts.rewriteEntryId` reescribe ese asiento (DRAFT) conservando su número en
 * vez de crear uno nuevo.
 */
export async function applyFundMovementEffectsTx(
  tx: Tx,
  ctx: EffectsCtx,
  fundMovementId: string,
  opts?: DocumentEntryOptions
): Promise<EffectsResult> {
  const { companyId } = ctx;
  const id = fundMovementId;

  const movement = await tx.fundMovement.findFirst({
    where: { id, companyId },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  if (!movement) throw new BusinessError('Movimiento no encontrado');

  const settings = await tx.accountingSettings.findUnique({
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

  const { entryLines, capitalSource, movementConceptName } = await applySidesAndBuildEntryLinesTx(
    tx,
    ctx,
    movement,
    settings
  );

  const entry = await createJournalEntryForFundMovement(
    {
      companyId,
      date: movement.date,
      description: movement.description,
      lines: entryLines,
      source: `fund-movement:${id}`,
    },
    tx,
    opts
  );

  await tx.fundMovement.update({
    where: { id },
    data: {
      journalEntryId: entry.id,
      journalEntryNumber: entry.number,
      // El nombre vigente del concepto al confirmar queda como snapshot.
      ...(movementConceptName ? { conceptName: movementConceptName } : {}),
    },
  });

  logger.info('Asiento contable generado para movimiento de fondos', {
    data: {
      id,
      companyId,
      type: movement.type,
      partnerId: movement.partnerId,
      capitalSource,
      journalEntryId: entry.id,
      rewritten: Boolean(opts?.rewriteEntryId),
    },
  });

  return { journalEntryId: entry.id };
}

/** Lo que entró al banco se resta al revertir; lo que salió se devuelve. */
const BANK_INCREMENTS: readonly BankMovementType[] = ['DEPOSIT', 'TRANSFER_IN'];
const BANK_DECREMENTS: readonly BankMovementType[] = ['WITHDRAWAL', 'TRANSFER_OUT'];

/**
 * Inversa exacta de `applyFundMovementEffectsTx`, sin tocar el asiento ni el estado
 * del MF (los decide el motor de corrección):
 * - Banco: borra los movimientos que creó el MF y deshace su efecto en el saldo
 *   (DEPOSIT/TRANSFER_IN se restan; WITHDRAWAL/TRANSFER_OUT se suman).
 * - Caja: borra los movimientos del MF y deshace su efecto en el saldo esperado de
 *   la sesión (INCOME se resta; EXPENSE se suma).
 *
 * Las líneas de gastos bancarios no se tocan: la cuenta y el nombre que fijó la
 * confirmación los vuelve a escribir la próxima escritura o aplicación.
 *
 * Un MF en borrador o anulado no tiene efectos aplicados: no hace nada.
 * No valida que los efectos sigan revertibles: eso lo anticipa
 * `fundMovementEffectImpedimentsTx`, que el llamador consulta antes.
 */
export async function revertFundMovementEffectsTx(
  tx: Tx,
  ctx: EffectsCtx,
  fundMovementId: string
): Promise<void> {
  const { companyId } = ctx;
  const movement = await tx.fundMovement.findFirst({
    where: { id: fundMovementId, companyId },
    select: { status: true },
  });
  if (!movement) throw new BusinessError('Movimiento no encontrado');
  if (!hasAppliedEffects(movement.status)) return;

  const bankMovements = await tx.bankMovement.findMany({
    where: {
      companyId,
      fundMovementId,
      type: { in: [...BANK_INCREMENTS, ...BANK_DECREMENTS] },
    },
    select: { id: true, bankAccountId: true, type: true, amount: true },
  });
  for (const m of bankMovements) {
    const balance = BANK_INCREMENTS.includes(m.type)
      ? { decrement: m.amount }
      : { increment: m.amount };
    await tx.bankAccount.update({ where: { id: m.bankAccountId }, data: { balance } });
  }
  if (bankMovements.length > 0) {
    await tx.bankMovement.deleteMany({ where: { id: { in: bankMovements.map((m) => m.id) } } });
  }

  const cashMovements = await tx.cashMovement.findMany({
    where: { companyId, fundMovementId, type: { in: ['INCOME', 'EXPENSE'] } },
    select: { id: true, sessionId: true, type: true, amount: true },
  });
  for (const m of cashMovements) {
    const expectedBalance = m.type === 'INCOME' ? { decrement: m.amount } : { increment: m.amount };
    await tx.cashRegisterSession.update({ where: { id: m.sessionId }, data: { expectedBalance } });
  }
  if (cashMovements.length > 0) {
    await tx.cashMovement.deleteMany({ where: { id: { in: cashMovements.map((m) => m.id) } } });
  }
}

/**
 * Impedimentos propios de los efectos del MF, sin mirar el asiento ni el período:
 * - un movimiento bancario suyo ya conciliado (MANUAL: se quita la conciliación);
 * - un movimiento de caja de una sesión ya cerrada (BLOCKED);
 * - un MF confirmado con menos movimientos vinculados que bancos o cajas que mueve
 *   (anterior a la trazabilidad y no vinculado por el backfill): revertir no los
 *   encontraría y reaplicar duplicaría el efecto (BLOCKED).
 *
 * Solo cuentan los movimientos de la empresa del MF. Cada impedimento aparece una
 * sola vez aunque lo causen varios registros.
 */
export async function fundMovementEffectImpedimentsTx(
  tx: Tx,
  fundMovementId: string,
  docLabel: string
): Promise<Impediment[]> {
  const movement = await tx.fundMovement.findUnique({
    where: { id: fundMovementId },
    select: {
      companyId: true,
      status: true,
      type: true,
      fundOutKind: true,
      fundOutId: true,
      fundInKind: true,
      fundInId: true,
    },
  });
  if (!movement) return [];
  const { companyId } = movement;

  const [bankMovements, cashMovements] = await Promise.all([
    tx.bankMovement.findMany({
      where: { companyId, fundMovementId },
      select: { reconciled: true },
    }),
    tx.cashMovement.findMany({
      where: { companyId, fundMovementId },
      select: { session: { select: { status: true } }, cashRegister: { select: { name: true } } },
    }),
  ]);

  const found: Impediment[] = [];

  if (bankMovements.some((m) => m.reconciled)) {
    found.push(impediments.fundBankMovementReconciled(docLabel));
  }
  for (const m of cashMovements) {
    if (m.session.status === 'CLOSED') {
      found.push(impediments.cashSessionClosed(m.cashRegister.name, docLabel));
    }
  }

  if (movement.status === 'CONFIRMED') {
    const expected = countCreatedMovements(movement);
    if (bankMovements.length < expected.bank || cashMovements.length < expected.cash) {
      found.push(impediments.untraceable(docLabel));
    }
  }

  return dedupeImpediments(found);
}
