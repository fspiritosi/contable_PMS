import 'server-only';

import moment from 'moment';

import { Prisma } from '@/generated/prisma/client';
import type { InvestmentInstrumentType } from '@/generated/prisma/enums';
import {
  assertPeriodOpen,
  createJournalEntryTx,
  deleteDraftJournalEntryTx,
  type JournalEntryLineDraft,
  type Tx,
} from '@/modules/accounting/features/integrations/core';
import {
  laterSaleLabelsTx,
  POSITION_MOVEMENT_SELECT,
  requireInvestmentSetting,
  toPositionMovement,
} from '@/modules/commercial/shared/effects/investment.server';
import type { EffectsCtx } from '@/modules/commercial/shared/effects/types';
import { BusinessError } from '@/shared/lib/action-result';

import { positionAt } from '../shared/position';
import { custodyLabel } from '../shared/types';
import type { ValuationData } from './validators';

/**
 * Valuación de inversiones al cierre del ejercicio (TSK-793).
 *
 * Una por ejercicio. Toma el valor en libros de cada tenencia **a la fecha de
 * cierre** (solo movimientos hasta ese día), crea un `InvestmentMovement`
 * VALUATION por tenencia con la diferencia contra el valor cargado y un asiento en
 * borrador (ruling P5) con el resultado por tenencia, marcado con el proceso
 * `INVESTMENT_VALUATION`. Deshacerla borra el asiento y la valuación; sus
 * movimientos caen en cascada y la posición vuelve a la de antes.
 *
 * Fuera del archivo `'use server'` (lección R7 del TSK-792): estas funciones
 * reciben un `tx` y no verifican permisos, así que no pueden ser actions públicas.
 */

export interface ValuationCandidate {
  id: string;
  name: string;
  instrumentType: InvestmentInstrumentType;
  custody: string;
  accountCode: string;
  /** Valor en libros al cierre, sin la valuación de este ejercicio. */
  bookValue: number;
  nominals: number | null;
  /** Ventas confirmadas con fecha posterior al cierre: impiden valuar. */
  laterSales: string[];
}

export interface ValuationCandidates {
  fiscalYear: { id: string; number: number; endDate: Date; isClosed: boolean };
  existing: { id: string; journalEntryNumber: number | null; createdAt: Date } | null;
  holdings: ValuationCandidate[];
}

type CandidateWithAccount = ValuationCandidate & { accountId: string };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Día de cierre del ejercicio a las 00:00Z (el `endDate` del ejercicio es 23:59:59.999Z). */
const closingDayOf = (endDate: Date) => moment.utc(endDate).startOf('day').toDate();

const laterSalesError = (holdingName: string, labels: string[]) =>
  new BusinessError(
    `No se puede valuar: «${holdingName}» tiene ventas posteriores al cierre (${labels.join(', ')}). Anulalas, valuá y volvé a cargarlas.`
  );

/**
 * Ruling R7: las valuaciones de distintos ejercicios van en orden. Valuar o deshacer
 * un cierre con una valuación posterior (día UTC siguiente al cierre) en alguna de
 * sus tenencias movería el valor en libros debajo de esa valuación, y su diferencia
 * y su asiento dejarían de llevar la posición al valor valuado. Los movimientos de la
 * propia valuación tienen fecha del cierre, así que no cuentan. Rechaza nombrando la
 * primera tenencia por nombre y la fecha de su valuación posterior.
 */
async function assertNoLaterValuationTx(
  tx: Tx,
  holdingIds: string[],
  closingDate: Date
): Promise<void> {
  if (holdingIds.length === 0) return;
  const later = await tx.investmentMovement.findFirst({
    where: {
      holdingId: { in: holdingIds },
      kind: 'VALUATION',
      date: { gte: moment.utc(closingDate).startOf('day').add(1, 'day').toDate() },
    },
    orderBy: [{ holding: { name: 'asc' } }, { date: 'asc' }],
    select: { date: true, holding: { select: { name: true } } },
  });
  if (later) {
    throw new BusinessError(
      `Hay una valuación posterior (al ${moment.utc(later.date).format('DD/MM/YYYY')}) para «${later.holding.name}». Deshacé primero esa valuación.`
    );
  }
}

async function findFiscalYearTx(tx: Tx, companyId: string, fiscalYearId: string) {
  const fiscalYear = await tx.fiscalYear.findFirst({
    where: { id: fiscalYearId, companyId },
    select: { id: true, number: true, endDate: true, isClosed: true },
  });
  if (!fiscalYear) throw new BusinessError('Ejercicio no encontrado');
  return fiscalYear;
}

/**
 * Tenencias con posición (valor en libros o nominales) ≠ 0 al cierre del día
 * `endDate`, ordenadas por nombre. `excludeValuationId` deja afuera los movimientos
 * de esa valuación, para mostrar el valor en libros previo a ella.
 */
async function loadCandidatesTx(
  tx: Tx,
  companyId: string,
  endDate: Date,
  excludeValuationId: string | null
): Promise<CandidateWithAccount[]> {
  const holdings = await tx.investmentHolding.findMany({
    where: { companyId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      instrumentType: true,
      accountId: true,
      account: { select: { code: true } },
      bankAccount: { select: { bankName: true, accountNumber: true, accountType: true } },
      movements: { select: { ...POSITION_MOVEMENT_SELECT, valuationId: true } },
    },
  });

  const candidates: CandidateWithAccount[] = [];
  for (const holding of holdings) {
    const movements = holding.movements
      .filter((m) => excludeValuationId === null || m.valuationId !== excludeValuationId)
      .map(toPositionMovement);
    const { bookValue, nominals } = positionAt(movements, endDate);
    if (bookValue === 0 && !nominals) continue;
    candidates.push({
      id: holding.id,
      name: holding.name,
      instrumentType: holding.instrumentType,
      custody: custodyLabel(holding.bankAccount),
      accountId: holding.accountId,
      accountCode: holding.account.code,
      bookValue,
      nominals,
      laterSales: await laterSaleLabelsTx(tx, holding.id, endDate),
    });
  }
  return candidates;
}

/** Datos de la pantalla: el ejercicio, su valuación (si hay) y las tenencias a valuar. */
export async function loadValuationCandidatesTx(
  tx: Tx,
  companyId: string,
  fiscalYearId: string
): Promise<ValuationCandidates> {
  const fiscalYear = await findFiscalYearTx(tx, companyId, fiscalYearId);
  const existing = await tx.investmentValuation.findUnique({
    where: { companyId_fiscalYearId: { companyId, fiscalYearId } },
    select: { id: true, journalEntryNumber: true, createdAt: true },
  });
  const candidates = await loadCandidatesTx(
    tx,
    companyId,
    fiscalYear.endDate,
    existing?.id ?? null
  );
  return {
    fiscalYear,
    existing,
    // Sin `accountId`: la pantalla muestra el código de la cuenta.
    holdings: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      instrumentType: c.instrumentType,
      custody: c.custody,
      accountCode: c.accountCode,
      bookValue: c.bookValue,
      nominals: c.nominals,
      laterSales: c.laterSales,
    })),
  };
}

/**
 * Genera la valuación del ejercicio. Validaciones, en orden:
 *  1. El ejercicio es de la empresa y no está cerrado; el mes de cierre está abierto.
 *  2. No hay otra valuación para el ejercicio.
 *  3. Todas las tenencias candidatas tienen línea (y no hay líneas de otras).
 *  4. Ninguna tiene ventas confirmadas posteriores al cierre ni una valuación
 *     posterior (ruling R7).
 *  5. El precio por nominal solo se admite con nominales > 0.
 * Después crea la valuación, un movimiento VALUATION por tenencia (aunque la
 * diferencia sea 0) y el asiento en borrador si hay alguna diferencia.
 */
export async function generateInvestmentValuationTx(
  tx: Tx,
  ctx: EffectsCtx,
  input: ValuationData
): Promise<{ id: string; journalEntryNumber: number | null }> {
  const { companyId } = ctx;
  const fiscalYear = await findFiscalYearTx(tx, companyId, input.fiscalYearId);
  if (fiscalYear.isClosed) {
    throw new BusinessError('El ejercicio ya está cerrado: no se puede valuar');
  }
  const closingDate = closingDayOf(fiscalYear.endDate);
  // Toma el lock de Ajustes de la empresa: serializa con otras valuaciones y con la
  // creación de asientos. No cubre del todo la confirmación de una venta, que
  // calcula su costo antes de tomar ese lock (ventana chica, ya existente).
  await assertPeriodOpen(tx, companyId, closingDate);

  const existing = await tx.investmentValuation.count({
    where: { companyId, fiscalYearId: fiscalYear.id },
  });
  if (existing > 0) {
    throw new BusinessError(
      'Ya hay una valuación para este ejercicio. Deshacela para volver a generarla'
    );
  }

  const candidates = await loadCandidatesTx(tx, companyId, fiscalYear.endDate, null);
  if (candidates.length === 0) {
    throw new BusinessError('No hay tenencias con saldo al cierre del ejercicio para valuar');
  }
  const linesByHolding = new Map(input.lines.map((line) => [line.holdingId, line]));
  const missing = candidates.filter((c) => !linesByHolding.has(c.id));
  if (missing.length > 0) {
    throw new BusinessError(`Faltan valores para: ${missing.map((c) => c.name).join(', ')}`);
  }
  if (input.lines.length !== candidates.length) {
    throw new BusinessError('Hay valores para tenencias sin saldo al cierre del ejercicio');
  }
  const withLaterSales = candidates.find((c) => c.laterSales.length > 0);
  if (withLaterSales) throw laterSalesError(withLaterSales.name, withLaterSales.laterSales);
  await assertNoLaterValuationTx(
    tx,
    candidates.map((c) => c.id),
    closingDate
  );

  const valued = candidates.map((holding) => {
    const line = linesByHolding.get(holding.id);
    let value: number;
    if (line?.unitPrice !== undefined) {
      if (!holding.nominals || holding.nominals <= 0) {
        throw new BusinessError(
          `La tenencia «${holding.name}» no tiene nominales: cargá el valor al cierre`
        );
      }
      value = round2(holding.nominals * Number(line.unitPrice));
    } else {
      value = round2(Number(line?.valuedAmount ?? 0));
    }
    return {
      holding,
      value,
      unitPrice: line?.unitPrice ?? null,
      diff: round2(value - holding.bookValue),
    };
  });

  const settings = await tx.accountingSettings.findUnique({
    where: { companyId },
    select: { holdingGainAccountId: true, holdingLossAccountId: true },
  });
  const gainAccountId = valued.some((v) => v.diff > 0)
    ? requireInvestmentSetting(settings?.holdingGainAccountId ?? null, 'holdingGainAccountId')
    : null;
  const lossAccountId = valued.some((v) => v.diff < 0)
    ? requireInvestmentSetting(settings?.holdingLossAccountId ?? null, 'holdingLossAccountId')
    : null;

  const valuation = await tx.investmentValuation.create({
    data: {
      companyId,
      fiscalYearId: fiscalYear.id,
      closingDate,
      createdBy: ctx.userId,
    },
    select: { id: true },
  });
  await tx.investmentMovement.createMany({
    data: valued.map(({ holding, value, unitPrice, diff }) => ({
      companyId,
      holdingId: holding.id,
      kind: 'VALUATION' as const,
      date: closingDate,
      bookDelta: new Prisma.Decimal(diff),
      valuedAmount: new Prisma.Decimal(value),
      unitPrice: unitPrice === null ? null : new Prisma.Decimal(unitPrice),
      valuationId: valuation.id,
    })),
  });

  // Por tenencia: con ganancia, Debe tenencia / Haber resultado positivo; con
  // pérdida, Debe resultado negativo / Haber tenencia.
  const lines: JournalEntryLineDraft[] = valued.flatMap(({ holding, diff }) => {
    const description = `Valuación ${holding.name}`;
    if (diff > 0 && gainAccountId) {
      return [
        { accountId: holding.accountId, description, debit: diff, credit: 0 },
        { accountId: gainAccountId, description, debit: 0, credit: diff },
      ];
    }
    if (diff < 0 && lossAccountId) {
      return [
        { accountId: lossAccountId, description, debit: -diff, credit: 0 },
        { accountId: holding.accountId, description, debit: 0, credit: -diff },
      ];
    }
    return [];
  });
  if (lines.length === 0) return { id: valuation.id, journalEntryNumber: null };

  const entry = await createJournalEntryTx(tx, {
    companyId,
    date: closingDate,
    description: `Valuación de inversiones al ${moment.utc(closingDate).format('DD/MM/YYYY')}`,
    lines,
    status: 'DRAFT',
    createdBy: ctx.userId,
    source: `investment-valuation:${valuation.id}`,
    process: 'INVESTMENT_VALUATION',
  });
  await tx.investmentValuation.update({
    where: { id: valuation.id },
    data: { journalEntryId: entry.id, journalEntryNumber: entry.number },
  });
  return { id: valuation.id, journalEntryNumber: entry.number };
}

/**
 * Deshace la valuación: el ejercicio no está cerrado, el asiento (si existe) está en
 * borrador y ninguna tenencia valuada tiene ventas confirmadas posteriores al
 * cierre ni una valuación posterior (ruling R7). Borra el asiento y después la valuación; sus movimientos caen en cascada.
 */
export async function undoInvestmentValuationTx(
  tx: Tx,
  ctx: EffectsCtx,
  valuationId: string
): Promise<void> {
  const { companyId } = ctx;
  const valuation = await tx.investmentValuation.findFirst({
    where: { id: valuationId, companyId },
    select: {
      id: true,
      closingDate: true,
      journalEntryId: true,
      fiscalYear: { select: { isClosed: true } },
      movements: {
        orderBy: { holding: { name: 'asc' } },
        select: { holdingId: true, holding: { select: { name: true } } },
      },
    },
  });
  if (!valuation) throw new BusinessError('Valuación no encontrada');
  if (valuation.fiscalYear.isClosed) {
    throw new BusinessError('El ejercicio ya está cerrado: no se puede deshacer la valuación');
  }
  await assertPeriodOpen(tx, companyId, valuation.closingDate);

  const entry = valuation.journalEntryId
    ? await tx.journalEntry.findFirst({
        where: { id: valuation.journalEntryId, companyId },
        select: { id: true, number: true, status: true },
      })
    : null;
  if (entry && entry.status === 'POSTED') {
    throw new BusinessError(
      `El asiento N° ${entry.number} está Registrado. Volvelo a borrador desde Contabilidad › Asientos`
    );
  }

  for (const movement of valuation.movements) {
    const labels = await laterSaleLabelsTx(tx, movement.holdingId, valuation.closingDate);
    if (labels.length > 0) throw laterSalesError(movement.holding.name, labels);
  }
  await assertNoLaterValuationTx(
    tx,
    valuation.movements.map((m) => m.holdingId),
    valuation.closingDate
  );

  // Si el asiento ya no existe (lo borraron a mano), solo queda borrar la valuación.
  if (entry) await deleteDraftJournalEntryTx(tx, { companyId, entryId: entry.id });
  await tx.investmentValuation.delete({ where: { id: valuation.id } });
}
