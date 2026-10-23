import 'server-only';

import type { JournalEntryStatus, VoucherType } from '@/generated/prisma/enums';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import { PURCHASE_INVOICE_STATUS_LABELS } from '@/modules/commercial/features/purchases/features/invoices/shared/validators';
import { INVOICE_STATUS_LABELS } from '@/modules/commercial/features/sales/features/invoices/shared/validators';
import { FUND_MOVEMENT_TYPE_LABELS } from '@/modules/commercial/features/treasury/features/fund-movements/shared/validators';
import {
  BANK_MOVEMENT_TYPE_LABELS,
  CASH_MOVEMENT_TYPE_LABELS,
  CHECK_STATUS_LABELS,
  WITHHOLDING_TAX_TYPE_LABELS,
} from '@/modules/commercial/features/treasury/shared/validators';
import { formatCurrency, formatDateUtc } from '@/shared/utils/formatters';

import {
  CHECK_KEY_PREFIX,
  ENTRY_KEY_PREFIX,
  ENTRY_LINE_PREFIX,
  STATUS_CANCELLED,
  STATUS_CHECK_ENDORSED,
  STATUS_CHECK_IN_PORTFOLIO,
  STATUS_REVERSED,
  type ChainSnapshot,
  type SnapshotEntity,
} from './describe-changes';
import { paymentDetail, paymentLabel, type PaymentLabelInput } from './labels';
import { voucherShortLabel } from './registry.server';
import type { DocRef } from './types';

/**
 * Foto de los registros que toca una corrección (TSK-792, spec §7): los comprobantes
 * de la cadena, sus asientos, movimientos de banco y caja, cheques, cuotas, stock y
 * la OC, más los saldos de todos los bancos y de las sesiones de caja abiertas de la
 * empresa. Se toma antes y después de ejecutar y `describeChanges` las compara.
 *
 * Las claves son naturales y estables aunque el registro se borre y se vuelva a crear
 * (un revert + reaplicar sin cambios no produce tarjeta): comprobantes por id,
 * asientos por número, cheques por banco y número, movimientos por comprobante y
 * orden. Montos en moneda AR, fechas DD/MM/YYYY y estados en castellano.
 */

/**
 * Registros que no son de la cadena pero cambian con ella: facturas y gastos que se
 * recalculan, la OC que factura una FC, y los vinculados que se desvinculan (remitos,
 * cuotas de OC o de socio, proyecciones). Se identifican por id y siguen en la foto de después aunque el
 * comprobante que los traía se borre o los suelte.
 */
export type TrackedKind =
  | 'PURCHASE_INVOICE'
  | 'SALES_INVOICE'
  | 'EXPENSE'
  | 'DELIVERY_NOTE'
  | 'RECEIVING_NOTE'
  | 'PO_INSTALLMENT'
  | 'PARTNER_INSTALLMENT'
  | 'PROJECTION'
  | 'PURCHASE_ORDER';

interface TrackedRef {
  kind: TrackedKind;
  id: string;
  order: number;
}

/** Registros vinculados a un comprobante: si pierden el vínculo, su tarjeta es "Se desvincula". */
export const LINK_KINDS: readonly TrackedKind[] = [
  'DELIVERY_NOTE',
  'RECEIVING_NOTE',
  'PO_INSTALLMENT',
  'PARTNER_INSTALLMENT',
  'PROJECTION',
];
/** Fila con el comprobante al que está vinculado el registro ('—' si no lo está). */
export const LINK_ROW_LABEL = 'Vinculado a';

/** Lo que una foto arrastra a la siguiente para seguir viéndolo aunque se desvincule. */
export interface SnapshotScope {
  checkIds: string[];
  tracked: TrackedRef[];
}

export interface LoadedChainSnapshot extends ChainSnapshot {
  scope: SnapshotScope;
}

const money = (value: { toString(): string } | number) => formatCurrency(Number(value));
const day = (date: Date | null) => (date ? formatDateUtc(date) : '—');
const list = (items: string[]) => (items.length > 0 ? [...items].sort().join(', ') : '—');
const qty = (value: { toString(): string }) => String(Number(value));

const ENTRY_STATUS: Record<JournalEntryStatus, string> = {
  DRAFT: 'Borrador',
  POSTED: 'Registrado',
  REVERSED: STATUS_REVERSED,
};
/** OP: femenino (Anulada); RC y MF: masculino (Anulado). */
const ORDER_STATUS = { DRAFT: 'Borrador', CONFIRMED: 'Confirmada', CANCELLED: STATUS_CANCELLED };
const RECEIPT_STATUS = { DRAFT: 'Borrador', CONFIRMED: 'Confirmado', CANCELLED: STATUS_REVERSED };
const EXPENSE_STATUS = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  PARTIAL_PAID: 'Pago parcial',
  PAID: 'Pagado',
  CANCELLED: STATUS_REVERSED,
};
const DELIVERY_NOTE_STATUS = {
  PENDING_DELIVERY: 'Pendiente de entrega',
  ACCEPTED: 'Pendiente de facturar',
  INVOICED: 'Facturado',
  CANCELLED: 'Anulado',
};
const PO_INSTALLMENT_STATUS = { PENDING: 'Sin facturar', INVOICED: 'Facturada', PAID: 'Pagada' };
const PROJECTION_STATUS = { PENDING: 'Pendiente', PARTIAL: 'Parcial', CONFIRMED: 'Confirmada' };
const PO_INVOICING_STATUS = {
  NOT_INVOICED: 'Sin facturar',
  PARTIALLY_INVOICED: 'Facturada parcialmente',
  FULLY_INVOICED: 'Facturada totalmente',
};

function checkStatusLabel(status: keyof typeof CHECK_STATUS_LABELS): string {
  if (status === 'PORTFOLIO') return STATUS_CHECK_IN_PORTFOLIO;
  if (status === 'ENDORSED') return STATUS_CHECK_ENDORSED;
  return CHECK_STATUS_LABELS[status];
}

/** Bloques de `order` dentro de un comprobante de la cadena. */
const SLOT = {
  doc: 0,
  entry: 1,
  bank: 10,
  cash: 20,
  check: 30,
  installment: 40,
  stock: 50,
  purchaseOrder: 60,
  imputed: 70,
  links: 80,
} as const;
const DOC_STRIDE = 100;
const BALANCE_ORDER = 1_000_000;

class SnapshotBuilder {
  readonly entities: SnapshotEntity[] = [];
  readonly checkIds = new Set<string>();
  readonly tracked: TrackedRef[] = [];
  readonly sessionIds = new Set<string>();
  private readonly keys = new Set<string>();

  constructor(
    readonly tx: Tx,
    readonly companyId: string
  ) {}

  add(entity: SnapshotEntity): void {
    if (this.keys.has(entity.key)) return;
    this.keys.add(entity.key);
    this.entities.push(entity);
  }
}

// ============================================================================
// EFECTOS COMUNES
// ============================================================================

async function addEntry(b: SnapshotBuilder, entryId: string | null, order: number): Promise<void> {
  if (!entryId) return;
  const entry = await b.tx.journalEntry.findFirst({
    where: { id: entryId, companyId: b.companyId },
    select: {
      number: true,
      date: true,
      description: true,
      status: true,
      originalEntryId: true,
      reversalEntryId: true,
      lines: {
        select: {
          debit: true,
          credit: true,
          account: { select: { code: true, name: true } },
        },
      },
    },
  });
  if (!entry) return;

  const lines = entry.lines
    .map((line) => {
      const debit = Number(line.debit);
      const side = debit > 0 ? `Debe ${money(debit)}` : `Haber ${money(line.credit)}`;
      return `${line.account.code} ${line.account.name} · ${side}`;
    })
    .sort();
  b.add({
    key: `${ENTRY_KEY_PREFIX}${entry.number}`,
    order,
    title: `Asiento N° ${entry.number}`,
    fields: {
      Fecha: day(entry.date),
      Descripción: entry.description,
      ...Object.fromEntries(lines.map((line, i) => [`${ENTRY_LINE_PREFIX}${i + 1}`, line])),
    },
    status: ENTRY_STATUS[entry.status],
    reversal: entry.originalEntryId !== null,
  });
  await addEntry(b, entry.reversalEntryId, order + 0.5);
}

/** Movimientos bancarios de un comprobante, por orden de creación. */
async function addBankMovements(
  b: SnapshotBuilder,
  docKey: string,
  where: { paymentOrderId: string } | { receiptId: string } | { fundMovementId: string },
  order: number
): Promise<void> {
  const movements = await b.tx.bankMovement.findMany({
    where: { ...where, companyId: b.companyId },
    select: {
      type: true,
      amount: true,
      date: true,
      bankAccount: { select: { bankName: true, accountNumber: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  movements.forEach((m, i) =>
    b.add({
      key: `BANK:${docKey}:${i + 1}`,
      order: order + i * 0.01,
      title: 'Movimiento bancario',
      fields: {
        Cuenta: `${m.bankAccount.bankName} ${m.bankAccount.accountNumber}`,
        Fecha: day(m.date),
        Tipo: BANK_MOVEMENT_TYPE_LABELS[m.type],
        Importe: money(m.amount),
      },
    })
  );
}

/** Movimientos de caja de un comprobante, por orden de creación. */
async function addCashMovements(
  b: SnapshotBuilder,
  docKey: string,
  where: { paymentOrderId: string } | { receiptId: string } | { fundMovementId: string },
  order: number
): Promise<void> {
  const movements = await b.tx.cashMovement.findMany({
    where: { ...where, companyId: b.companyId },
    select: {
      type: true,
      amount: true,
      date: true,
      sessionId: true,
      cashRegister: { select: { name: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  movements.forEach((m, i) => {
    b.sessionIds.add(m.sessionId);
    b.add({
      key: `CASH:${docKey}:${i + 1}`,
      order: order + i * 0.01,
      title: 'Movimiento de caja',
      fields: {
        Caja: m.cashRegister.name,
        Fecha: day(m.date),
        Tipo: CASH_MOVEMENT_TYPE_LABELS[m.type],
        Importe: money(m.amount),
      },
    });
  });
}

async function addChecks(
  b: SnapshotBuilder,
  where:
    | { id: { in: string[] } }
    | { paymentOrderPaymentId: { in: string[] } }
    | { receiptPaymentId: { in: string[] } },
  order: number
): Promise<void> {
  const checks = await b.tx.check.findMany({
    where: { ...where, companyId: b.companyId },
    select: {
      id: true,
      type: true,
      status: true,
      bankName: true,
      checkNumber: true,
      amount: true,
      dueDate: true,
      endorsedToName: true,
    },
    orderBy: [{ bankName: 'asc' }, { checkNumber: 'asc' }],
  });
  for (const check of checks) {
    b.checkIds.add(check.id);
    b.add({
      key: `${CHECK_KEY_PREFIX}${check.bankName}:${check.checkNumber}`,
      order,
      title: `Cheque ${check.bankName} N° ${check.checkNumber}`,
      fields: {
        Tipo: check.type === 'OWN' ? 'Propio' : 'De tercero',
        Importe: money(check.amount),
        Vencimiento: day(check.dueDate),
        'Endosado a': check.endorsedToName ?? '—',
      },
      status: checkStatusLabel(check.status),
    });
  }
}

/** Stock que movió una factura (venta, o devolución de una NC), por producto y tipo. */
async function addStockMovements(
  b: SnapshotBuilder,
  docKey: string,
  referenceType: 'sales_invoice' | 'purchase_invoice',
  referenceId: string,
  order: number
): Promise<void> {
  const movements = await b.tx.stockMovement.findMany({
    where: { companyId: b.companyId, referenceType, referenceId },
    select: {
      type: true,
      quantity: true,
      productId: true,
      product: { select: { name: true } },
      warehouse: { select: { name: true } },
    },
  });
  const grouped = new Map<string, { name: string; warehouse: string; type: string; qty: number }>();
  for (const m of movements) {
    const key = `${m.productId}:${m.type}`;
    const current = grouped.get(key);
    grouped.set(key, {
      name: m.product.name,
      warehouse: m.warehouse.name,
      type: m.type === 'SALE' ? 'Venta' : 'Devolución',
      qty: (current?.qty ?? 0) + Number(m.quantity),
    });
  }
  for (const [key, m] of [...grouped].sort(([a], [c]) => a.localeCompare(c))) {
    b.add({
      key: `STOCK:${docKey}:${key}`,
      order,
      title: `Stock · ${m.name}`,
      fields: { Movimiento: m.type, Depósito: m.warehouse, Cantidad: String(m.qty) },
    });
  }
}

// ============================================================================
// COMPROBANTES
// ============================================================================

async function addPurchaseInvoice(b: SnapshotBuilder, id: string, base: number): Promise<void> {
  const invoice = await b.tx.purchaseInvoice.findFirst({
    where: { id, companyId: b.companyId },
    select: {
      voucherType: true,
      fullNumber: true,
      issueDate: true,
      status: true,
      subtotal: true,
      vatAmount: true,
      otherTaxes: true,
      total: true,
      journalEntryId: true,
      purchaseOrderId: true,
      supplier: { select: { businessName: true } },
      lines: { select: { description: true, quantity: true, unitCost: true } },
      receivingNotes: { select: { id: true } },
      purchaseOrderInstallments: { select: { id: true } },
      projectionLinks: { select: { projectionId: true } },
      creditNoteApplicationsGiven: {
        select: { amount: true, invoiceId: true, invoice: INVOICE_REF },
      },
    },
  });
  if (!invoice) return;
  const docKey = `PURCHASE_INVOICE:${id}`;
  const name = `${voucherShortLabel(invoice.voucherType, 'PURCHASE')} ${invoice.fullNumber}`;
  const lines = invoice.lines
    .map((l) => `${l.description} · ${qty(l.quantity)} × ${money(l.unitCost)}`)
    .sort();
  b.add({
    key: docKey,
    order: base + SLOT.doc,
    title: `${name} · ${invoice.supplier.businessName}`,
    fields: {
      Comprobante: name,
      Fecha: day(invoice.issueDate),
      Proveedor: invoice.supplier.businessName,
      Neto: money(invoice.subtotal),
      IVA: money(invoice.vatAmount),
      'Otros tributos': money(invoice.otherTaxes),
      Total: money(invoice.total),
      ...Object.fromEntries(lines.map((line, i) => [`Ítem ${i + 1}`, line])),
      ...applicationFields(
        invoice.creditNoteApplicationsGiven.map((a) => [purchaseName(a.invoice), a.amount])
      ),
    },
    status: PURCHASE_INVOICE_STATUS_LABELS[invoice.status],
  });
  await addTracked(b, [
    ...track(
      'PURCHASE_INVOICE',
      invoice.creditNoteApplicationsGiven.map((a) => a.invoiceId),
      base + SLOT.imputed
    ),
    ...track(
      'RECEIVING_NOTE',
      invoice.receivingNotes.map((r) => r.id),
      base + SLOT.links
    ),
    ...track(
      'PO_INSTALLMENT',
      invoice.purchaseOrderInstallments.map((c) => c.id),
      base + SLOT.links
    ),
    ...track(
      'PROJECTION',
      invoice.projectionLinks.map((p) => p.projectionId),
      base + SLOT.links
    ),
    // La OC por id: si la edición la cambia o la quita, la vieja sigue en la foto (se modifica).
    ...track('PURCHASE_ORDER', [invoice.purchaseOrderId], base + SLOT.purchaseOrder),
  ]);
  await addEntry(b, invoice.journalEntryId, base + SLOT.entry);
  await addStockMovements(b, docKey, 'purchase_invoice', id, base + SLOT.stock);
}

async function addSalesInvoice(b: SnapshotBuilder, id: string, base: number): Promise<void> {
  const invoice = await b.tx.salesInvoice.findFirst({
    where: { id, companyId: b.companyId },
    select: {
      voucherType: true,
      fullNumber: true,
      issueDate: true,
      status: true,
      subtotal: true,
      vatAmount: true,
      otherTaxes: true,
      total: true,
      journalEntryId: true,
      customer: { select: { name: true } },
      lines: { select: { description: true, quantity: true, unitPrice: true } },
      deliveryNotes: { select: { id: true } },
      projectionLinks: { select: { projectionId: true } },
      creditNoteApplicationsGiven: {
        select: { amount: true, invoiceId: true, invoice: INVOICE_REF },
      },
    },
  });
  if (!invoice) return;
  const docKey = `SALES_INVOICE:${id}`;
  const name = `${voucherShortLabel(invoice.voucherType, 'SALES')} ${invoice.fullNumber}`;
  const lines = invoice.lines
    .map((l) => `${l.description} · ${qty(l.quantity)} × ${money(l.unitPrice)}`)
    .sort();
  b.add({
    key: docKey,
    order: base + SLOT.doc,
    title: `${name} · ${invoice.customer.name}`,
    fields: {
      Comprobante: name,
      Fecha: day(invoice.issueDate),
      Cliente: invoice.customer.name,
      Neto: money(invoice.subtotal),
      IVA: money(invoice.vatAmount),
      'Otros tributos': money(invoice.otherTaxes),
      Total: money(invoice.total),
      ...Object.fromEntries(lines.map((line, i) => [`Ítem ${i + 1}`, line])),
      ...applicationFields(
        invoice.creditNoteApplicationsGiven.map((a) => [salesName(a.invoice), a.amount])
      ),
    },
    status: INVOICE_STATUS_LABELS[invoice.status],
  });
  await addTracked(b, [
    ...track(
      'SALES_INVOICE',
      invoice.creditNoteApplicationsGiven.map((a) => a.invoiceId),
      base + SLOT.imputed
    ),
    ...track(
      'DELIVERY_NOTE',
      invoice.deliveryNotes.map((r) => r.id),
      base + SLOT.links
    ),
    ...track(
      'PROJECTION',
      invoice.projectionLinks.map((p) => p.projectionId),
      base + SLOT.links
    ),
  ]);
  await addEntry(b, invoice.journalEntryId, base + SLOT.entry);
  await addStockMovements(b, docKey, 'sales_invoice', id, base + SLOT.stock);
}

// ============================================================================
// REGISTROS SEGUIDOS (recalculados o desvinculados)
// ============================================================================

interface TrackedRow {
  id: string;
  title: string;
  fields: Record<string, string>;
  status?: string;
}

const purchaseName = (inv: { voucherType: VoucherType; fullNumber: string }) =>
  `${voucherShortLabel(inv.voucherType, 'PURCHASE')} ${inv.fullNumber}`;
const salesName = (inv: { voucherType: VoucherType; fullNumber: string }) =>
  `${voucherShortLabel(inv.voucherType, 'SALES')} ${inv.fullNumber}`;
const INVOICE_REF = { select: { voucherType: true, fullNumber: true } } as const;

type TrackedLoader = (b: SnapshotBuilder, ids: string[]) => Promise<TrackedRow[]>;

const TRACKED_LOADERS: Record<TrackedKind, TrackedLoader> = {
  // Facturas y gastos: solo su estado, que se recalcula.
  PURCHASE_INVOICE: async (b, ids) =>
    (
      await b.tx.purchaseInvoice.findMany({
        where: { id: { in: ids }, companyId: b.companyId },
        select: {
          id: true,
          voucherType: true,
          fullNumber: true,
          status: true,
          supplier: { select: { businessName: true } },
        },
        orderBy: { id: 'asc' },
      })
    ).map((inv) => ({
      id: inv.id,
      title: `${purchaseName(inv)} · ${inv.supplier.businessName}`,
      fields: {},
      status: PURCHASE_INVOICE_STATUS_LABELS[inv.status],
    })),
  SALES_INVOICE: async (b, ids) =>
    (
      await b.tx.salesInvoice.findMany({
        where: { id: { in: ids }, companyId: b.companyId },
        select: {
          id: true,
          voucherType: true,
          fullNumber: true,
          status: true,
          customer: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
      })
    ).map((inv) => ({
      id: inv.id,
      title: `${salesName(inv)} · ${inv.customer.name}`,
      fields: {},
      status: INVOICE_STATUS_LABELS[inv.status],
    })),
  EXPENSE: async (b, ids) =>
    (
      await b.tx.expense.findMany({
        where: { id: { in: ids }, companyId: b.companyId },
        select: { id: true, fullNumber: true, description: true, status: true },
        orderBy: { id: 'asc' },
      })
    ).map((expense) => ({
      id: expense.id,
      title: `Gasto ${expense.fullNumber} · ${expense.description}`,
      fields: {},
      status: EXPENSE_STATUS[expense.status],
    })),
  // Vinculados: el comprobante al que apuntan y su estado.
  DELIVERY_NOTE: async (b, ids) =>
    (
      await b.tx.deliveryNote.findMany({
        where: { id: { in: ids }, companyId: b.companyId },
        select: { id: true, fullNumber: true, status: true, salesInvoice: INVOICE_REF },
        orderBy: { id: 'asc' },
      })
    ).map((note) => ({
      id: note.id,
      title: `Remito de entrega ${note.fullNumber}`,
      fields: { [LINK_ROW_LABEL]: note.salesInvoice ? salesName(note.salesInvoice) : '—' },
      status: DELIVERY_NOTE_STATUS[note.status],
    })),
  RECEIVING_NOTE: async (b, ids) =>
    (
      await b.tx.receivingNote.findMany({
        where: { id: { in: ids }, companyId: b.companyId },
        select: { id: true, fullNumber: true, purchaseInvoice: INVOICE_REF },
        orderBy: { id: 'asc' },
      })
    ).map((note) => ({
      id: note.id,
      title: `Remito de recepción ${note.fullNumber}`,
      fields: {
        [LINK_ROW_LABEL]: note.purchaseInvoice ? purchaseName(note.purchaseInvoice) : '—',
      },
    })),
  PO_INSTALLMENT: async (b, ids) =>
    (
      await b.tx.purchaseOrderInstallment.findMany({
        where: { id: { in: ids }, companyId: b.companyId },
        select: {
          id: true,
          number: true,
          amount: true,
          status: true,
          order: { select: { fullNumber: true } },
          purchaseInvoice: INVOICE_REF,
        },
        orderBy: { id: 'asc' },
      })
    ).map((inst) => ({
      id: inst.id,
      title: `Cuota ${inst.number} de la ${inst.order.fullNumber}`,
      fields: {
        Importe: money(inst.amount),
        [LINK_ROW_LABEL]: inst.purchaseInvoice ? purchaseName(inst.purchaseInvoice) : '—',
      },
      status: PO_INSTALLMENT_STATUS[inst.status],
    })),
  PARTNER_INSTALLMENT: async (b, ids) =>
    (
      await b.tx.paymentOrderInstallment.findMany({
        where: { id: { in: ids }, companyId: b.companyId },
        select: {
          id: true,
          number: true,
          amount: true,
          dueDate: true,
          status: true,
          paymentOrder: { select: { fullNumber: true } },
          settledBy: { select: { fullNumber: true } },
          partner: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
      })
    ).map((inst) => ({
      id: inst.id,
      title: `Cuota ${inst.number} de la ${inst.paymentOrder.fullNumber} · ${inst.partner?.name ?? 'socio'}`,
      fields: {
        Vencimiento: day(inst.dueDate),
        Importe: money(inst.amount),
        [LINK_ROW_LABEL]: inst.settledBy?.fullNumber ?? '—',
      },
      status: inst.status === 'PAID' ? 'Pagada' : 'Pendiente',
    })),
  PROJECTION: async (b, ids) =>
    (
      await b.tx.cashflowProjection.findMany({
        where: { id: { in: ids }, companyId: b.companyId },
        select: {
          id: true,
          description: true,
          amount: true,
          confirmedAmount: true,
          status: true,
          documentLinks: {
            select: {
              salesInvoice: INVOICE_REF,
              purchaseInvoice: INVOICE_REF,
              expense: { select: { fullNumber: true } },
              purchaseOrder: { select: { fullNumber: true } },
            },
          },
        },
        orderBy: { id: 'asc' },
      })
    ).map((projection) => ({
      id: projection.id,
      title: `Proyección · ${projection.description}`,
      fields: {
        Importe: money(projection.amount),
        Confirmado: money(projection.confirmedAmount),
        [LINK_ROW_LABEL]: list(
          projection.documentLinks.map((link) =>
            link.salesInvoice
              ? salesName(link.salesInvoice)
              : link.purchaseInvoice
                ? purchaseName(link.purchaseInvoice)
                : link.expense
                  ? `Gasto ${link.expense.fullNumber}`
                  : `OC ${link.purchaseOrder?.fullNumber ?? ''}`
          )
        ),
      },
      status: PROJECTION_STATUS[projection.status],
    })),
  PURCHASE_ORDER: async (b, ids) =>
    (
      await b.tx.purchaseOrder.findMany({
        where: { id: { in: ids }, companyId: b.companyId },
        select: {
          id: true,
          fullNumber: true,
          invoicingStatus: true,
          lines: { select: { description: true, quantity: true, invoicedQty: true } },
        },
        orderBy: { id: 'asc' },
      })
    ).map((order) => ({
      id: order.id,
      title: `Orden de compra ${order.fullNumber}`,
      fields: {
        'Estado de facturación': PO_INVOICING_STATUS[order.invoicingStatus],
        ...Object.fromEntries(
          order.lines
            .map((l) => `${l.description}: ${qty(l.invoicedQty)} de ${qty(l.quantity)}`)
            .sort()
            .map((line, i) => [`Facturado ítem ${i + 1}`, line])
        ),
      },
    })),
};

/** Agrega los registros seguidos; quedan en el `scope` de la foto para la siguiente. */
async function addTracked(b: SnapshotBuilder, refs: TrackedRef[]): Promise<void> {
  const kinds = [...new Set(refs.map((r) => r.kind))];
  for (const kind of kinds) {
    const ofKind = refs.filter((r) => r.kind === kind);
    const rows = await TRACKED_LOADERS[kind](b, [...new Set(ofKind.map((r) => r.id))]);
    for (const row of rows) {
      const order = ofKind.find((r) => r.id === row.id)?.order ?? 0;
      b.tracked.push({ kind, id: row.id, order });
      b.add({ key: `${kind}:${row.id}`, order, ...row });
    }
  }
}

const track = (kind: TrackedKind, ids: (string | null)[], order: number): TrackedRef[] =>
  ids.filter((id): id is string => Boolean(id)).map((id) => ({ kind, id, order }));

/** "Medio 1" → "Transferencia · Banco Nación · $ 800.000,00", en orden estable. */
function paymentFields(payments: PaymentLabelInput[]) {
  const labels = payments.map(paymentLabel).sort();
  return Object.fromEntries(labels.map((label, i) => [`Medio ${i + 1}`, label]));
}

/** "Aplicación FC A 0001-…" → importe que una NC compensa de esa factura. */
function applicationFields(applications: [string, { toString(): string }][]) {
  return Object.fromEntries(
    applications
      .map(([name, amount]) => [`Aplicación ${name}`, money(amount)])
      .sort(([a], [c]) => a.localeCompare(c))
  );
}

function withholdingFields(
  withholdings: {
    taxType: keyof typeof WITHHOLDING_TAX_TYPE_LABELS;
    amount: { toString(): string };
  }[]
) {
  const labels = withholdings
    .map((w) => `${WITHHOLDING_TAX_TYPE_LABELS[w.taxType]} · ${money(w.amount)}`)
    .sort();
  return Object.fromEntries(labels.map((label, i) => [`Retención ${i + 1}`, label]));
}

async function addPaymentOrder(b: SnapshotBuilder, id: string, base: number): Promise<void> {
  const order = await b.tx.paymentOrder.findFirst({
    where: { id, companyId: b.companyId },
    select: {
      fullNumber: true,
      date: true,
      status: true,
      totalAmount: true,
      journalEntryId: true,
      supplier: { select: { businessName: true } },
      partner: { select: { name: true } },
      items: {
        select: {
          amount: true,
          invoiceId: true,
          expenseId: true,
          invoice: { select: { voucherType: true, fullNumber: true } },
          expense: { select: { fullNumber: true } },
        },
      },
      payments: {
        select: {
          id: true,
          paymentMethod: true,
          amount: true,
          checkNumber: true,
          endorsedCheckId: true,
          installmentsCount: true,
          bankAccount: { select: { bankName: true } },
          cashRegister: { select: { name: true } },
          card: { select: { name: true } },
        },
      },
      withholdings: { select: { taxType: true, amount: true } },
    },
  });
  if (!order) return;
  const docKey = `PAYMENT_ORDER:${id}`;
  const party = order.supplier?.businessName ?? order.partner?.name ?? '—';
  const imputations = order.items
    .map((item) => [
      item.invoice
        ? `Imputación ${voucherShortLabel(item.invoice.voucherType, 'PURCHASE')} ${item.invoice.fullNumber}`
        : `Imputación gasto ${item.expense?.fullNumber ?? ''}`,
      money(item.amount),
    ])
    .sort(([a], [c]) => a.localeCompare(c));

  b.add({
    key: docKey,
    order: base + SLOT.doc,
    title: `${order.fullNumber} · ${party}`,
    fields: {
      Fecha: day(order.date),
      [order.partner ? 'Socio' : 'Proveedor']: party,
      Total: money(order.totalAmount),
      ...Object.fromEntries(imputations),
      ...paymentFields(order.payments.map((p) => ({ ...p, detail: paymentDetail(p) }))),
      ...withholdingFields(order.withholdings),
    },
    status: ORDER_STATUS[order.status],
  });
  await addEntry(b, order.journalEntryId, base + SLOT.entry);
  await addBankMovements(b, docKey, { paymentOrderId: id }, base + SLOT.bank);
  await addCashMovements(b, docKey, { paymentOrderId: id }, base + SLOT.cash);
  await addChecks(
    b,
    { paymentOrderPaymentId: { in: order.payments.map((p) => p.id) } },
    base + SLOT.check
  );
  const endorsedIds = order.payments.map((p) => p.endorsedCheckId).filter((x): x is string => !!x);
  await addChecks(b, { id: { in: endorsedIds } }, base + SLOT.check);

  const installments = await b.tx.paymentOrderInstallment.findMany({
    where: { paymentOrderId: id, companyId: b.companyId },
    select: {
      number: true,
      dueDate: true,
      amount: true,
      status: true,
      card: { select: { name: true } },
    },
    orderBy: [{ cardId: 'asc' }, { number: 'asc' }],
  });
  for (const inst of installments) {
    b.add({
      key: `INSTALLMENT:${docKey}:${inst.card?.name ?? ''}:${inst.number}`,
      order: base + SLOT.installment,
      title: `Cuota ${inst.number} · ${inst.card?.name ?? 'tarjeta'}`,
      fields: { Vencimiento: day(inst.dueDate), Importe: money(inst.amount) },
      status: inst.status === 'PAID' ? 'Pagada' : 'Pendiente',
    });
  }
  const settled = await b.tx.paymentOrderInstallment.findMany({
    where: { settledByPaymentOrderId: id, companyId: b.companyId },
    select: { id: true },
  });
  await addTracked(b, [
    ...track(
      'PURCHASE_INVOICE',
      order.items.map((i) => i.invoiceId),
      base + SLOT.imputed
    ),
    ...track(
      'EXPENSE',
      order.items.map((i) => i.expenseId),
      base + SLOT.imputed
    ),
    ...track(
      'PARTNER_INSTALLMENT',
      settled.map((i) => i.id),
      base + SLOT.links
    ),
  ]);
}

async function addReceipt(b: SnapshotBuilder, id: string, base: number): Promise<void> {
  const receipt = await b.tx.receipt.findFirst({
    where: { id, companyId: b.companyId },
    select: {
      fullNumber: true,
      date: true,
      status: true,
      totalAmount: true,
      journalEntryId: true,
      customer: { select: { name: true } },
      items: {
        select: {
          amount: true,
          invoiceId: true,
          invoice: { select: { voucherType: true, fullNumber: true } },
        },
      },
      payments: {
        select: {
          id: true,
          paymentMethod: true,
          amount: true,
          checkNumber: true,
          bankAccount: { select: { bankName: true } },
          cashRegister: { select: { name: true } },
        },
      },
      withholdings: { select: { taxType: true, amount: true } },
    },
  });
  if (!receipt) return;
  const docKey = `RECEIPT:${id}`;
  const imputations = receipt.items
    .map((item) => [
      `Imputación ${voucherShortLabel(item.invoice.voucherType, 'SALES')} ${item.invoice.fullNumber}`,
      money(item.amount),
    ])
    .sort(([a], [c]) => a.localeCompare(c));

  b.add({
    key: docKey,
    order: base + SLOT.doc,
    title: `${receipt.fullNumber} · ${receipt.customer.name}`,
    fields: {
      Fecha: day(receipt.date),
      Cliente: receipt.customer.name,
      Total: money(receipt.totalAmount),
      ...Object.fromEntries(imputations),
      ...paymentFields(receipt.payments.map((p) => ({ ...p, detail: paymentDetail(p) }))),
      ...withholdingFields(receipt.withholdings),
    },
    status: RECEIPT_STATUS[receipt.status],
  });
  await addEntry(b, receipt.journalEntryId, base + SLOT.entry);
  await addBankMovements(b, docKey, { receiptId: id }, base + SLOT.bank);
  await addCashMovements(b, docKey, { receiptId: id }, base + SLOT.cash);
  await addChecks(
    b,
    { receiptPaymentId: { in: receipt.payments.map((p) => p.id) } },
    base + SLOT.check
  );
  await addTracked(
    b,
    track(
      'SALES_INVOICE',
      receipt.items.map((i) => i.invoiceId),
      base + SLOT.imputed
    )
  );
}

async function addFundMovement(b: SnapshotBuilder, id: string, base: number): Promise<void> {
  const movement = await b.tx.fundMovement.findFirst({
    where: { id, companyId: b.companyId },
    select: {
      date: true,
      type: true,
      status: true,
      amount: true,
      description: true,
      fundOutLabel: true,
      fundInLabel: true,
      partnerName: true,
      conceptName: true,
      journalEntryId: true,
      lines: {
        select: { conceptName: true, description: true, amount: true },
        orderBy: { position: 'asc' },
      },
    },
  });
  if (!movement) return;
  const docKey = `FUND_MOVEMENT:${id}`;
  b.add({
    key: docKey,
    order: base + SLOT.doc,
    title: `Movimiento de fondos · ${movement.description}`,
    fields: {
      Fecha: day(movement.date),
      Tipo: FUND_MOVEMENT_TYPE_LABELS[movement.type],
      Descripción: movement.description,
      Importe: money(movement.amount),
      'Sale de': movement.fundOutLabel ?? '—',
      'Entra a': movement.fundInLabel ?? '—',
      Socio: movement.partnerName ?? '—',
      Concepto: movement.conceptName ?? '—',
      ...Object.fromEntries(
        movement.lines.map((l, i) => [
          `Gasto ${i + 1}`,
          [l.conceptName, l.description || null, money(l.amount)].filter(Boolean).join(' · '),
        ])
      ),
    },
    status: RECEIPT_STATUS[movement.status],
  });
  await addEntry(b, movement.journalEntryId, base + SLOT.entry);
  await addBankMovements(b, docKey, { fundMovementId: id }, base + SLOT.bank);
  await addCashMovements(b, docKey, { fundMovementId: id }, base + SLOT.cash);
}

// ============================================================================
// SALDOS
// ============================================================================

/** Saldo de todos los bancos y de las sesiones de caja abiertas o tocadas por la cadena. */
async function addBalances(b: SnapshotBuilder): Promise<void> {
  const banks = await b.tx.bankAccount.findMany({
    where: { companyId: b.companyId },
    select: { id: true, bankName: true, accountNumber: true, balance: true },
    orderBy: [{ bankName: 'asc' }, { accountNumber: 'asc' }],
  });
  banks.forEach((bank, i) =>
    b.add({
      key: `BANK_ACCOUNT:${bank.id}`,
      order: BALANCE_ORDER + i,
      title: `${bank.bankName} ${bank.accountNumber}`,
      fields: { Saldo: money(bank.balance) },
    })
  );

  const sessions = await b.tx.cashRegisterSession.findMany({
    where: {
      companyId: b.companyId,
      OR: [{ status: 'OPEN' }, { id: { in: [...b.sessionIds] } }],
    },
    select: {
      id: true,
      sessionNumber: true,
      expectedBalance: true,
      cashRegister: { select: { name: true } },
    },
    orderBy: [{ cashRegister: { name: 'asc' } }, { sessionNumber: 'asc' }],
  });
  sessions.forEach((session, i) =>
    b.add({
      key: `CASH_SESSION:${session.id}`,
      order: BALANCE_ORDER + 1000 + i,
      title: `Caja ${session.cashRegister.name} · sesión ${session.sessionNumber}`,
      fields: { 'Saldo esperado': money(session.expectedBalance) },
    })
  );
}

// ============================================================================
// FOTO
// ============================================================================

const LOADERS = {
  PURCHASE_INVOICE: addPurchaseInvoice,
  SALES_INVOICE: addSalesInvoice,
  PAYMENT_ORDER: addPaymentOrder,
  RECEIPT: addReceipt,
  FUND_MOVEMENT: addFundMovement,
} as const;

/**
 * Foto de los comprobantes `refs` (en el orden de la cadena: el origen primero) y de
 * lo que mueven. `scope` trae los cheques y los registros seguidos que ya estaban en la
 * foto anterior, para seguirlos aunque la corrección los desvincule (un endosado que
 * vuelve a cartera, la factura de una OP que se elimina, un remito que se suelta).
 */
export async function loadChainSnapshotTx(
  tx: Tx,
  companyId: string,
  refs: readonly DocRef[],
  scope: SnapshotScope = { checkIds: [], tracked: [] }
): Promise<LoadedChainSnapshot> {
  const b = new SnapshotBuilder(tx, companyId);
  for (const [index, ref] of refs.entries()) {
    await LOADERS[ref.kind](b, ref.id, index * DOC_STRIDE);
  }
  const pending = scope.checkIds.filter((id) => !b.checkIds.has(id));
  if (pending.length > 0) {
    await addChecks(b, { id: { in: pending } }, SLOT.check);
  }
  const trackedKeys = new Set(b.tracked.map((r) => `${r.kind}:${r.id}`));
  const missing = scope.tracked.filter((r) => !trackedKeys.has(`${r.kind}:${r.id}`));
  if (missing.length > 0) await addTracked(b, missing);
  await addBalances(b);
  return { entities: b.entities, scope: { checkIds: [...b.checkIds], tracked: b.tracked } };
}
