import 'server-only';

import moment from 'moment';

import { Prisma } from '@/generated/prisma/client';
import { assertPeriodOpen, type Tx } from '@/modules/accounting/features/integrations/core';
import {
  computeSaleCost,
  firstNegativePoint,
  positionAt,
  type PositionMovement,
} from '@/modules/commercial/features/treasury/features/investments/shared/position';
import {
  ACCOUNTING_SETTINGS_ACCOUNT_LABELS,
  type AccountingSettingsAccountField,
} from '@/shared/lib/accounts/settings-account-labels';
import { BusinessError } from '@/shared/lib/action-result';

import { impediments } from '../correction/impediments';
import type { Impediment } from '../correction/types';
import type { EffectsCtx } from './types';

/**
 * Lado "tenencia" de la compra y la venta de inversión (TSK-793).
 *
 * La posición de una tenencia (valor en libros y nominales) no se guarda: es la
 * suma de sus `InvestmentMovement`. La compra y la venta, al confirmarse, crean
 * cada una el suyo ligado al MF por `fundMovementId`; el revert del MF lo borra
 * (ver `revertFundMovementEffectsTx`). Todo corre dentro de la transacción del
 * MF, así que cualquier rechazo de acá deshace también los saldos y el asiento.
 */

const formatDay = (date: Date) => moment.utc(date).format('DD/MM/YYYY');

/**
 * Cuenta de un ajuste contable de inversiones, o el error que dice cuál configurar.
 * La usan la compra/venta (`fund-movement.server.ts`) y la valuación al cierre.
 */
export function requireInvestmentSetting(
  accountId: string | null,
  field: Extract<
    AccountingSettingsAccountField,
    'holdingGainAccountId' | 'holdingLossAccountId' | 'investmentFeesAccountId'
  >
): string {
  if (!accountId) {
    throw new BusinessError(
      `Configurá la cuenta de ${ACCOUNTING_SETTINGS_ACCOUNT_LABELS[field].toLowerCase()} en Ajustes contables`
    );
  }
  return accountId;
}

/** Movimientos de la tenencia, listos para el módulo puro de posición. */
export async function loadHoldingMovementsTx(
  tx: Tx,
  holdingId: string
): Promise<PositionMovement[]> {
  const rows = await tx.investmentMovement.findMany({
    where: { holdingId },
    select: POSITION_MOVEMENT_SELECT,
  });
  return rows.map(toPositionMovement);
}

/** Campos de `InvestmentMovement` que necesita el módulo puro de posición. */
export const POSITION_MOVEMENT_SELECT = {
  kind: true,
  date: true,
  bookDelta: true,
  nominalsDelta: true,
  createdAt: true,
} as const;

/** Fila de `InvestmentMovement` (Decimal) → movimiento del módulo de posición (number). */
export function toPositionMovement(
  row: Prisma.InvestmentMovementGetPayload<{ select: typeof POSITION_MOVEMENT_SELECT }>
): PositionMovement {
  return {
    kind: row.kind,
    date: row.date,
    bookDelta: Number(row.bookDelta),
    nominalsDelta: row.nominalsDelta === null ? null : Number(row.nominalsDelta),
    createdAt: row.createdAt,
  };
}

async function holdingName(tx: Tx, holdingId: string): Promise<string> {
  const holding = await tx.investmentHolding.findUnique({
    where: { id: holdingId },
    select: { name: true },
  });
  return holding?.name ?? '';
}

const negativeError = (name: string, date: Date) =>
  new BusinessError(
    `La operación deja la tenencia «${name}» con saldo negativo al ${formatDay(date)}`
  );

/**
 * Sin posiciones cortas: recorre la historia completa de la tenencia y rechaza si
 * en algún punto el valor en libros o los nominales quedan negativos. Mirar solo
 * la posición a la fecha del movimiento no alcanza: una venta retroactiva puede
 * dejar en negativo una venta posterior ya confirmada.
 */
export async function assertHoldingNeverNegativeTx(tx: Tx, holdingId: string): Promise<void> {
  const point = firstNegativePoint(await loadHoldingMovementsTx(tx, holdingId));
  if (point) throw negativeError(await holdingName(tx, holdingId), point.date);
}

/**
 * Valuación de la tenencia con fecha igual o posterior a `date`, la más cercana, o
 * null si no hay. La comparación es por día calendario: la valuación se guarda a las
 * 00:00Z y el MF al mediodía UTC.
 */
async function findValuationFromTx(
  tx: Tx,
  holdingId: string,
  date: Date
): Promise<{ date: Date; holdingName: string } | null> {
  const valuation = await tx.investmentMovement.findFirst({
    where: {
      holdingId,
      kind: 'VALUATION',
      date: { gte: moment.utc(date).startOf('day').toDate() },
    },
    // La más cercana al movimiento: es la que impide registrarlo.
    orderBy: { date: 'asc' },
    select: { date: true, holding: { select: { name: true } } },
  });
  return valuation ? { date: valuation.date, holdingName: valuation.holding.name } : null;
}

/**
 * Una valuación al cierre fija el valor en libros de la tenencia a esa fecha. Un
 * movimiento con fecha igual o anterior la dejaría desactualizada, así que se
 * rechaza hasta que se deshaga la valuación.
 */
export async function assertHoldingNotValuedTx(
  tx: Tx,
  holdingId: string,
  date: Date
): Promise<void> {
  const valuation = await findValuationFromTx(tx, holdingId, date);
  if (valuation) {
    throw new BusinessError(
      `La tenencia «${valuation.holdingName}» ya tiene valuación al cierre del ${formatDay(valuation.date)}. Deshacé esa valuación para registrar movimientos anteriores.`
    );
  }
}

interface LaterSale {
  date: Date;
  holdingName: string;
  description: string | null;
}

/**
 * Ventas de la tenencia posteriores a `date`, por fecha. Es posterior la de un día
 * siguiente (día calendario UTC) o, en el mismo día, la creada después de
 * `sameDayAfter`; con `sameDayAfter` null, ninguna del mismo día cuenta (un
 * movimiento que se está aplicando es el último creado). `excludeIds` deja afuera
 * los movimientos propios. Solo las ventas confirmadas tienen `InvestmentMovement`.
 */
async function findLaterSalesTx(
  tx: Tx,
  holdingId: string,
  date: Date,
  opts: { excludeIds: string[]; sameDayAfter: Date | null }
): Promise<LaterSale[]> {
  const day = moment.utc(date).format('YYYY-MM-DD');
  const sales = await tx.investmentMovement.findMany({
    where: {
      holdingId,
      kind: 'SALE',
      ...(opts.excludeIds.length > 0 ? { id: { notIn: opts.excludeIds } } : {}),
      date: { gte: moment.utc(date).startOf('day').toDate() },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: {
      date: true,
      createdAt: true,
      holding: { select: { name: true } },
      fundMovement: { select: { description: true } },
    },
  });
  return sales
    .filter(
      (sale) =>
        moment.utc(sale.date).format('YYYY-MM-DD') > day ||
        (opts.sameDayAfter !== null && sale.createdAt.getTime() > opts.sameDayAfter.getTime())
    )
    .map((sale) => ({
      date: sale.date,
      holdingName: sale.holding.name,
      description: sale.fundMovement?.description ?? null,
    }));
}

/** Primera venta de la tenencia posterior a `date` (ver `findLaterSalesTx`), o null. */
async function findLaterSaleTx(
  tx: Tx,
  holdingId: string,
  date: Date,
  opts: { excludeIds: string[]; sameDayAfter: Date | null }
): Promise<LaterSale | null> {
  return (await findLaterSalesTx(tx, holdingId, date, opts))[0] ?? null;
}

/** Etiqueta de una venta en los mensajes: «descripción» del DD/MM/YYYY. */
function laterSaleLabel(sale: LaterSale): string {
  return sale.description
    ? `«${sale.description}» del ${formatDay(sale.date)}`
    : `del ${formatDay(sale.date)}`;
}

/**
 * Etiquetas de las ventas confirmadas de la tenencia con fecha posterior al día
 * `date`. La valuación al cierre no se puede generar ni deshacer mientras existan:
 * su costo se calculó contra el valor en libros previo (TSK-793).
 */
export async function laterSaleLabelsTx(tx: Tx, holdingId: string, date: Date): Promise<string[]> {
  const sales = await findLaterSalesTx(tx, holdingId, date, { excludeIds: [], sameDayAfter: null });
  return sales.map(laterSaleLabel);
}

/**
 * Ruling R6: una compra o venta no puede quedar antes de una venta ya confirmada de
 * la misma tenencia, porque el costo de esa venta quedó fijo al confirmarla. Corre
 * al crear y confirmar, al confirmar un borrador y en la reaplicación del motor de
 * corrección (con el movimiento propio ya revertido), así que cubre también una
 * edición que cambia la fecha o la tenencia.
 */
export async function assertNoLaterSaleTx(tx: Tx, holdingId: string, date: Date): Promise<void> {
  const later = await findLaterSaleTx(tx, holdingId, date, {
    excludeIds: [],
    sameDayAfter: null,
  });
  if (later) {
    throw new BusinessError(
      `La tenencia «${later.holdingName}» tiene una venta posterior (${formatDay(later.date)}). Anulá primero esa venta, cargá este movimiento y volvé a cargarla.`
    );
  }
}

/**
 * Impedimentos de corregir, anular o eliminar una compra o venta confirmada
 * (TSK-793). El revert del MF solo borra su `InvestmentMovement`; no vuelve a mirar
 * la historia de la tenencia, así que estos chequeos van antes de simular:
 * - `INVESTMENT_VALUED`: una valuación con fecha igual o posterior a la del MF
 *   quedaría calculada sobre un valor en libros que ya no es el real.
 * - `INVESTMENT_LATER_SALE` (ruling P4): el costo de una venta queda fijo al
 *   confirmarla; si cambia algo anterior de la tenencia deja de ser coherente. Es
 *   posterior la venta de un día siguiente o la del mismo día cargada después (mismo
 *   desempate que `firstNegativePoint`). La propia venta no cuenta.
 */
export async function investmentEffectImpedimentsTx(
  tx: Tx,
  movement: { id: string; holdingId: string; date: Date; createdAt: Date }
): Promise<Impediment[]> {
  const found: Impediment[] = [];

  const valuation = await findValuationFromTx(tx, movement.holdingId, movement.date);
  if (valuation) {
    found.push(impediments.investmentValued(valuation.holdingName, formatDay(valuation.date)));
  }

  const own = await tx.investmentMovement.findMany({
    where: { fundMovementId: movement.id },
    select: { id: true, createdAt: true },
  });
  // Sin movimiento propio (no debería pasar en un MF confirmado), desempata la
  // creación del MF.
  const later = await findLaterSaleTx(tx, movement.holdingId, movement.date, {
    excludeIds: own.map((m) => m.id),
    sameDayAfter: own[0]?.createdAt ?? movement.createdAt,
  });
  if (later) {
    found.push(impediments.investmentLaterSale(later.holdingName, laterSaleLabel(later)));
  }

  return found;
}

/**
 * Ruling R9: las operaciones sobre tenencias se serializan con el lock de Ajustes
 * contables de la empresa (FOR UPDATE de su fila, el que toma `assertPeriodOpen`). Es
 * el mismo que toman la valuación al generar y deshacer y la creación del asiento,
 * así que venta/venta, venta/corrección y venta/valuación esperan en un único orden:
 * la segunda lee la posición con la primera ya confirmada. Sin él, dos ventas a la
 * vez veían la misma posición y las dos pasaban el chequeo de saldo negativo.
 * Reentrante dentro de la transacción. De paso valida el período de la fecha, que
 * el asiento iba a validar igual.
 */
export async function lockHoldingOperationsTx(tx: Tx, companyId: string, date: Date) {
  await assertPeriodOpen(tx, companyId, date);
}

/**
 * Aplica el lado tenencia de una compra o venta confirmada:
 *  0. Toma el lock de las operaciones sobre tenencias (`lockHoldingOperationsTx`).
 *  1. La tenencia tiene que ser de la empresa y estar abierta.
 *  2. Sin valuación con fecha igual o posterior (`assertHoldingNotValuedTx`) ni
 *     venta confirmada posterior de la tenencia (`assertNoLaterSaleTx`, ruling R6).
 *  3. Compra: valor en libros + bruto, nominales + los comprados (si vienen).
 *     Venta: el costo lo decide `computeSaleCost` con la posición a la fecha de la
 *     venta (precio promedio ponderado). Si la venta cierra la tenencia, pasa a CLOSED.
 *  4. Crea el `InvestmentMovement` ligado al MF.
 *  5. Verifica que la historia completa no quede negativa en ningún punto.
 *
 * Devuelve la cuenta contable de la tenencia, el costo (0 en la compra) y el
 * resultado por tenencia (bruto − costo; 0 en la compra) para armar el asiento.
 */
export async function applyInvestmentSideTx(
  tx: Tx,
  ctx: EffectsCtx,
  movement: {
    id: string;
    type: 'INVESTMENT_PURCHASE' | 'INVESTMENT_SALE';
    date: Date;
    amount: Prisma.Decimal;
    holdingId: string | null;
    nominals: Prisma.Decimal | null;
    commission: Prisma.Decimal | null;
    isFullSale: boolean;
  }
): Promise<{ holdingAccountId: string; cost: number; result: number }> {
  const { companyId } = ctx;
  await lockHoldingOperationsTx(tx, companyId, movement.date);
  const holding = movement.holdingId
    ? await tx.investmentHolding.findFirst({
        where: { id: movement.holdingId, companyId, status: 'OPEN' },
        select: { id: true, name: true, accountId: true },
      })
    : null;
  if (!holding) throw new BusinessError('La tenencia seleccionada no es válida o está cerrada');

  await assertHoldingNotValuedTx(tx, holding.id, movement.date);
  await assertNoLaterSaleTx(tx, holding.id, movement.date);

  const gross = Number(movement.amount);
  const nominals = movement.nominals === null ? null : Number(movement.nominals);

  // El schema ya lo rechaza; se repite acá porque el MF pudo escribirse por otro
  // camino (motor de corrección) y una venta así depositaría ≤ 0 en el banco.
  if (movement.type === 'INVESTMENT_SALE' && Number(movement.commission ?? 0) >= gross) {
    throw new BusinessError('La comisión no puede ser mayor o igual al importe');
  }

  if (movement.type === 'INVESTMENT_PURCHASE') {
    await tx.investmentMovement.create({
      data: {
        companyId,
        holdingId: holding.id,
        kind: 'PURCHASE',
        date: movement.date,
        bookDelta: movement.amount,
        nominalsDelta: movement.nominals,
        fundMovementId: movement.id,
      },
    });
    await assertHoldingNeverNegativeTx(tx, holding.id);
    return { holdingAccountId: holding.accountId, cost: 0, result: 0 };
  }

  // VENTA. Con la posición vacía a la fecha no hay nada que vender: se informa
  // como saldo negativo en vez de dejar que la política de venta la cierre con
  // costo 0 (venta total) o hable de "valor en libros" (parcial).
  const position = positionAt(await loadHoldingMovementsTx(tx, holding.id), movement.date);
  if (position.bookValue <= 0 && !(position.nominals !== null && position.nominals > 0)) {
    throw negativeError(holding.name, movement.date);
  }

  const sale = computeSaleCost({
    bookValue: position.bookValue,
    nominals: position.nominals,
    soldNominals: nominals,
    proceeds: gross,
    isFullSale: movement.isFullSale,
  });

  // La venta total cierra la tenencia: si tuviera compras o ventas con fecha
  // posterior, quedaría CLOSED con posición después del cierre (ruling R5). Se
  // mira `closesHolding` y no solo la marca: vender todos los nominales también
  // cierra. El movimiento propio todavía no existe, así que no se cuenta.
  if (sale.closesHolding) {
    const later = await tx.investmentMovement.count({
      where: {
        holdingId: holding.id,
        kind: { in: ['PURCHASE', 'SALE'] },
        date: { gte: moment.utc(movement.date).startOf('day').add(1, 'day').toDate() },
      },
    });
    if (later > 0) {
      throw new BusinessError(
        `La venta total tiene que ser el último movimiento de la tenencia «${holding.name}»: tiene movimientos posteriores al ${formatDay(movement.date)}.`
      );
    }
  }

  await tx.investmentMovement.create({
    data: {
      companyId,
      holdingId: holding.id,
      kind: 'SALE',
      date: movement.date,
      bookDelta: new Prisma.Decimal(-sale.cost),
      nominalsDelta: sale.nominalsDelta === null ? null : new Prisma.Decimal(sale.nominalsDelta),
      proceeds: movement.amount,
      result: new Prisma.Decimal(sale.result),
      closesHolding: sale.closesHolding,
      fundMovementId: movement.id,
    },
  });
  if (sale.closesHolding) {
    await tx.investmentHolding.update({ where: { id: holding.id }, data: { status: 'CLOSED' } });
  }
  await assertHoldingNeverNegativeTx(tx, holding.id);

  return { holdingAccountId: holding.accountId, cost: sale.cost, result: sale.result };
}
