import 'server-only';

import moment from 'moment';

import { Prisma } from '@/generated/prisma/client';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import {
  computeSaleCost,
  firstNegativePoint,
  positionAt,
  type PositionMovement,
} from '@/modules/commercial/features/treasury/features/investments/shared/position';
import { BusinessError } from '@/shared/lib/action-result';

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

/** Movimientos de la tenencia, listos para el módulo puro de posición. */
export async function loadHoldingMovementsTx(
  tx: Tx,
  holdingId: string
): Promise<PositionMovement[]> {
  const rows = await tx.investmentMovement.findMany({
    where: { holdingId },
    select: { kind: true, date: true, bookDelta: true, nominalsDelta: true, createdAt: true },
  });
  return rows.map((row) => ({
    kind: row.kind,
    date: row.date,
    bookDelta: Number(row.bookDelta),
    nominalsDelta: row.nominalsDelta === null ? null : Number(row.nominalsDelta),
    createdAt: row.createdAt,
  }));
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
 * Una valuación al cierre fija el valor en libros de la tenencia a esa fecha. Un
 * movimiento con fecha igual o anterior la dejaría desactualizada, así que se
 * rechaza hasta que se deshaga la valuación. La comparación es por día calendario:
 * la valuación se guarda a las 00:00Z y el MF al mediodía UTC.
 */
export async function assertHoldingNotValuedTx(
  tx: Tx,
  holdingId: string,
  date: Date
): Promise<void> {
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
  if (valuation) {
    throw new BusinessError(
      `La tenencia «${valuation.holding.name}» ya tiene valuación al cierre del ${formatDay(valuation.date)}. Deshacé esa valuación para registrar movimientos anteriores.`
    );
  }
}

/**
 * Aplica el lado tenencia de una compra o venta confirmada:
 *  1. La tenencia tiene que ser de la empresa y estar abierta.
 *  2. Sin valuación con fecha igual o posterior (`assertHoldingNotValuedTx`).
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
  const holding = movement.holdingId
    ? await tx.investmentHolding.findFirst({
        where: { id: movement.holdingId, companyId, status: 'OPEN' },
        select: { id: true, name: true, accountId: true },
      })
    : null;
  if (!holding) throw new BusinessError('La tenencia seleccionada no es válida o está cerrada');

  await assertHoldingNotValuedTx(tx, holding.id, movement.date);

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
