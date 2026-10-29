/**
 * Vínculo asiento ↔ documento (TSK-760, Fase 10, diseño §3.3.7, B10/D6).
 *
 * Un asiento "pertenece" a un documento si lo referencia alguna de las 8 tablas con
 * `journal_entry_id` (§1.2.5) o si es la refundición/apertura de un ejercicio. Esos
 * asientos no se anulan ni se eliminan desde Asientos: se corrigen desde su documento
 * (o no se tocan, en el caso del cierre anual).
 *
 * `FundMovement.journalEntryId` e `InvestmentValuation.journalEntryId` (TSK-793) son
 * columnas **sin relación** Prisma: se consultan aparte. Sin `'use server'` (H7): lo
 * usan solo las actions.
 */
import 'server-only';

import moment from 'moment';

import type { Prisma } from '@/generated/prisma/client';
import { BusinessError } from '@/shared/lib/action-result';

import type { Tx } from './journal-entry-types';

export type EntryDocumentKind =
  | 'SALES_INVOICE'
  | 'PURCHASE_INVOICE'
  | 'RECEIPT'
  | 'PAYMENT_ORDER'
  | 'EXPENSE'
  | 'FUND_MOVEMENT'
  | 'INVESTMENT_VALUATION'
  | 'DEPRECIATION'
  | 'VALUE_ADJUSTMENT'
  | 'FISCAL_YEAR_CLOSING'
  | 'FISCAL_YEAR_OPENING';

export interface EntryDocumentLink {
  kind: EntryDocumentKind;
  documentId: string;
  /** Nombre del documento en minúscula, con artículo: "la factura de compra 0001-00000345". */
  label: string;
  /**
   * El comprobante está anulado y aun así sigue apuntando al asiento (TSK-788): las
   * anulaciones anteriores a TSK-792 y `cancelExpense` hasta TSK-788 no tocaban el
   * asiento. No hay comprobante desde donde corregirlo, así que no bloquea: se anula o
   * se elimina desde Asientos.
   */
  cancelled: boolean;
}

type VehicleRef = { internNumber: string | null; domain: string | null } | null;

const vehicleLabel = (vehicle: VehicleRef) => vehicle?.internNumber || vehicle?.domain || 's/n';

/**
 * Documento al que pertenece el asiento, o `null` si no tiene vínculo persistido
 * (manuales, recurrentes, IVA, cambio, inflación, apertura manual, bancos,
 * transferencias y baja de equipo). Un `findFirst` con las relaciones inversas y un
 * `findFirst` por cada columna sin relación (movimiento de fondos y valuación de
 * inversiones).
 */
export async function getEntryDocumentLink(
  tx: Tx,
  companyId: string,
  entryId: string
): Promise<EntryDocumentLink | null> {
  const entry = await tx.journalEntry.findFirst({
    where: { id: entryId, companyId },
    select: {
      salesInvoices: { select: { id: true, fullNumber: true, status: true }, take: 1 },
      purchaseInvoices: { select: { id: true, fullNumber: true, status: true }, take: 1 },
      receipts: { select: { id: true, fullNumber: true, status: true }, take: 1 },
      paymentOrders: { select: { id: true, fullNumber: true, status: true }, take: 1 },
      expenses: { select: { id: true, fullNumber: true, status: true }, take: 1 },
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

  const doc = (kind: EntryDocumentKind, document: { id: string; status: string }, label: string) => ({
    kind,
    documentId: document.id,
    label,
    cancelled: document.status === 'CANCELLED',
  });
  const [sale] = entry.salesInvoices;
  if (sale) return doc('SALES_INVOICE', sale, `la factura de venta ${sale.fullNumber}`);
  const [purchase] = entry.purchaseInvoices;
  if (purchase) return doc('PURCHASE_INVOICE', purchase, `la factura de compra ${purchase.fullNumber}`);
  const [receipt] = entry.receipts;
  if (receipt) return doc('RECEIPT', receipt, `el recibo ${receipt.fullNumber}`);
  const [order] = entry.paymentOrders;
  if (order) return doc('PAYMENT_ORDER', order, `la orden de pago ${order.fullNumber}`);
  const [expense] = entry.expenses;
  if (expense) return doc('EXPENSE', expense, `el egreso ${expense.fullNumber}`);
  const [depreciation] = entry.depreciationEntries;
  if (depreciation) {
    return {
      cancelled: false,
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
      cancelled: false,
      kind: 'VALUE_ADJUSTMENT',
      documentId: adjustment.id,
      label: `el ajuste de valor del equipo ${vehicleLabel(adjustment.vehicle)}`,
    };
  }
  const closing = entry.fiscalYearAsClosingEntry;
  if (closing) {
    return {
      cancelled: false,
      kind: 'FISCAL_YEAR_CLOSING',
      documentId: closing.id,
      label: `la refundición del ejercicio N° ${closing.number}`,
    };
  }
  const opening = entry.fiscalYearAsOpeningEntry;
  if (opening) {
    return {
      cancelled: false,
      kind: 'FISCAL_YEAR_OPENING',
      documentId: opening.id,
      label: `la apertura del ejercicio N° ${opening.number}`,
    };
  }

  const fund = await tx.fundMovement.findFirst({
    where: { companyId, journalEntryId: entryId },
    select: { id: true, description: true, status: true },
  });
  if (fund) return doc('FUND_MOVEMENT', fund, `el movimiento de fondos "${fund.description}"`);

  // Valuación de inversiones al cierre (TSK-793): se deshace desde Tesorería, que
  // borra el asiento junto con la valuación. Borrarlo o anularlo desde acá dejaría la
  // valuación sin su asiento (o sin poder deshacerse).
  const valuation = await tx.investmentValuation.findFirst({
    where: { companyId, journalEntryId: entryId },
    select: { id: true, closingDate: true },
  });
  if (valuation) {
    return {
      cancelled: false,
      kind: 'INVESTMENT_VALUATION',
      documentId: valuation.id,
      label: `la valuación de inversiones al ${moment.utc(valuation.closingDate).format('DD/MM/YYYY')}`,
    };
  }
  return null;
}

/**
 * Where de "asiento sin documento" (reporte de asientos sin respaldo): ninguna de las
 * 7 relaciones inversas, ni refundición/apertura, ni referenciado por un movimiento de
 * fondos o una valuación de inversiones de la empresa.
 */
export async function entriesWithoutDocumentWhere(
  tx: Tx,
  companyId: string
): Promise<Prisma.JournalEntryWhereInput> {
  const funds = await tx.fundMovement.findMany({
    where: { companyId, journalEntryId: { not: null } },
    select: { journalEntryId: true },
  });
  const valuations = await tx.investmentValuation.findMany({
    where: { companyId, journalEntryId: { not: null } },
    select: { journalEntryId: true },
  });
  const fundEntryIds = [...funds, ...valuations].flatMap((doc) =>
    doc.journalEntryId ? [doc.journalEntryId] : []
  );

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

// "pertenece a el egreso" → "pertenece al egreso".
const belongsTo = (link: EntryDocumentLink) =>
  `pertenece ${link.label.startsWith('el ') ? `al ${link.label.slice(3)}` : `a ${link.label}`}`;

/** Motivo del rechazo al anular (o eliminar) desde Asientos un asiento con documento (D6, §3.3.7). */
export function buildDocumentLinkedMessage(
  link: EntryDocumentLink,
  action: 'reverse' | 'delete' = 'reverse'
): string {
  const belongs = belongsTo(link);
  if (action === 'delete') {
    return `Este asiento ${belongs} y no se puede eliminar: solo se eliminan borradores manuales.`;
  }
  const isFiscalYear = link.kind === 'FISCAL_YEAR_CLOSING' || link.kind === 'FISCAL_YEAR_OPENING';
  if (isFiscalYear) return `Este asiento es ${link.label} y no se puede anular.`;
  return `Este asiento ${belongs} y no se puede anular desde Asientos: anulá el comprobante.`;
}

/** Aviso para el asiento que quedó vivo de un comprobante anulado (TSK-788). */
export function buildCancelledDocumentWarning(link: EntryDocumentLink): string {
  return `Este asiento ${belongsTo(link)}, que ya se anuló, pero el asiento quedó vivo. Anularlo deja sin efecto sus importes.`;
}

/**
 * Rechaza registrar el borrador que quedó vivo de un comprobante anulado (TSK-788): registrarlo
 * imputaría un comprobante que ya no existe. Lo usan "Registrar" en Asientos y el cierre de mes.
 */
export async function assertNotCancelledDocumentDraftTx(tx: Tx, companyId: string, entryId: string) {
  const link = await getEntryDocumentLink(tx, companyId, entryId);
  if (link?.cancelled) {
    throw new BusinessError(
      `Este asiento ${belongsTo(link)}, que ya se anuló: no se registra. Eliminalo desde Asientos.`
    );
  }
}
