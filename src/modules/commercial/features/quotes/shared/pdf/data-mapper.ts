/**
 * Mapea datos de presupuesto del DB al formato necesario para el PDF
 */

import type { QuotePDFData } from './types';

// Tipo inferido de getQuoteById
type QuoteData = {
  id: string;
  number: string;
  issueDate: Date;
  expirationDate: Date | null;
  currency: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  totalBeforeDiscount: number;
  discountTotal: number;
  globalDiscountPercent: number | null;
  globalDiscountAmount: number | null;
  notes: string | null;
  conditions: string | null;
  contractor: {
    id: string;
    name: string;
    taxId: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  } | null;
  lead: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  lines: Array<{
    quantity: number;
    unitPrice: number;
    vatRate: number;
    vatAmount: number;
    subtotal: number;
    total: number;
    description: string | null;
    discountPercent: number | null;
    discountAmount: number | null;
    product: {
      id: string;
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
 * Agrupa IVA por alícuota
 */
function groupVATByRate(
  lines: QuoteData['lines']
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
 * Convierte datos de quote + company a formato para PDF
 */
export function mapQuoteDataForPDF(
  quote: QuoteData,
  company: CompanyData,
  logoDataUri?: string
): QuotePDFData {
  // Determinar destinatario
  const isCustomer = !!quote.contractor;
  const recipientSource = quote.contractor || quote.lead;

  return {
    company: {
      name: company.name,
      taxId: company.taxId || '',
      taxCondition: mapCompanyTaxCondition(company.taxStatus),
      address: company.address || '',
      phone: company.phone || undefined,
      email: company.email || undefined,
      logoDataUri,
    },

    quote: {
      number: quote.number,
      issueDate: quote.issueDate,
      expirationDate: quote.expirationDate || undefined,
      currency: quote.currency,
    },

    recipient: {
      name: recipientSource?.name || 'Sin destinatario',
      taxId: isCustomer && quote.contractor?.taxId ? quote.contractor.taxId : undefined,
      address: isCustomer && quote.contractor?.address ? quote.contractor.address : undefined,
      phone: recipientSource?.phone || undefined,
      email: recipientSource?.email || undefined,
      type: isCustomer ? 'customer' : 'lead',
    },

    lines: quote.lines.map((line) => ({
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
      subtotal: Number(quote.subtotal),
      vatAmount: Number(quote.vatAmount),
      total: Number(quote.total),
      vatByRate: groupVATByRate(quote.lines),
      totalBeforeDiscount: quote.totalBeforeDiscount ? Number(quote.totalBeforeDiscount) : undefined,
      discountTotal: quote.discountTotal ? Number(quote.discountTotal) : undefined,
    },

    conditions: quote.conditions || undefined,
    notes: quote.notes || undefined,
  };
}
