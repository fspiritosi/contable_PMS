/**
 * Vínculo asiento ↔ documento (TSK-760, Fase 10, diseño §3.3.7, B10/D6).
 *
 * Un asiento "pertenece" a un documento si lo referencia alguna de las 8 tablas con
 * `journal_entry_id` (§1.2.5) o si es la refundición/apertura de un ejercicio. Esos
 * asientos no se anulan ni se eliminan desde Asientos: se corrigen desde su documento
 * (o no se tocan, en el caso del cierre anual).
 *
 * `FundMovement.journalEntryId` es una columna **sin relación** Prisma: se consulta
 * aparte. Sin `'use server'` (H7): lo usan solo las actions.
 */
import 'server-only';

import type { Prisma } from '@/generated/prisma/client';

import type { Tx } from './journal-entry-types';

export type EntryDocumentKind =
  | 'SALES_INVOICE'
  | 'PURCHASE_INVOICE'
  | 'RECEIPT'
  | 'PAYMENT_ORDER'
  | 'EXPENSE'
  | 'FUND_MOVEMENT'
  | 'DEPRECIATION'
  | 'VALUE_ADJUSTMENT'
  | 'FISCAL_YEAR_CLOSING'
  | 'FISCAL_YEAR_OPENING';

export interface EntryDocumentLink {
  kind: EntryDocumentKind;
  documentId: string;
  /** Nombre del documento en minúscula, con artículo: "la factura de compra 0001-00000345". */
  label: string;
}

type VehicleRef = { internNumber: string | null; domain: string | null } | null;

const vehicleLabel = (vehicle: VehicleRef) => vehicle?.internNumber || vehicle?.domain || 's/n';

/**
 * Documento al que pertenece el asiento, o `null` si no tiene vínculo persistido
 * (manuales, recurrentes, IVA, cambio, inflación, apertura manual, bancos,
 * transferencias y baja de equipo). Un `findFirst` con las relaciones inversas y un
 * `fundMovement.findFirst` por la columna sin relación.
 */
export async function getEntryDocumentLink(
  tx: Tx,
  companyId: string,
  entryId: string
): Promise<EntryDocumentLink | null> {
  const entry = await tx.journalEntry.findFirst({
    where: { id: entryId, companyId },
    select: {
      salesInvoices: { select: { id: true, fullNumber: true }, take: 1 },
      purchaseInvoices: { select: { id: true, fullNumber: true }, take: 1 },
      receipts: { select: { id: true, fullNumber: true }, take: 1 },
      paymentOrders: { select: { id: true, fullNumber: true }, take: 1 },
      expenses: { select: { id: true, fullNumber: true }, take: 1 },
      depreciationEntries: {
        select: {
          id: true,
          periodNumber: true,
          depreciation: { select: { vehicle: { select: { internNumber: true, domain: true } } } },
        },
        take: 1,
      },
      valueAdjustments: {
        select: { id: true, vehicle: { select: { internNumber: true, domain: true } } },
        take: 1,
      },
      fiscalYearAsClosingEntry: { select: { id: true, number: true } },
      fiscalYearAsOpeningEntry: { select: { id: true, number: true } },
    },
  });
  if (!entry) return null;

  const [sale] = entry.salesInvoices;
  if (sale) return { kind: 'SALES_INVOICE', documentId: sale.id, label: `la factura de venta ${sale.fullNumber}` };
  const [purchase] = entry.purchaseInvoices;
  if (purchase) {
    return { kind: 'PURCHASE_INVOICE', documentId: purchase.id, label: `la factura de compra ${purchase.fullNumber}` };
  }
  const [receipt] = entry.receipts;
  if (receipt) return { kind: 'RECEIPT', documentId: receipt.id, label: `el recibo ${receipt.fullNumber}` };
  const [order] = entry.paymentOrders;
  if (order) return { kind: 'PAYMENT_ORDER', documentId: order.id, label: `la orden de pago ${order.fullNumber}` };
  const [expense] = entry.expenses;
  if (expense) return { kind: 'EXPENSE', documentId: expense.id, label: `el egreso ${expense.fullNumber}` };
  const [depreciation] = entry.depreciationEntries;
  if (depreciation) {
    return {
      kind: 'DEPRECIATION',
      documentId: depreciation.id,
      label:
        `la depreciación del período ${depreciation.periodNumber} del equipo ` +
        vehicleLabel(depreciation.depreciation.vehicle),
    };
  }
  const [adjustment] = entry.valueAdjustments;
  if (adjustment) {
    return {
      kind: 'VALUE_ADJUSTMENT',
      documentId: adjustment.id,
      label: `el ajuste de valor del equipo ${vehicleLabel(adjustment.vehicle)}`,
    };
  }
  const closing = entry.fiscalYearAsClosingEntry;
  if (closing) {
    return { kind: 'FISCAL_YEAR_CLOSING', documentId: closing.id, label: `la refundición del ejercicio N° ${closing.number}` };
  }
  const opening = entry.fiscalYearAsOpeningEntry;
  if (opening) {
    return { kind: 'FISCAL_YEAR_OPENING', documentId: opening.id, label: `la apertura del ejercicio N° ${opening.number}` };
  }

  const fund = await tx.fundMovement.findFirst({
    where: { companyId, journalEntryId: entryId },
    select: { id: true, description: true },
  });
  if (fund) {
    return { kind: 'FUND_MOVEMENT', documentId: fund.id, label: `el movimiento de fondos "${fund.description}"` };
  }
  return null;
}

/**
 * Where de "asiento sin documento" (reporte de asientos sin respaldo): ninguna de las
 * 7 relaciones inversas, ni refundición/apertura, ni referenciado por un movimiento de
 * fondos de la empresa.
 */
export async function entriesWithoutDocumentWhere(
  tx: Tx,
  companyId: string
): Promise<Prisma.JournalEntryWhereInput> {
  const funds = await tx.fundMovement.findMany({
    where: { companyId, journalEntryId: { not: null } },
    select: { journalEntryId: true },
  });
  const fundEntryIds = funds.flatMap((fund) => (fund.journalEntryId ? [fund.journalEntryId] : []));

  return {
    salesInvoices: { none: {} },
    purchaseInvoices: { none: {} },
    receipts: { none: {} },
    paymentOrders: { none: {} },
    expenses: { none: {} },
    depreciationEntries: { none: {} },
    valueAdjustments: { none: {} },
    fiscalYearAsClosingEntry: { is: null },
    fiscalYearAsOpeningEntry: { is: null },
    ...(fundEntryIds.length > 0 ? { id: { notIn: fundEntryIds } } : {}),
  };
}

/** Motivo del rechazo al anular (o eliminar) desde Asientos un asiento con documento (D6, §3.3.7). */
export function buildDocumentLinkedMessage(
  link: EntryDocumentLink,
  action: 'reverse' | 'delete' = 'reverse'
): string {
  // "pertenece a el egreso" → "pertenece al egreso".
  const belongsTo = `pertenece ${link.label.startsWith('el ') ? `al ${link.label.slice(3)}` : `a ${link.label}`}`;
  if (action === 'delete') {
    return `Este asiento ${belongsTo} y no se puede eliminar: solo se eliminan borradores manuales.`;
  }
  const isFiscalYear = link.kind === 'FISCAL_YEAR_CLOSING' || link.kind === 'FISCAL_YEAR_OPENING';
  if (isFiscalYear) return `Este asiento es ${link.label} y no se puede anular.`;
  return `Este asiento ${belongsTo} y no se puede anular desde Asientos: anulá el comprobante.`;
}
