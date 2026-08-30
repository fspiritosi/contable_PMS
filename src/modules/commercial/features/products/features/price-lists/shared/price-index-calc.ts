/**
 * Cálculo del ajuste de precios por índice (TSK-621).
 *
 * Funciones puras: no tocan base de datos ni dependen de Prisma, así que el
 * caso difícil —el redondeo— se puede testear entero sin levantar nada.
 */

/** Un ítem de lista de precios, visto desde el ajuste. */
export interface AdjustableItem {
  id: string;
  price: number;
  /** Alícuota de IVA del ítem, en porcentaje (21 = 21%). */
  vatRate: number;
}

/** El mismo ítem con los dos precios ya ajustados. */
export interface AdjustedItem {
  id: string;
  price: number;
  priceWithTax: number;
}

/** Redondeo a 2 decimales, evitando el arrastre binario de 0.1 + 0.2. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Aplica un porcentaje a un importe. Acepta negativos: un índice puede dar
 * baja, y bloquearlo sería inventar una restricción que la realidad no tiene.
 */
export function applyPercentage(value: number, percentage: number): number {
  return round2(value * (1 + percentage / 100));
}

/**
 * Ajusta un ítem. `priceWithTax` se recalcula **desde el precio ya ajustado**,
 * no aplicando el índice al precio con IVA anterior: por redondeo los dos
 * caminos divergen y los campos quedan desincronizados.
 */
export function adjustItem(item: AdjustableItem, percentage: number): AdjustedItem {
  const price = applyPercentage(item.price, percentage);

  return {
    id: item.id,
    price,
    priceWithTax: round2(price * (1 + item.vatRate / 100)),
  };
}

/** Ajusta todos los ítems de una lista, conservando el orden. */
export function adjustItems(items: AdjustableItem[], percentage: number): AdjustedItem[] {
  return items.map((item) => adjustItem(item, percentage));
}

/** Una aplicación ya registrada, vista desde la detección de repetidos. */
export interface PreviousApplication {
  indexId: string;
  indexValueId: string;
  appliedAt: Date;
  appliedBy: string | null;
}

/**
 * La aplicación más reciente del mismo valor de índice sobre esta lista, si la
 * hay. Sirve para avisar antes de repetir: aplicar dos veces un 4,2% sube 8,6%.
 */
export function findPreviousApplication<T extends PreviousApplication>(
  applications: T[],
  indexValueId: string
): T | null {
  const matches = applications.filter((a) => a.indexValueId === indexValueId);
  if (matches.length === 0) return null;

  return matches.reduce((latest, a) => (a.appliedAt > latest.appliedAt ? a : latest));
}
