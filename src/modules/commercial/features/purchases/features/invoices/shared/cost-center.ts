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
