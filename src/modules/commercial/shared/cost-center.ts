/**
 * Cuándo una línea de factura de compra admite centro de costo (TSK-583).
 *
 * El centro de costo reparte resultados: solo tiene sentido cuando la línea se
 * imputa a una cuenta de ingresos o de egresos. Comprar un activo mueve
 * patrimonio, no consume presupuesto de ningún centro, así que esas líneas no
 * ofrecen el campo.
 */

/** Tipos de cuenta que participan del resultado del ejercicio. */
export const RESULT_ACCOUNT_TYPES = ['REVENUE', 'EXPENSE'] as const;

/**
 * `accountType` es el tipo de la cuenta con la que se imputa la línea. Viene
 * vacío cuando la línea no tiene ítem asociado (un gasto suelto), y en ese caso
 * tampoco se ofrece el campo: sin cuenta conocida no hay criterio.
 */
export function allowsCostCenter(accountType: string | null | undefined): boolean {
  if (!accountType) return false;

  return (RESULT_ACCOUNT_TYPES as readonly string[]).includes(accountType);
}

/** Un tramo del reparto: qué centro se lleva qué porcentaje de la línea. */
export interface CostCenterAllocation {
  costCenterId: string;
  percentage: number;
}

/** Redondeo a 2 decimales, evitando el arrastre binario de 0.1 + 0.2. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Suma de los porcentajes del reparto, con 2 decimales. */
export function totalPercentage(allocations: CostCenterAllocation[]): number {
  return round2(allocations.reduce((acc, a) => acc + a.percentage, 0));
}

export type AllocationError =
  | 'DUPLICATE_COST_CENTER'
  | 'NON_POSITIVE_PERCENTAGE'
  | 'INCOMPLETE_TOTAL';

/** Mensajes para el usuario, en un solo lugar para formulario y server action. */
export const ALLOCATION_ERROR_MESSAGES: Record<AllocationError, string> = {
  DUPLICATE_COST_CENTER: 'No se puede repetir el mismo centro de costo en una línea',
  NON_POSITIVE_PERCENTAGE: 'Cada centro de costo debe llevarse un porcentaje mayor a cero',
  INCOMPLETE_TOTAL: 'El reparto debe sumar 100%',
};

/**
 * Un reparto es válido si está vacío (imputación opcional, cae en el centro
 * predeterminado del ítem) o si suma exactamente 100%. Un valor intermedio deja
 * plata sin imputar, así que no se admite ni siquiera con la obligatoriedad
 * apagada.
 */
export function validateAllocations(
  allocations: CostCenterAllocation[]
): AllocationError | null {
  if (allocations.length === 0) return null;

  const ids = new Set(allocations.map((a) => a.costCenterId));
  if (ids.size !== allocations.length) return 'DUPLICATE_COST_CENTER';

  if (allocations.some((a) => a.percentage <= 0)) return 'NON_POSITIVE_PERCENTAGE';

  if (totalPercentage(allocations) !== 100) return 'INCOMPLETE_TOTAL';

  return null;
}

/**
 * Reparte un importe según los porcentajes.
 *
 * El último centro absorbe la diferencia de redondeo: sin eso, un 33/33/34 sobre
 * $10 devuelve partes que suman $9,99 y el asiento no cierra, así que la factura
 * no se puede confirmar.
 */
export function prorateAmount(
  amount: number,
  allocations: CostCenterAllocation[]
): Array<{ costCenterId: string; amount: number }> {
  if (allocations.length === 0) return [];

  const parts = allocations.map((a) => ({
    costCenterId: a.costCenterId,
    amount: round2((amount * a.percentage) / 100),
  }));

  const assigned = round2(parts.slice(0, -1).reduce((acc, p) => acc + p.amount, 0));
  parts[parts.length - 1].amount = round2(amount - assigned);

  return parts;
}
