import type { InvestmentMovementKind } from '@/generated/prisma/enums';
import { BusinessError } from '@/shared/lib/action-result';

/**
 * Posición de una tenencia (valor en libros y nominales). Módulo puro: sin
 * Prisma ni acceso a datos, para poder usarlo en servidor y en tests.
 *
 * La posición no se guarda: es la suma de los movimientos con fecha <= D.
 */

export interface PositionMovement {
  kind: InvestmentMovementKind;
  date: Date;
  bookDelta: number;
  nominalsDelta: number | null;
  createdAt: Date;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round6 = (n: number) => Math.round((n + Number.EPSILON) * 1_000_000) / 1_000_000;

/** Posición al cierre del día `asOf` (todos los movimientos si no viene). */
export function positionAt(
  movements: PositionMovement[],
  asOf?: Date
): { bookValue: number; nominals: number | null } {
  let book = 0;
  let nominals = 0;
  let hasNominals = false;
  for (const m of movements) {
    if (asOf && m.date.getTime() > asOf.getTime()) continue;
    book += m.bookDelta;
    if (m.nominalsDelta !== null) {
      nominals += m.nominalsDelta;
      hasNominals = true;
    }
  }
  return { bookValue: round2(book), nominals: hasNominals ? round6(nominals) : null };
}

// A igual fecha: compra, después venta, después valuación.
const KIND_ORDER: Record<InvestmentMovementKind, number> = { PURCHASE: 0, SALE: 1, VALUATION: 2 };

/**
 * Primer movimiento tras el cual la posición queda negativa (valor en libros o
 * nominales < 0), o null si nunca lo está. Una tenencia no admite posiciones cortas.
 */
export function firstNegativePoint(movements: PositionMovement[]): PositionMovement | null {
  const sorted = [...movements].sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.createdAt.getTime() - b.createdAt.getTime()
  );
  let book = 0;
  let nominals = 0;
  for (const m of sorted) {
    book += m.bookDelta;
    nominals += m.nominalsDelta ?? 0;
    if (round2(book) < 0 || round6(nominals) < 0) return m;
  }
  return null;
}

/**
 * Costo de una venta (política confirmada por el cliente): el costo es el valor
 * en libros proporcional a los nominales vendidos (precio promedio ponderado) y
 * el resultado se registra en el momento de la venta parcial.
 */
export function computeSaleCost(input: {
  bookValue: number;
  nominals: number | null;
  soldNominals: number | null;
  proceeds: number;
  isFullSale: boolean;
}): { cost: number; nominalsDelta: number | null; result: number; closesHolding: boolean } {
  const { bookValue, nominals, soldNominals, proceeds } = input;

  const fullSale = () => ({
    cost: bookValue,
    nominalsDelta: nominals === null ? null : -nominals,
    result: round2(proceeds - bookValue),
    closesHolding: true,
  });

  if (input.isFullSale) return fullSale();

  if (soldNominals !== null && nominals !== null && nominals > 0) {
    if (soldNominals > nominals) {
      throw new BusinessError('No podés vender más nominales de los que tiene la tenencia');
    }
    if (soldNominals === nominals) return fullSale();
    const cost = round2((bookValue * soldNominals) / nominals);
    return {
      cost,
      nominalsDelta: -soldNominals,
      result: round2(proceeds - cost),
      closesHolding: false,
    };
  }

  if (proceeds > bookValue) {
    throw new BusinessError(
      'El importe supera el valor en libros de la tenencia. Si vendés todo, marcá "Venta total".'
    );
  }
  return { cost: proceeds, nominalsDelta: null, result: 0, closesHolding: false };
}
