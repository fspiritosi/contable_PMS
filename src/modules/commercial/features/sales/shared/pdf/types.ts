/**
 * Tipos para generación de PDFs de facturas
 */

export interface InvoicePDFData {
  // Datos de la empresa
  company: {
    name: string;
    taxId: string;
    taxCondition: string;
    address: string;
    phone?: string;
    email?: string;
    logoDataUri?: string;
  };

  // Datos de la factura
  invoice: {
    type: 'A' | 'B' | 'C';
    voucherType: string;
    fullNumber: string;
    number: number;
    pointOfSale: number;
    issueDate: Date;
    dueDate?: Date;
    cae?: string;
    caeExpiryDate?: Date;
  };

  // Datos del cliente
  customer: {
    name: string;
    taxId?: string;
    taxCondition: string;
    address?: string;
    phone?: string;
    email?: string;
  };

  // Líneas de productos
  lines: Array<{
    code: string;
    description: string;
    quantity: number;
    unitOfMeasure: string;
    unitPrice: number;
    vatRate: number;
    subtotal: number;
    vatAmount: number;
    total: number;
    discountPercent?: number | null;
    discountAmount?: number | null;
  }>;

  // Totales
  totals: {
    subtotal: number;
    vatAmount: number;
    otherTaxes: number;
    total: number;
    totalBeforeDiscount?: number;
    discountTotal?: number;
    vatByRate?: Array<{
      rate: number;
      base: number;
      amount: number;
    }>;
  };

  // Observaciones
  notes?: string;

  // Documentos vinculados (opcional, según selección del usuario)
  linkedDocuments?: import('@/modules/commercial/shared/pdf/linked-documents-types').LinkedDocumentsData;
}
