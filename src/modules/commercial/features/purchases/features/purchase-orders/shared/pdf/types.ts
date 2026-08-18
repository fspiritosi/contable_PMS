/**
 * Tipos para generación de PDFs de Órdenes de Compra
 */
import type { ThemeConfig } from '@/shared/utils/pdf-themes';

export interface PurchaseOrderPDFData {
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
    address: string;
    phone?: string;
    email?: string;
    logoDataUri?: string;
  };

  // Datos de la orden de compra
  purchaseOrder: {
    fullNumber: string;
    number: number;
    issueDate: Date;
    expectedDeliveryDate?: Date;
    status: string;
  };

  // Datos del proveedor
  supplier: {
    businessName: string;
    tradeName?: string;
    taxId: string;
    address?: string;
    phone?: string;
    email?: string;
  };

  // Líneas de ítems
  lines: Array<{
    description: string;
    productCode?: string;
    quantity: number;
    unitCost: number;
    vatRate: number;
    subtotal: number;
    total: number;
  }>;

  // Totales
  subtotal: number;
  vatAmount: number;
  total: number;

  // Condiciones
  paymentConditions?: string;
  deliveryAddress?: string;
  deliveryNotes?: string;

  // Cuotas / Entregas
  installments?: Array<{
    number: number;
    dueDate: Date;
    amount: number;
    notes?: string;
  }>;

  // Observaciones
  notes?: string;

  // Documentos vinculados (opcional)
  linkedDocuments?: import('@/modules/commercial/shared/pdf/linked-documents-types').LinkedDocumentsData;
}
