/**
 * Tipos para generación de PDFs de facturas de compra
 */
import type { ThemeConfig } from '@/shared/utils/pdf-themes';

export interface PurchaseInvoicePDFData {
  themeConfig: ThemeConfig;
  headerText?: string | null;
  footerText?: string | null;
  notesDefault?: string | null;
  showIssuer?: boolean;
  showReceiver?: boolean;
  showNotes?: boolean;
  showCae?: boolean;

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
    /** Percepciones + impuestos internos (TSK-644). */
    otherTaxes: number;
    internalTaxes: number;
    perceptions: Array<{ label: string; amount: number }>;
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
