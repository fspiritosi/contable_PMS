/**
 * Tipos para generación de PDFs de facturas
 */
import type { ThemeConfig } from '@/shared/utils/pdf-themes';

export interface InvoicePDFData {
  // Configuración visual del template
  themeConfig: ThemeConfig;
  headerText?: string | null;
  footerText?: string | null;
  notesDefault?: string | null;
  showIssuer?: boolean;
  showReceiver?: boolean;
  showNotes?: boolean;
  showCae?: boolean;

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

  // Líneas de ítems
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
    /** Percepciones + impuestos internos (TSK-644). */
    otherTaxes: number;
    internalTaxes: number;
    perceptions: Array<{ label: string; amount: number }>;
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
