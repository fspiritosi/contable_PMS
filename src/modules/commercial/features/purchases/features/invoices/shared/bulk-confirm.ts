/**
 * Reglas de la confirmación masiva de facturas de compra (TSK-583).
 *
 * Confirmar genera asientos y, en las notas de crédito, movimientos de stock.
 * El lote es best-effort: cada factura se confirma por su cuenta y las que
 * fallan se informan sin descartar las que sí salieron.
 */

export interface ConfirmableInvoice {
  id: string;
  fullNumber: string;
  status: string;
}

export interface BulkConfirmFailure {
  fullNumber: string;
  message: string;
}

/**
 * De una selección cualquiera, las que están en condiciones de confirmarse.
 *
 * La selección de la tabla no distingue estados, así que puede mezclar
 * borradores con facturas ya confirmadas, pagadas o anuladas.
 */
export function selectConfirmableInvoices<T extends ConfirmableInvoice>(invoices: T[]): T[] {
  return invoices.filter((invoice) => invoice.status === 'DRAFT');
}

/** Resumen para el aviso que ve el usuario al terminar el lote. */
export function buildBulkConfirmMessage(
  confirmedCount: number,
  failures: BulkConfirmFailure[]
): string {
  if (confirmedCount === 0) {
    return `No se pudo confirmar ninguna de las ${failures.length} facturas seleccionadas`;
  }

  const confirmed =
    confirmedCount === 1 ? 'Se confirmó 1 factura' : `Se confirmaron ${confirmedCount} facturas`;

  if (failures.length === 0) return confirmed;

  return `${confirmed}; ${failures.length} no se pudieron confirmar`;
}
