import { Prisma } from '@/generated/prisma/client';

export interface SalesInvoiceStockLine {
  productId: string;
  quantity: Prisma.Decimal;
  trackStock: boolean;
}

/**
 * Cantidad de stock que mueve cada línea de la factura (TSK-798). Los remitos de
 * entrega facturados en ella ya descontaron su mercadería al crearse: por producto,
 * lo entregado cubre las líneas en orden y la factura solo mueve el excedente
 * (una línea agregada o una cantidad mayor al editar el borrador). Lo entregado de
 * más no vuelve al stock: la mercadería salió con el remito.
 *
 * Devuelve solo las líneas con ítem de stock y cantidad a mover mayor que cero.
 */
export function stockQuantitiesToMove<T extends SalesInvoiceStockLine>(
  lines: T[],
  deliveredByProduct: ReadonlyMap<string, Prisma.Decimal>
): { line: T; quantity: Prisma.Decimal }[] {
  const pending = new Map(deliveredByProduct);
  const result: { line: T; quantity: Prisma.Decimal }[] = [];
  for (const line of lines) {
    if (!line.trackStock) continue;
    const delivered = pending.get(line.productId) ?? new Prisma.Decimal(0);
    const covered = Prisma.Decimal.min(delivered, line.quantity);
    pending.set(line.productId, delivered.minus(covered));
    const quantity = line.quantity.minus(covered);
    if (quantity.greaterThan(0)) result.push({ line, quantity });
  }
  return result;
}
