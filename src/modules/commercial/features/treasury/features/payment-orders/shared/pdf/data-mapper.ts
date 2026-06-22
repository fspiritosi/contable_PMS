/**
 * Mapea datos de orden de pago del DB al formato necesario para el PDF
 */

import type { PaymentOrderPDFData } from './types';
import { PAYMENT_METHOD_LABELS } from '@/modules/commercial/features/treasury/shared/validators';

// Tipo inferido de la query con includes
type PaymentOrderData = {
  id: string;
  number: number;
  fullNumber: string;
  date: Date;
  totalAmount: any;
  notes: string | null;
  status: string;
  supplier: {
    businessName: string;
    tradeName: string | null;
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
      paymentOrderItems: Array<{
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
 * Convierte datos de orden de pago + company a formato para PDF
 */
export function mapPaymentOrderDataForPDF(
  paymentOrder: PaymentOrderData,
  company: CompanyData,
  logoDataUri?: string
): PaymentOrderPDFData {
  return {
    company: {
      name: company.name,
      taxId: company.taxId || '',
      address: company.address || '',
      phone: company.phone || undefined,
      email: company.email || undefined,
      logoDataUri,
    },

    paymentOrder: {
      fullNumber: paymentOrder.fullNumber,
      number: paymentOrder.number,
      date: paymentOrder.date,
      status: paymentOrder.status,
    },

    supplier: {
      businessName: paymentOrder.supplier.businessName,
      tradeName: paymentOrder.supplier.tradeName || undefined,
      taxId: paymentOrder.supplier.taxId || '',
      address: paymentOrder.supplier.address || undefined,
      phone: paymentOrder.supplier.phone || undefined,
      email: paymentOrder.supplier.email || undefined,
    },

    invoices: paymentOrder.items.map((item) => {
      const invoice = item.invoice;

      // Calcular total pagado de esta factura (incluye todos los pagos, no solo esta orden)
      const totalPaid = invoice.paymentOrderItems.reduce((sum, poi) => sum + Number(poi.amount), 0);
      const total = Number(invoice.total);
      const pendingAmount = total - totalPaid;

      return {
        fullNumber: invoice.fullNumber,
        issueDate: invoice.issueDate,
        total,
        paidAmount: totalPaid,
        pendingAmount,
        amountToPay: Number(item.amount), // Monto que se paga en ESTA orden
      };
    }),

    payments: paymentOrder.payments.map((payment) => {
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

    totalAmount: Number(paymentOrder.totalAmount),
    notes: paymentOrder.notes || undefined,
  };
}
