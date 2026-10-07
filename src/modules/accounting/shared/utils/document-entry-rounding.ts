/**
 * Ajuste de redondeo del asiento de un comprobante comercial (TSK-760, R-1).
 *
 * El comprobante calcula su IVA (y en compras también su subtotal) sobre la
 * suma de las líneas y redondea una vez; cada línea guarda su importe
 * redondeado por separado. Con dos o más líneas la suma de las líneas puede
 * diferir del comprobante en algunos centavos (dos líneas de $1,07 al 21%:
 * 0,22 + 0,22 = 0,44 contra 0,45 del comprobante, total 2,59). El asiento se
 * arma con los importes de línea y la cuenta corriente con el total del
 * comprobante, así que no cuadraba.
 *
 * Criterio: **el comprobante manda** (es lo que se informa a ARCA y ve el
 * cliente). Las líneas de IVA del asiento suman el IVA del comprobante —la
 * diferencia va a la de mayor importe— y, si todavía queda diferencia contra el
 * total (subtotal redondeado distinto, cantidades fraccionarias en compras), va
 * a la línea de neto de mayor importe. Percepciones e impuestos internos van
 * tal cual.
 *
 * Solo se absorbe lo que puede ser redondeo: hasta un centavo por línea del
 * comprobante. Una diferencia mayor no es redondeo (p. ej. un descuento global
 * que el asiento no contempla): se deja como está y la rechaza el núcleo.
 */

export interface DocumentEntryAmountsInput {
  /** Total guardado en la cabecera del comprobante. */
  documentTotal: number;
  /** IVA total guardado en la cabecera del comprobante. */
  documentVat: number;
  /** Importes de las líneas de neto del asiento, en su orden. */
  net: number[];
  /** Importes de las líneas de IVA del asiento (una por alícuota), en su orden. */
  vat: number[];
  /** Percepciones e impuestos internos: no se tocan. */
  other: number[];
  /** Cantidad de líneas del comprobante: acota la diferencia que se absorbe. */
  documentLineCount: number;
}

export interface DocumentEntryAmounts {
  net: number[];
  vat: number[];
}

const toCents = (value: number) => Math.round(value * 100);
const sumCents = (values: number[]) => values.reduce((acc, v) => acc + v, 0);

function indexOfLargest(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

/** Suma `diff` a la línea de mayor importe si es redondeo y no la deja en cero o negativa. */
function absorbIntoLargest(cents: number[], diff: number, tolerance: number): number[] {
  if (diff === 0 || cents.length === 0 || Math.abs(diff) > tolerance) return cents;
  const index = indexOfLargest(cents);
  if (cents[index] + diff <= 0) return cents;
  const adjusted = [...cents];
  adjusted[index] += diff;
  return adjusted;
}

export function reconcileDocumentEntryAmounts(input: DocumentEntryAmountsInput): DocumentEntryAmounts {
  const tolerance = Math.max(1, input.documentLineCount);

  const vat = absorbIntoLargest(
    input.vat.map(toCents),
    toCents(input.documentVat) - sumCents(input.vat.map(toCents)),
    tolerance
  );

  const netCents = input.net.map(toCents);
  const residual =
    toCents(input.documentTotal) - sumCents(netCents) - sumCents(vat) - sumCents(input.other.map(toCents));
  const net = absorbIntoLargest(netCents, residual, tolerance);

  return {
    net: net.map((c) => c / 100),
    vat: vat.map((c) => c / 100),
  };
}
