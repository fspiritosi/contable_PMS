/**
 * Conceptos de un movimiento de gastos e impuestos bancarios (TSK-585).
 *
 * Funciones puras: la suma y la validación se testean sin base ni formulario.
 * El total del movimiento sale de acá y no de lo que mande el cliente.
 */

/** Un concepto tal como llega del formulario: el importe viaja como texto. */
export interface FundMovementLineInput {
  accountId: string;
  description: string;
  amount: string;
}

/** Redondeo a 2 decimales, evitando el arrastre binario de 0.1 + 0.2. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Total del movimiento: la suma de sus conceptos. */
export function sumLines(lines: FundMovementLineInput[]): number {
  return round2(lines.reduce((total, line) => total + (parseFloat(line.amount) || 0), 0));
}

export type LineError =
  | 'NO_LINES'
  | 'MISSING_ACCOUNT'
  | 'MISSING_DESCRIPTION'
  | 'NON_POSITIVE_AMOUNT';

/** Mensajes para el usuario, en un solo lugar para el formulario y el server action. */
export const LINE_ERROR_MESSAGES: Record<LineError, string> = {
  NO_LINES: 'Agregá al menos un concepto',
  MISSING_ACCOUNT: 'Elegí la cuenta contable del concepto',
  MISSING_DESCRIPTION: 'Escribí una descripción para el concepto',
  NON_POSITIVE_AMOUNT: 'El importe del concepto debe ser mayor a 0',
};

/**
 * El primer problema que encuentra, con el índice de la línea que lo tiene.
 * Devuelve `index: -1` cuando el problema es que no hay ninguna línea.
 */
export function validateLines(
  lines: FundMovementLineInput[]
): { index: number; error: LineError } | null {
  if (lines.length === 0) return { index: -1, error: 'NO_LINES' };

  for (const [index, line] of lines.entries()) {
    if (!line.accountId) return { index, error: 'MISSING_ACCOUNT' };
    if (!line.description.trim()) return { index, error: 'MISSING_DESCRIPTION' };
    if (!(parseFloat(line.amount) > 0)) return { index, error: 'NON_POSITIVE_AMOUNT' };
  }

  return null;
}
