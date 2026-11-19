/**
 * Lógica pura del `MoneyInput` (`shared/components/ui/money-input.tsx`): formato
 * es-AR de lo que se muestra y conversión al valor crudo que ve el formulario.
 * Vive aparte del componente para poder testearla sin DOM.
 */

/** "4000000.5" -> "4.000.000,5" (formato es-AR). */
export function formatMoneyDisplay(raw: string): string {
  if (raw === '' || raw == null) return '';
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPart, decPart] = unsigned.split('.');
  const intClean = intPart.replace(/^0+(?=\d)/, ''); // sin ceros a la izquierda
  const intFormatted = (intClean || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = decPart !== undefined ? `${intFormatted},${decPart}` : intFormatted;
  return negative ? `-${body}` : body;
}

/**
 * Texto tipeado (es-AR) -> valor crudo con punto decimal.
 * La PRIMERA coma se toma como decimal; los puntos se tratan como separadores
 * de miles y se descartan.
 */
export function parseMoneyDisplay(display: string, maxDecimals: number): string {
  const negative = display.trim().startsWith('-');
  // Quitar todo lo que no sea dígito o coma (los puntos son miles)
  let cleaned = display.replace(/[^\d,]/g, '');
  // Solo la primera coma cuenta como decimal
  const firstComma = cleaned.indexOf(',');
  if (firstComma !== -1) {
    const intp = cleaned.slice(0, firstComma).replace(/,/g, '');
    let decp = cleaned.slice(firstComma + 1).replace(/,/g, '');
    if (maxDecimals >= 0) decp = decp.slice(0, maxDecimals);
    cleaned = `${intp}.${decp}`;
  }
  if (cleaned === '' || cleaned === '.') return '';
  return negative ? `-${cleaned}` : cleaned;
}

/**
 * Tecla "." del teclado numérico (TSK-851): en es-AR esa tecla es la coma
 * decimal, como en Excel. Sin esto el punto se toma como separador de miles y
 * se descarta, así que "24.5" tipeado con el numérico quedaba en 245.
 *
 * Devuelve el texto con la coma insertada en lugar de la selección, o `null`
 * cuando no corresponde insertarla: el importe no admite decimales o ya tiene
 * una coma (una segunda se descartaría igual).
 */
export function insertDecimalComma(
  display: string,
  selectionStart: number,
  selectionEnd: number,
  maxDecimals: number
): string | null {
  if (maxDecimals === 0) return null;
  const before = display.slice(0, selectionStart);
  const after = display.slice(selectionEnd);
  if (before.includes(',') || after.includes(',')) return null;
  // Coma al principio: se interpreta "0,".
  return `${before === '' || before === '-' ? `${before}0` : before},${after}`;
}
