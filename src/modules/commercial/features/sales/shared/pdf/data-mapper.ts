/**
 * Mapea datos de factura del DB al formato necesario para el PDF
 */

import type { InvoicePDFData } from './types';
import { customerTaxConditionLabels } from '@/shared/utils/mappers';
import { VOUCHER_TYPE_LABELS } from '../../features/invoices/shared/validators';

// Tipo inferido de getInvoiceById
type InvoiceData = {
  id: string;
  voucherType: string;
  number: number;
  fullNumber: string;
  issueDate: Date;
  dueDate: Date | null;
  subtotal: any;
  vatAmount: any;
  otherTaxes: any;
  total: any;
  notes: string | null;
  cae: string | null;
  caeExpiryDate: Date | null;
  pointOfSale: {
    number: number;
    name: string;
  };
  customer: {
    name: string;
    taxId: string | null;
    taxCondition: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  discountTotal?: any;
  totalBeforeDiscount?: any;
  globalDiscountPercent?: any;
  globalDiscountAmount?: any;
  lines: Array<{
    quantity: any;
    unitPrice: any;
    vatRate: any;
    subtotal: any;
    vatAmount: any;
    total: any;
    description: string;
    discountPercent?: any;
    discountAmount?: any;
    product: {
      code: string;
      name: string;
      unitOfMeasure: string;
    };
  }>;
};

type CompanyData = {
  name: string;
  taxId: string | null;
  taxStatus: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};

/**
 * Mapea condición fiscal de Company a texto legible
 */
function mapCompanyTaxCondition(taxStatus: string | null): string {
  if (!taxStatus) return 'Consumidor Final';

  const mapping: Record<string, string> = {
    RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
    MONOTRIBUTO: 'Monotributista',
    EXENTO: 'Exento',
  };

  return mapping[taxStatus] || taxStatus;
}

/**
 * Extrae el tipo de factura (A, B, C) del voucherType
 */
function extractInvoiceType(voucherType: string): 'A' | 'B' | 'C' {
  if (voucherType.includes('_A')) return 'A';
  if (voucherType.includes('_B')) return 'B';
  if (voucherType.includes('_C')) return 'C';
  return 'B'; // Default
}

/**
 * Agrupa IVA por alícuota
 */
function groupVATByRate(
  lines: InvoiceData['lines']
): Array<{ rate: number; base: number; amount: number }> {
  const vatMap = new Map<number, { base: number; amount: number }>();

  for (const line of lines) {
    const rate = Number(line.vatRate);
    const subtotal = Number(line.subtotal);
    const vatAmount = Number(line.vatAmount);

    if (vatMap.has(rate)) {
      const existing = vatMap.get(rate)!;
      vatMap.set(rate, {
        base: existing.base + subtotal,
        amount: existing.amount + vatAmount,
      });
    } else {
      vatMap.set(rate, { base: subtotal, amount: vatAmount });
    }
  }

  return Array.from(vatMap.entries())
    .map(([rate, data]) => ({ rate, ...data }))
    .sort((a, b) => b.rate - a.rate);
}

/**
 * Convierte datos de invoice + company a formato para PDF
 */
export function mapInvoiceDataForPDF(
  invoice: InvoiceData,
  company: CompanyData,
  logoDataUri?: string
): InvoicePDFData {
  const invoiceType = extractInvoiceType(invoice.voucherType);
  const voucherTypeLabel =
    VOUCHER_TYPE_LABELS[invoice.voucherType as keyof typeof VOUCHER_TYPE_LABELS] ||
    invoice.voucherType;

  return {
    company: {
      name: company.name,
      taxId: company.taxId || '',
      taxCondition: mapCompanyTaxCondition(company.taxStatus),
      address: company.address || '',
      phone: company.phone || undefined,
      logoDataUri,
      email: company.email || undefined,
    },

    invoice: {
      type: invoiceType,
      voucherType: voucherTypeLabel,
      fullNumber: invoice.fullNumber,
      number: invoice.number,
      pointOfSale: invoice.pointOfSale.number,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate || undefined,
      cae: invoice.cae || undefined,
      caeExpiryDate: invoice.caeExpiryDate || undefined,
    },

    customer: {
      name: invoice.customer.name,
      taxId: invoice.customer.taxId || undefined,
      taxCondition:
        customerTaxConditionLabels[
          invoice.customer.taxCondition as keyof typeof customerTaxConditionLabels
        ] || invoice.customer.taxCondition,
      address: invoice.customer.address || undefined,
      phone: invoice.customer.phone || undefined,
      email: invoice.customer.email || undefined,
    },

    lines: invoice.lines.map((line) => ({
      code: line.product.code,
      description: line.description || line.product.name,
      quantity: Number(line.quantity),
      unitOfMeasure: line.product.unitOfMeasure,
      unitPrice: Number(line.unitPrice),
      vatRate: Number(line.vatRate),
      subtotal: Number(line.subtotal),
      vatAmount: Number(line.vatAmount),
      total: Number(line.total),
      discountPercent: line.discountPercent ? Number(line.discountPercent) : null,
      discountAmount: line.discountAmount ? Number(line.discountAmount) : null,
    })),

    totals: {
      subtotal: Number(invoice.subtotal),
      vatAmount: Number(invoice.vatAmount),
      otherTaxes: Number(invoice.otherTaxes),
      total: Number(invoice.total),
      vatByRate: invoiceType === 'A' ? groupVATByRate(invoice.lines) : undefined,
      totalBeforeDiscount: invoice.totalBeforeDiscount ? Number(invoice.totalBeforeDiscount) : undefined,
      discountTotal: invoice.discountTotal ? Number(invoice.discountTotal) : undefined,
    },

    notes: invoice.notes || undefined,
  };
}
