/**
 * Mapea datos de factura de compra del DB al formato necesario para el PDF
 */

import type { PurchaseInvoicePDFData } from './types';
import { VOUCHER_TYPE_LABELS } from '../validators';

type PurchaseInvoiceData = {
  voucherType: string;
  fullNumber: string;
  issueDate: Date;
  dueDate: Date | null;
  subtotal: any;
  vatAmount: any;
  otherTaxes: any;
  total: any;
  notes: string | null;
  cae: string | null;
  supplier: {
    businessName: string;
    tradeName: string | null;
    taxId: string;
    taxCondition: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  lines: Array<{
    quantity: any;
    unitCost: any;
    vatRate: any;
    subtotal: any;
    vatAmount: any;
    total: any;
    description: string;
    product: {
      code: string;
      name: string;
      unitOfMeasure: string;
    } | null;
  }>;
  purchaseOrder?: {
    fullNumber: string;
  } | null;
};

type CompanyData = {
  name: string;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};

function extractInvoiceType(voucherType: string): 'A' | 'B' | 'C' {
  if (voucherType.includes('_A')) return 'A';
  if (voucherType.includes('_B')) return 'B';
  if (voucherType.includes('_C')) return 'C';
  return 'B';
}

function mapSupplierTaxCondition(taxCondition: string | null): string {
  if (!taxCondition) return '';

  const mapping: Record<string, string> = {
    RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
    MONOTRIBUTO: 'Monotributista',
    EXENTO: 'Exento',
    CONSUMIDOR_FINAL: 'Consumidor Final',
  };

  return mapping[taxCondition] || taxCondition;
}

function groupVATByRate(
  lines: PurchaseInvoiceData['lines']
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

export function mapPurchaseInvoiceDataForPDF(
  invoice: PurchaseInvoiceData,
  company: CompanyData,
  logoDataUri?: string
): PurchaseInvoicePDFData {
  const invoiceType = extractInvoiceType(invoice.voucherType);
  const voucherTypeLabel =
    VOUCHER_TYPE_LABELS[invoice.voucherType as keyof typeof VOUCHER_TYPE_LABELS] ||
    invoice.voucherType;

  return {
    company: {
      name: company.name,
      taxId: company.taxId || '',
      address: company.address || '',
      phone: company.phone || undefined,
      email: company.email || undefined,
      logoDataUri,
    },

    invoice: {
      type: invoiceType,
      voucherType: voucherTypeLabel,
      fullNumber: invoice.fullNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate || undefined,
      cae: invoice.cae || undefined,
    },

    supplier: {
      businessName: invoice.supplier.businessName,
      tradeName: invoice.supplier.tradeName || undefined,
      taxId: invoice.supplier.taxId,
      taxCondition: mapSupplierTaxCondition(invoice.supplier.taxCondition),
      address: invoice.supplier.address || undefined,
      phone: invoice.supplier.phone || undefined,
      email: invoice.supplier.email || undefined,
    },

    lines: invoice.lines.map((line) => ({
      code: line.product?.code,
      description: line.description || line.product?.name || '',
      quantity: Number(line.quantity),
      unitOfMeasure: line.product?.unitOfMeasure || 'UN',
      unitCost: Number(line.unitCost),
      vatRate: Number(line.vatRate),
      subtotal: Number(line.subtotal),
      vatAmount: Number(line.vatAmount),
      total: Number(line.total),
    })),

    totals: {
      subtotal: Number(invoice.subtotal),
      vatAmount: Number(invoice.vatAmount),
      otherTaxes: Number(invoice.otherTaxes),
      total: Number(invoice.total),
      vatByRate: invoiceType === 'A' ? groupVATByRate(invoice.lines) : undefined,
    },

    purchaseOrder: invoice.purchaseOrder
      ? { fullNumber: invoice.purchaseOrder.fullNumber }
      : undefined,

    notes: invoice.notes || undefined,
  };
}
