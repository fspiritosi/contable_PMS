/**
 * Mapea datos de orden de compra del DB al formato necesario para el PDF
 */

import type { PurchaseOrderPDFData } from './types';

type PurchaseOrderData = {
  id: string;
  number: number;
  fullNumber: string;
  issueDate: Date;
  expectedDeliveryDate: Date | null;
  subtotal: any;
  vatAmount: any;
  total: any;
  status: string;
  paymentConditions: string | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  notes: string | null;
  supplier: {
    businessName: string;
    tradeName: string | null;
    taxId: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  lines: Array<{
    description: string;
    quantity: any;
    unitCost: any;
    vatRate: any;
    subtotal: any;
    total: any;
    product: {
      code: string;
      name: string;
    } | null;
  }>;
  installments?: Array<{
    number: number;
    dueDate: Date;
    amount: any;
    notes: string | null;
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
 * Convierte datos de orden de compra + company a formato para PDF
 */
export function mapPurchaseOrderDataForPDF(
  order: PurchaseOrderData,
  company: CompanyData,
  logoDataUri?: string
): PurchaseOrderPDFData {
  return {
    company: {
      name: company.name,
      taxId: company.taxId || '',
      address: company.address || '',
      phone: company.phone || undefined,
      email: company.email || undefined,
      logoDataUri,
    },

    purchaseOrder: {
      fullNumber: order.fullNumber,
      number: order.number,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate || undefined,
      status: order.status,
    },

    supplier: {
      businessName: order.supplier.businessName,
      tradeName: order.supplier.tradeName || undefined,
      taxId: order.supplier.taxId || '',
      address: order.supplier.address || undefined,
      phone: order.supplier.phone || undefined,
      email: order.supplier.email || undefined,
    },

    lines: order.lines.map((line) => ({
      description: line.description,
      productCode: line.product?.code || undefined,
      quantity: Number(line.quantity),
      unitCost: Number(line.unitCost),
      vatRate: Number(line.vatRate),
      subtotal: Number(line.subtotal),
      total: Number(line.total),
    })),

    subtotal: Number(order.subtotal),
    vatAmount: Number(order.vatAmount),
    total: Number(order.total),

    installments: order.installments && order.installments.length > 0
      ? order.installments.map((inst) => ({
          number: inst.number,
          dueDate: inst.dueDate,
          amount: Number(inst.amount),
          notes: inst.notes || undefined,
        }))
      : undefined,

    paymentConditions: order.paymentConditions || undefined,
    deliveryAddress: order.deliveryAddress || undefined,
    deliveryNotes: order.deliveryNotes || undefined,
    notes: order.notes || undefined,
  };
}
