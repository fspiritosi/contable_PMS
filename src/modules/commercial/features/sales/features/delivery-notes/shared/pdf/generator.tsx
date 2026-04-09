import { renderToBuffer } from '@react-pdf/renderer';
import { DeliveryNoteTemplate } from './DeliveryNoteTemplate';
import type { DeliveryNotePDFData } from './types';

export async function generateDeliveryNotePDF(data: DeliveryNotePDFData): Promise<Buffer> {
  const buffer = await renderToBuffer(<DeliveryNoteTemplate data={data} />);
  return buffer;
}

export function getDeliveryNoteFileName(data: DeliveryNotePDFData): string {
  const number = data.deliveryNote.fullNumber.replace('-', '_');
  const date = new Date().toISOString().split('T')[0];
  return `Remito_Entrega_${number}_${date}.pdf`;
}
