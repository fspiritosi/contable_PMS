/**
 * Tipos para generación de PDFs de Recibos de Cobro
 */

export interface ReceiptPDFData {
  // Datos de la empresa
  company: {
    name: string;
    taxId: string;
    address: string;
    phone?: string;
    email?: string;
    logoDataUri?: string;
  };

  // Datos del recibo
  receipt: {
    fullNumber: string;
    number: number;
    date: Date;
    status: string;
  };

  // Datos del cliente
  customer: {
    name: string;
    taxId?: string;
    address?: string;
    phone?: string;
    email?: string;
  };

  // Facturas que se están cobrando
  invoices: Array<{
    fullNumber: string;
    issueDate: Date;
    total: number;
    paidAmount: number;
    pendingAmount: number;
    amountToCollect: number; // Monto que se cobra en este recibo
  }>;

  // Formas de pago recibidas
  payments: Array<{
    paymentMethod: string;
    amount: number;
    cashRegister?: {
      code: string;
      name: string;
    };
    bankAccount?: {
      bankName: string;
      accountNumber: string;
    };
    checkNumber?: string;
    cardLast4?: string;
    reference?: string;
  }>;

  // Total
  totalAmount: number;

  // Observaciones
  notes?: string;

  // Documentos vinculados opcionales
  linkedDocuments?: import('@/modules/commercial/shared/pdf/linked-documents-types').LinkedDocumentsData;
}
