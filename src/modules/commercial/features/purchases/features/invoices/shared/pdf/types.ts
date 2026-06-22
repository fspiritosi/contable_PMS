/**
 * Tipos para generación de PDFs de facturas de compra
 */

export interface PurchaseInvoicePDFData {
  company: {
    name: string;
    taxId: string;
    address: string;
    phone?: string;
    email?: string;
    logoDataUri?: string;
  };

  invoice: {
    type: 'A' | 'B' | 'C';
    voucherType: string;
    fullNumber: string;
    issueDate: Date;
    dueDate?: Date;
    cae?: string;
  };

  supplier: {
    businessName: string;
    tradeName?: string;
    taxId: string;
    taxCondition?: string;
    address?: string;
    phone?: string;
    email?: string;
  };

  lines: Array<{
    code?: string;
    description: string;
    quantity: number;
    unitOfMeasure: string;
    unitCost: number;
    vatRate: number;
    subtotal: number;
    vatAmount: number;
    total: number;
  }>;

  totals: {
    subtotal: number;
    vatAmount: number;
    otherTaxes: number;
    total: number;
    vatByRate?: Array<{
      rate: number;
      base: number;
      amount: number;
    }>;
  };

  purchaseOrder?: {
    fullNumber: string;
  };

  notes?: string;

  linkedDocuments?: import('@/modules/commercial/shared/pdf/linked-documents-types').LinkedDocumentsData;
}
