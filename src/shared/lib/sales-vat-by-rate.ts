/**
 * IVA por alícuota de un comprobante de venta (TSK-762).
 *
 * Cada línea guarda su neto e IVA **antes** del descuento global; la cabecera (`netTaxed`,
 * `vatAmount`, `total`) ya lo descuenta, prorrateado por línea en proporción a su neto
 * (`buildSalesInvoiceAmounts`), y redondea una vez sobre la suma. Todo lo que desglosa el IVA por
 * alícuota tiene que partir de acá y no sumar las líneas: la emisión a ARCA (que exige que las
 * `AlicIva` sumen `ImpNeto` e `ImpIVA`), el asiento, el Libro IVA Digital, la Posición de IVA, el
 * PDF y el reporte de IVA Ventas.
 *
 * Criterio: igual que el descuento por línea, el global reduce la base de cada alícuota (no hay
 * cuenta de descuentos otorgados) y **el comprobante manda**: las bases suman el neto gravado y
 * los IVA el IVA de la cabecera; la diferencia de redondeo va a la alícuota de mayor importe. Solo
 * se absorbe lo que puede ser redondeo (un centavo por línea): una diferencia mayor es un dato
 * inconsistente y se deja a la vista.
 *
 * Puro: acepta números o los `Decimal` de Prisma tal como vienen de la consulta.
 */

/** Un número o un `Decimal` de Prisma. */
type Numeric = number | { toNumber(): number };

export interface SalesVatLine {
  /** `InvoiceLineType`; sin informar se toma como gravada (las de venta lo son siempre). */
  lineType?: string;
  vatRate: Numeric;
  /** Neto de la línea, antes del descuento global. */
  subtotal: Numeric;
  /** IVA de la línea, antes del descuento global. */
  vatAmount: Numeric;
}

export interface SalesVatDocument {
  /** Neto gravado de la cabecera (con descuento global). */
  netTaxed: Numeric;
  globalDiscountPercent?: Numeric | null;
  globalDiscountAmount?: Numeric | null;
  lines: SalesVatLine[];
}

export interface SalesVatRate {
  rate: number;
  base: number;
  vat: number;
}

const num = (value: Numeric | null | undefined) =>
  value == null ? 0 : typeof value === 'number' ? value : value.toNumber();
const isTaxed = (line: SalesVatLine) => (line.lineType ?? 'TAXED') === 'TAXED';
const toCents = (value: number) => Math.round(value * 100);
const sumOf = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

/**
 * Factor que lleva el neto e IVA de una línea a su valor con descuento global: neto gravado de la
 * cabecera / suma de los netos de línea. Sin descuento global, 1 (no se toca nada).
 */
export function salesGlobalDiscountFactor(document: SalesVatDocument): number {
  const hasGlobalDiscount = num(document.globalDiscountPercent) > 0 || num(document.globalDiscountAmount) > 0;
  const linesNet = sumOf(document.lines.filter(isTaxed).map((line) => num(line.subtotal)));
  if (!hasGlobalDiscount || linesNet <= 0) return 1;
  return num(document.netTaxed) / linesNet;
}

/** Suma `diff` centavos al mayor importe si es redondeo (≤ `tolerance`) y no lo deja en cero o negativo. */
function absorbIntoLargest(cents: number[], diff: number, tolerance: number): number[] {
  if (diff === 0 || cents.length === 0 || Math.abs(diff) > tolerance) return cents;
  const largest = cents.reduce((best, value, i) => (value > cents[best] ? i : best), 0);
  if (cents[largest] + diff <= 0) return cents;
  const adjusted = [...cents];
  adjusted[largest] += diff;
  return adjusted;
}

/**
 * Base e IVA por alícuota, con el descuento global aplicado y ajustados al centavo a la cabecera.
 * En el orden en que aparecen las alícuotas en las líneas.
 */
export function salesVatByRate(document: SalesVatDocument & { vatAmount: Numeric }): SalesVatRate[] {
  const factor = salesGlobalDiscountFactor(document);
  const taxed = document.lines.filter(isTaxed);

  const byRate = new Map<number, { base: number; vat: number }>();
  for (const line of taxed) {
    const rate = num(line.vatRate);
    const existing = byRate.get(rate) ?? { base: 0, vat: 0 };
    existing.base += num(line.subtotal) * factor;
    existing.vat += num(line.vatAmount) * factor;
    byRate.set(rate, existing);
  }

  const rates = [...byRate.keys()];
  const tolerance = Math.max(1, taxed.length);
  const baseCents = rates.map((rate) => toCents(byRate.get(rate)!.base));
  const vatCents = rates.map((rate) => toCents(byRate.get(rate)!.vat));
  const bases = absorbIntoLargest(baseCents, toCents(num(document.netTaxed)) - sumOf(baseCents), tolerance);
  const vats = absorbIntoLargest(vatCents, toCents(num(document.vatAmount)) - sumOf(vatCents), tolerance);

  return rates.map((rate, i) => ({ rate, base: bases[i] / 100, vat: vats[i] / 100 }));
}
