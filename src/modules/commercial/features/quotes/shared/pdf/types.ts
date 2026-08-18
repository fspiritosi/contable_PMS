/**
 * Tipos para generación de PDFs de presupuestos
 */
import type { ThemeConfig } from '@/shared/utils/pdf-themes';

export interface QuotePDFData {
  themeConfig: ThemeConfig;
  headerText?: string | null;
  footerText?: string | null;
  notesDefault?: string | null;
  showIssuer?: boolean;
  showReceiver?: boolean;
  showNotes?: boolean;

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

  // Datos del presupuesto
  quote: {
    number: string;
    issueDate: Date;
    expirationDate?: Date;
    currency: string;
  };

  // Datos del destinatario
  recipient: {
    name: string;
    taxId?: string;
    address?: string;
    phone?: string;
    email?: string;
    type: 'customer' | 'lead';
  };

  // Líneas de ítems
  lines: Array<{
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
    total: number;
    vatByRate?: Array<{ rate: number; base: number; amount: number }>;
    totalBeforeDiscount?: number;
    discountTotal?: number;
  };

  // Condiciones comerciales
  conditions?: string;

  // Observaciones
  notes?: string;
}
