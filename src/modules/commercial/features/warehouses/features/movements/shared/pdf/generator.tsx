import { renderToBuffer } from '@react-pdf/renderer';
import { StockTransferTemplate } from './StockTransferTemplate';
import type { StockTransferPDFData } from './types';

export async function generateStockTransferPDF(data: StockTransferPDFData): Promise<Buffer> {
  try {
    const buffer = await renderToBuffer(<StockTransferTemplate data={data} />);
    return buffer;
  } catch (error) {
    throw new Error('Error al generar el PDF de la transferencia');
  }
}

export function getStockTransferFileName(data: StockTransferPDFData): string {
  const number = data.transfer.transferNumber.replace('-', '_');
  const date = new Date().toISOString().split('T')[0];
  return `Transferencia_${number}_${date}.pdf`;
}
