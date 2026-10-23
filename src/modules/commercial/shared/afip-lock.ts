/**
 * Una factura de venta con CAE, o de un punto de venta habilitado para AFIP, no se
 * edita, elimina ni anula desde el sistema: se corrige con una nota de crédito
 * (TSK-792, spec §4.1). Puro: lo usan el servidor y la UI.
 */
export function isAfipLocked(invoice: {
  cae: string | null;
  pointOfSale: { afipEnabled: boolean };
}): boolean {
  return Boolean(invoice.cae) || invoice.pointOfSale.afipEnabled;
}
