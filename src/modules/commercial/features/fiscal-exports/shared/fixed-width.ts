/**
 * Campos de los archivos de largo fijo de SIRE y SICORE (TSK-813): texto alineado a la izquierda
 * con espacios; números alineados a la derecha con ceros; importes con dos decimales y punto.
 */

export function text(value: string, len: number): string {
  return value.substring(0, len).padEnd(len, ' ');
}

export function integer(value: number | string, len: number): string {
  return String(value).padStart(len, '0').slice(-len);
}

export function decimal(amount: number, len: number): string {
  return Math.abs(amount).toFixed(2).padStart(len, '0');
}

export function blank(len: number): string {
  return ' '.repeat(len);
}

/** Solo los dígitos: CUIT sin guiones, número de comprobante sin separadores. */
export function digits(value: string): string {
  return value.replace(/\D/g, '');
}
