import { Prisma } from '@/generated/prisma/client';
import {
  calculateOtherTaxes,
  parseInternalTaxes,
  toPerceptionRecords,
} from '@/modules/commercial/shared/perceptions';

import type { CreateInvoiceInput } from './types';

/**
 * Importes de una factura de venta a partir de los datos validados: líneas (con su
 * reparto por centro de costo), percepciones y cabecera. Lo usan el alta
 * (`createInvoice`) y la escritura de datos editables (`writeSalesInvoiceDataTx`).
 */

// Calcular totales de una línea
function calculateLineAmounts(
  quantity: number,
  unitPrice: number,
  vatRate: number,
  discountPercent: number | null,
  discountAmount: number | null,
): {
  baseAmount: number;
  discountValue: number;
  subtotal: number;
  vatAmount: number;
  total: number;
} {
  const baseAmount = quantity * unitPrice;

  let discountValue = 0;
  if (discountPercent != null && discountPercent > 0) {
    discountValue = baseAmount * (discountPercent / 100);
  } else if (discountAmount != null && discountAmount > 0) {
    discountValue = Math.min(discountAmount, baseAmount);
  }

  const subtotal = baseAmount - discountValue;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  return {
    baseAmount: Math.round(baseAmount * 100) / 100,
    discountValue: Math.round(discountValue * 100) / 100,
    subtotal: Math.round(subtotal * 100) / 100,
    vatAmount: Math.round(vatAmount * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

function calculateGlobalDiscount(
  sumLineSubtotals: number,
  globalDiscountPercent: number | null,
  globalDiscountAmount: number | null,
): number {
  if (globalDiscountPercent != null && globalDiscountPercent > 0) {
    return Math.round(sumLineSubtotals * (globalDiscountPercent / 100) * 100) / 100;
  }
  if (globalDiscountAmount != null && globalDiscountAmount > 0) {
    return Math.round(Math.min(globalDiscountAmount, sumLineSubtotals) * 100) / 100;
  }
  return 0;
}

function calculateInvoiceTotalsWithGlobalDiscount(
  linesData: Array<{ subtotal: number; vatRate: number }>,
  globalDiscount: number,
): { invoiceSubtotal: number; invoiceVatAmount: number } {
  const sumLineSubtotals = linesData.reduce((acc, l) => acc + l.subtotal, 0);

  if (globalDiscount <= 0 || sumLineSubtotals <= 0) {
    return {
      invoiceSubtotal: sumLineSubtotals,
      invoiceVatAmount: linesData.reduce(
        (acc, l) => acc + l.subtotal * (l.vatRate / 100),
        0,
      ),
    };
  }

  let invoiceVatAmount = 0;
  for (const line of linesData) {
    const weight = line.subtotal / sumLineSubtotals;
    const lineGlobalDiscount = globalDiscount * weight;
    const discountedBase = line.subtotal - lineGlobalDiscount;
    invoiceVatAmount += discountedBase * (line.vatRate / 100);
  }

  return {
    invoiceSubtotal: Math.round((sumLineSubtotals - globalDiscount) * 100) / 100,
    invoiceVatAmount: Math.round(invoiceVatAmount * 100) / 100,
  };
}

export function buildSalesInvoiceAmounts(data: CreateInvoiceInput) {
  let totalLineDiscounts = 0;

  const linesData = data.lines.map((line) => {
    const amounts = calculateLineAmounts(
      line.quantity,
      line.unitPrice,
      line.vatRate,
      line.discountPercent,
      line.discountAmount,
    );
    totalLineDiscounts += amounts.discountValue;

    return {
      productId: line.productId,
      description: line.description,
      quantity: new Prisma.Decimal(line.quantity),
      unitPrice: new Prisma.Decimal(line.unitPrice),
      vatRate: new Prisma.Decimal(line.vatRate),
      vatAmount: new Prisma.Decimal(amounts.vatAmount),
      subtotal: new Prisma.Decimal(amounts.subtotal),
      total: new Prisma.Decimal(amounts.total),
      discountPercent: line.discountPercent != null ? new Prisma.Decimal(line.discountPercent) : null,
      discountAmount: line.discountAmount != null ? new Prisma.Decimal(line.discountAmount) : null,
      costCenterAllocations: {
        create: (line.costCenterAllocations ?? []).map((a) => ({
          costCenterId: a.costCenterId,
          percentage: a.percentage,
        })),
      },
    };
  });

  const sumLineSubtotals = linesData.reduce((acc, l) => acc + Number(l.subtotal), 0);

  const globalDiscount = calculateGlobalDiscount(
    sumLineSubtotals,
    data.globalDiscountPercent,
    data.globalDiscountAmount,
  );

  const { invoiceSubtotal, invoiceVatAmount } = calculateInvoiceTotalsWithGlobalDiscount(
    data.lines.map((line, i) => ({
      subtotal: Number(linesData[i].subtotal),
      vatRate: line.vatRate,
    })),
    globalDiscount,
  );

  // Percepciones e impuestos internos (TSK-644). `otherTaxes` es el agregado
  // que AFIP llama "Otros Tributos" e incluye las percepciones: es el valor
  // que la emisión electrónica informa como `ImpTrib`, y debe cuadrar con la
  // suma de los tributos que se le declaran.
  const perceptionsData = toPerceptionRecords(data.perceptions ?? []);
  const internalTaxes = parseInternalTaxes(data.internalTaxes);
  const otherTaxes = calculateOtherTaxes(perceptionsData, internalTaxes);

  const invoiceTotal = invoiceSubtotal + invoiceVatAmount + otherTaxes;

  return {
    linesData,
    perceptionsData,
    amounts: {
      subtotal: new Prisma.Decimal(invoiceSubtotal),
      netTaxed: new Prisma.Decimal(invoiceSubtotal),
      netNonTaxed: new Prisma.Decimal(0),
      netExempt: new Prisma.Decimal(0),
      vatAmount: new Prisma.Decimal(invoiceVatAmount),
      internalTaxes: new Prisma.Decimal(internalTaxes),
      otherTaxes: new Prisma.Decimal(otherTaxes),
      total: new Prisma.Decimal(invoiceTotal),
      globalDiscountPercent:
        data.globalDiscountPercent != null ? new Prisma.Decimal(data.globalDiscountPercent) : null,
      globalDiscountAmount:
        data.globalDiscountAmount != null ? new Prisma.Decimal(data.globalDiscountAmount) : null,
      totalBeforeDiscount: new Prisma.Decimal(sumLineSubtotals),
      discountTotal: new Prisma.Decimal(totalLineDiscounts + globalDiscount),
    },
  };
}
