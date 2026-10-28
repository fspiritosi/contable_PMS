/**
 * Mapea datos de recibo de cobro del DB al formato necesario para el PDF
 */

import type { ReceiptPDFData } from './types';
import type { PdfTemplateConfig } from '@/shared/utils/pdf-themes';
import { FALLBACK_THEME_CONFIG } from '@/shared/utils/pdf-themes';
import { PAYMENT_METHOD_LABELS } from '@/modules/commercial/features/treasury/shared/validators';

// Tipo inferido de la query con includes
type ReceiptData = {
  id: string;
  number: number;
  fullNumber: string;
  date: Date;
  totalAmount: any;
  notes: string | null;
  status: string;
  customer: {
    name: string;
    taxId: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  items: Array<{
    id: string;
    amount: any;
    invoice: {
      id: string;
      fullNumber: string;
      issueDate: Date;
      total: any;
      /** Solo imputaciones de recibos confirmados (EFFECTIVE_RECEIPT_ITEM). */
      receiptItems: Array<{
        amount: any;
      }>;
      /** Solo NC aplicadas no anuladas (EFFECTIVE_SALES_CREDIT_NOTE_APPLICATION). */
      creditNoteApplicationsReceived: Array<{
        amount: unknown;
      }>;
    };
  }>;
  payments: Array<{
    id: string;
    paymentMethod: string;
    amount: any;
    cashRegister: {
      code: string;
      name: string;
    } | null;
    bankAccount: {
      bankName: string;
      accountNumber: string;
    } | null;
    checkNumber: string | null;
    cardLast4: string | null;
    reference: string | null;
  }>;
};

type CompanyData = {
  name: string;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};

/**
 * Convierte datos de recibo + company a formato para PDF
 */
export function mapReceiptDataForPDF(
  receipt: ReceiptData,
  company: CompanyData,
  logoDataUri?: string,
  config?: PdfTemplateConfig
): ReceiptPDFData {
  return {
    themeConfig: config?.themeConfig ?? FALLBACK_THEME_CONFIG,
    headerText: config?.headerText,
    footerText: config?.footerText,
    notesDefault: config?.notesDefault,
    showIssuer: config?.showIssuer ?? true,
    showReceiver: config?.showReceiver ?? true,
    showNotes: config?.showNotes ?? true,
    showWithholdings: config?.showWithholdings ?? true,
    company: {
      name: company.name,
      taxId: company.taxId || '',
      address: company.address || '',
      phone: company.phone || undefined,
      email: company.email || undefined,
      logoDataUri,
    },

    receipt: {
      fullNumber: receipt.fullNumber,
      number: receipt.number,
      date: receipt.date,
      status: receipt.status,
    },

    customer: {
      name: receipt.customer.name,
      taxId: receipt.customer.taxId || undefined,
      address: receipt.customer.address || undefined,
      phone: receipt.customer.phone || undefined,
      email: receipt.customer.email || undefined,
    },

    invoices: receipt.items.map((item) => {
      const invoice = item.invoice;

      // Cobrado vigente de la factura (TSK-792): recibos confirmados (incluido este, si lo
      // está) más NC aplicadas no anuladas. Los recibos en borrador o anulados no cuentan.
      const totalPaid =
        invoice.receiptItems.reduce((sum, ri) => sum + Number(ri.amount), 0) +
        invoice.creditNoteApplicationsReceived.reduce((sum, app) => sum + Number(app.amount), 0);
      const total = Number(invoice.total);
      const pendingAmount = total - totalPaid;

      return {
        fullNumber: invoice.fullNumber,
        issueDate: invoice.issueDate,
        total,
        paidAmount: totalPaid,
        pendingAmount,
        amountToCollect: Number(item.amount), // Monto que se cobra en ESTE recibo
      };
    }),

    payments: receipt.payments.map((payment) => {
      const paymentMethod =
        PAYMENT_METHOD_LABELS[payment.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] ||
        payment.paymentMethod;

      return {
        paymentMethod,
        amount: Number(payment.amount),
        cashRegister: payment.cashRegister
          ? {
              code: payment.cashRegister.code,
              name: payment.cashRegister.name,
            }
          : undefined,
        bankAccount: payment.bankAccount
          ? {
              bankName: payment.bankAccount.bankName,
              accountNumber: payment.bankAccount.accountNumber,
            }
          : undefined,
        checkNumber: payment.checkNumber || undefined,
        cardLast4: payment.cardLast4 || undefined,
        reference: payment.reference || undefined,
      };
    }),

    totalAmount: Number(receipt.totalAmount),
    notes: receipt.notes || undefined,
  };
}
