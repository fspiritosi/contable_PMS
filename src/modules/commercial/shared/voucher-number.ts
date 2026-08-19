/**
 * Normalización del punto de venta y el número de un comprobante.
 *
 * Ambos se guardan con largo fijo y ceros a la izquierda (0001-00000123). La
 * importación desde ARCA/AFIP ya los rellenaba, pero la carga manual obligaba a
 * tipear los ceros y a contarlos (TSK-581).
 */

export const POINT_OF_SALE_LENGTH = 4;
export const VOUCHER_NUMBER_LENGTH = 8;

/**
 * Rellena con ceros a la izquierda hasta `length`.
 *
 * Deja pasar sin tocar lo vacío y lo que no son solo dígitos, para que el campo
 * obligatorio siga marcándose como tal y los formatos inválidos los rechace la
 * validación con su propio mensaje. Tampoco recorta lo que excede el largo: ahí
 * hay un error del usuario que conviene mostrar, no ocultar.
 */
function padVoucherPart(value: string, length: number): string {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) return trimmed;
  if (trimmed.length > length) return trimmed;

  return trimmed.padStart(length, '0');
}

/** Punto de venta a 4 dígitos: "1" pasa a "0001". */
export function padPointOfSale(value: string): string {
  return padVoucherPart(value, POINT_OF_SALE_LENGTH);
}

/** Número de comprobante a 8 dígitos: "123" pasa a "00000123". */
export function padVoucherNumber(value: string): string {
  return padVoucherPart(value, VOUCHER_NUMBER_LENGTH);
}
