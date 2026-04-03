/**
 * Generador de PDFs de presupuestos
 */

import { renderToBuffer } from '@react-pdf/renderer';
import { QuoteTemplate } from './QuoteTemplate';
import type { QuotePDFData } from './types';

/**
 * Genera un PDF de presupuesto y lo retorna como Buffer
 */
export async function generateQuotePDF(data: QuotePDFData): Promise<Buffer> {
  const buffer = await renderToBuffer(<QuoteTemplate data={data} />);
  return buffer;
}

/**
 * Genera el nombre de archivo para el PDF del presupuesto
 */
export function getQuoteFileName(data: QuotePDFData): string {
  const number = data.quote.number.replace('-', '_');
  const date = new Date().toISOString().split('T')[0];

  return `Presupuesto_${number}_${date}.pdf`;
}
