/**
 * Mapea datos de recibo de cobro del DB al formato necesario para el PDF
 */

import type { ReceiptPDFData } from './types';
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
      receiptItems: Array<{
        amount: any;
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
  logoDataUri?: string
): ReceiptPDFData {
  return {
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

      // Calcular total pagado de esta factura (incluye todos los cobros, no solo este recibo)
      const totalPaid = invoice.receiptItems.reduce((sum, ri) => sum + Number(ri.amount), 0);
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
