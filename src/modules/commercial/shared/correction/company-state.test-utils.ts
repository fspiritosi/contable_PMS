/**
 * Foto de todo lo que una corrección en cadena puede tocar en una empresa, y el
 * invariante de la propuesta (TSK-792, spec §2 anti-objetivo: "que se modifique algo
 * que no se le mostró"): toda fila que cambia tiene su tarjeta.
 *
 * Solo para tests (no termina en `.test.ts`: Vitest no lo corre).
 */
import { prisma } from '@/shared/lib/prisma';

import type { ProposalCard } from './types';

type Row = Record<string, unknown>;

export type CompanyState = Record<string, Row[]>;

/** Foto JSON (Decimal → string, Date → ISO) de las tablas que la corrección puede tocar. */
export async function loadCompanyState(companyId: string): Promise<CompanyState> {
  const where = { companyId };
  const orderBy = { id: 'asc' as const };
  const state = {
    purchaseInvoices: await prisma.purchaseInvoice.findMany({ where, orderBy }),
    salesInvoices: await prisma.salesInvoice.findMany({ where, orderBy }),
    paymentOrders: await prisma.paymentOrder.findMany({
      where,
      orderBy,
      include: { items: { orderBy }, payments: { orderBy } },
    }),
    receipts: await prisma.receipt.findMany({
      where,
      orderBy,
      include: { items: { orderBy }, payments: { orderBy } },
    }),
    fundMovements: await prisma.fundMovement.findMany({
      where,
      orderBy,
      include: { lines: { orderBy } },
    }),
    bankAccounts: await prisma.bankAccount.findMany({ where, orderBy }),
    bankMovements: await prisma.bankMovement.findMany({ where, orderBy }),
    cashSessions: await prisma.cashRegisterSession.findMany({ where, orderBy }),
    cashMovements: await prisma.cashMovement.findMany({ where, orderBy }),
    checks: await prisma.check.findMany({ where, orderBy }),
    journalEntries: await prisma.journalEntry.findMany({
      where,
      orderBy,
      include: { lines: { orderBy } },
    }),
    accountingSettings: await prisma.accountingSettings.findMany({ where, orderBy }),
    warehouseStocks: await prisma.warehouseStock.findMany({
      where: { warehouse: { companyId } },
      orderBy,
    }),
    stockMovements: await prisma.stockMovement.findMany({ where, orderBy }),
    purchaseOrders: await prisma.purchaseOrder.findMany({
      where,
      orderBy,
      include: { lines: { orderBy } },
    }),
    purchaseOrderInstallments: await prisma.purchaseOrderInstallment.findMany({ where, orderBy }),
    paymentOrderInstallments: await prisma.paymentOrderInstallment.findMany({ where, orderBy }),
    projections: await prisma.cashflowProjection.findMany({ where, orderBy }),
    projectionLinks: await prisma.projectionDocumentLink.findMany({ where, orderBy }),
    deliveryNotes: await prisma.deliveryNote.findMany({ where, orderBy }),
    receivingNotes: await prisma.receivingNote.findMany({ where, orderBy }),
    purchaseCreditNoteApplications: await prisma.purchaseCreditNoteApplication.findMany({
      where,
      orderBy,
    }),
    salesCreditNoteApplications: await prisma.salesCreditNoteApplication.findMany({
      where,
      orderBy,
    }),
  };
  return JSON.parse(JSON.stringify(state)) as CompanyState;
}

// ============================================================================
// INVARIANTE
// ============================================================================

/**
 * Campos que cambian aunque el contenido sea el mismo: los efectos se revierten y se
 * vuelven a crear (ids y fechas de alta nuevas) y algunos sellan la hora del momento.
 */
const VOLATILE_KEYS = new Set(['id', 'createdAt', 'updatedAt', 'reconciledAt', 'appliedAt']);
const VOLATILE_BY_TABLE: Record<string, string[]> = { stockMovements: ['date'] };

function normalize(value: unknown, extra: readonly string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => JSON.stringify(normalize(v))).sort();
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Row)
        .filter(([key]) => !VOLATILE_KEYS.has(key) && !extra.includes(key))
        .map(([key, v]) => [key, normalize(v)])
    );
  }
  return value;
}

const text = (value: unknown) => String(value);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (key: string) => new RegExp(`^${escape(key)}$`);
const prefix = (key: string) => new RegExp(`^${escape(key)}`);

/** Prefijo de los movimientos de banco o caja del comprobante que los creó. */
function movementPrefix(kind: 'BANK' | 'CASH', row: Row): RegExp[] {
  if (row.paymentOrderId) return [prefix(`${kind}:PAYMENT_ORDER:${text(row.paymentOrderId)}:`)];
  if (row.receiptId) return [prefix(`${kind}:RECEIPT:${text(row.receiptId)}:`)];
  if (row.fundMovementId) return [prefix(`${kind}:FUND_MOVEMENT:${text(row.fundMovementId)}:`)];
  return [];
}

type KeyMapper = (row: Row, all: Row[]) => RegExp[];

/** Tarjeta (o tarjetas) que tiene que mostrar el cambio de una fila de cada tabla. */
const CARD_KEYS: Record<string, KeyMapper> = {
  purchaseInvoices: (row) => [exact(`PURCHASE_INVOICE:${text(row.id)}`)],
  salesInvoices: (row) => [exact(`SALES_INVOICE:${text(row.id)}`)],
  paymentOrders: (row) => [exact(`PAYMENT_ORDER:${text(row.id)}`)],
  receipts: (row) => [exact(`RECEIPT:${text(row.id)}`)],
  fundMovements: (row) => [exact(`FUND_MOVEMENT:${text(row.id)}`)],
  bankAccounts: (row) => [exact(`BANK_ACCOUNT:${text(row.id)}`)],
  bankMovements: (row) => movementPrefix('BANK', row),
  cashSessions: (row) => [exact(`CASH_SESSION:${text(row.id)}`)],
  cashMovements: (row) => movementPrefix('CASH', row),
  checks: (row) => [exact(`CHECK:${text(row.bankName)}:${text(row.checkNumber)}`)],
  journalEntries: (row) => [exact(`ENTRY:${text(row.number)}`)],
  // El contador de numeración solo cambia si se crea un asiento (el contraasiento).
  accountingSettings: () => [prefix('ENTRY:')],
  warehouseStocks: (row) => [new RegExp(`^STOCK:.*:${escape(text(row.productId))}:`)],
  stockMovements: (row) =>
    row.referenceType === 'sales_invoice'
      ? [prefix(`STOCK:SALES_INVOICE:${text(row.referenceId)}:`)]
      : row.referenceType === 'purchase_invoice'
        ? [prefix(`STOCK:PURCHASE_INVOICE:${text(row.referenceId)}:`)]
        : [],
  purchaseOrders: (row) => [exact(`PURCHASE_ORDER:${text(row.id)}`)],
  purchaseOrderInstallments: (row) => [exact(`PO_INSTALLMENT:${text(row.id)}`)],
  paymentOrderInstallments: (row) => [
    exact(`PARTNER_INSTALLMENT:${text(row.id)}`),
    prefix(`INSTALLMENT:PAYMENT_ORDER:${text(row.paymentOrderId)}:`),
  ],
  // La proyección de una cuota de tarjeta se muestra con su cuota.
  projections: (row, installments) => {
    const installment = installments.find((i) => i.id === row.paymentOrderInstallmentId);
    return installment
      ? [prefix(`INSTALLMENT:PAYMENT_ORDER:${text(installment.paymentOrderId)}:`)]
      : [exact(`PROJECTION:${text(row.id)}`)];
  },
  projectionLinks: (row) => [exact(`PROJECTION:${text(row.projectionId)}`)],
  deliveryNotes: (row) => [exact(`DELIVERY_NOTE:${text(row.id)}`)],
  receivingNotes: (row) => [exact(`RECEIVING_NOTE:${text(row.id)}`)],
  // La NC muestra sus aplicaciones ("Aplicación FC …").
  purchaseCreditNoteApplications: (row) => [exact(`PURCHASE_INVOICE:${text(row.creditNoteId)}`)],
  salesCreditNoteApplications: (row) => [exact(`SALES_INVOICE:${text(row.creditNoteId)}`)],
};

export interface UncoveredChange {
  table: string;
  change: 'added' | 'removed';
  row: Row;
}

/**
 * Filas que cambian entre las dos fotos (agregadas, quitadas o modificadas, comparando el
 * contenido sin ids ni sellos de hora) y que no tienen una tarjeta en la propuesta.
 */
export function changesWithoutCard(
  before: CompanyState,
  after: CompanyState,
  cards: readonly ProposalCard[]
): UncoveredChange[] {
  const installments = [
    ...(before.paymentOrderInstallments ?? []),
    ...(after.paymentOrderInstallments ?? []),
  ];
  const uncovered: UncoveredChange[] = [];
  for (const table of Object.keys(before)) {
    const mapper = CARD_KEYS[table];
    const extra = VOLATILE_BY_TABLE[table] ?? [];
    const sign = (row: Row) => JSON.stringify(normalize(row, extra));
    const afterSigns = (after[table] ?? []).map(sign);
    const beforeSigns = (before[table] ?? []).map(sign);
    const unmatched = (rows: Row[], signs: string[], others: string[]) => {
      const pool = [...others];
      return rows.filter((_, i) => {
        const at = pool.indexOf(signs[i]);
        if (at === -1) return true;
        pool.splice(at, 1);
        return false;
      });
    };
    const changed = [
      ...unmatched(before[table] ?? [], beforeSigns, afterSigns).map((row) => ({
        row,
        change: 'removed' as const,
      })),
      ...unmatched(after[table] ?? [], afterSigns, beforeSigns).map((row) => ({
        row,
        change: 'added' as const,
      })),
    ];
    for (const { row, change } of changed) {
      const patterns = mapper ? mapper(row, installments) : [];
      const shown = patterns.some((pattern) => cards.some((card) => pattern.test(card.key)));
      if (!shown) uncovered.push({ table, change, row });
    }
  }
  return uncovered;
}
