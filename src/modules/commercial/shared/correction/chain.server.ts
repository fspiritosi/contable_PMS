import 'server-only';

import moment from 'moment';

import {
  assertPeriodOpen,
  findMonthlyProcessEntriesTx,
  type Tx,
} from '@/modules/accounting/features/integrations/core';
import { BusinessError } from '@/shared/lib/action-result';

import type { EffectsCtx } from '../effects/types';
import {
  allocateReduction,
  planPaymentReduction,
  type Cancellation,
  type PaymentLine,
} from './allocation';
import { dedupeImpediments, impediments } from './impediments';
import { paymentDetail, paymentLabel } from './labels';
import { CORRECTION_HANDLERS, voucherShortLabel, type DocHead } from './registry.server';
import type { CorrectionRequest, DocRef, Impediment, PaymentChoice, PaymentChoices } from './types';

/**
 * Planificación de la corrección en cadena (TSK-792, spec §4): qué se edita, elimina o
 * anula en el comprobante de origen y en los que lo cancelan, y qué lo impide. No
 * escribe nada: el motor ejecuta el plan solo si no hay impedimentos.
 */

/** OP o RC que cancela la factura de origen y cambia por la corrección. */
export interface DependentChange {
  ref: DocRef;
  /** DELETE: todas sus imputaciones quedan en 0. ADJUST: baja la imputación y un medio. */
  mode: 'ADJUST' | 'DELETE';
  itemChanges: { itemId: string; after: number }[];
  payment?: { paymentId: string; after: number };
  label: string;
  journalEntryId: string | null;
  /** Tiene retenciones: la propuesta avisa que se revise el certificado. */
  hasWithholdings: boolean;
}

/** Aplicación de una NC a la factura de origen que baja o se borra (after = 0). */
export interface CreditNoteChange {
  applicationId: string;
  creditNoteId: string;
  after: number;
}

export interface CorrectionPlan {
  request: CorrectionRequest;
  /** null si el comprobante no existe en la empresa (hay un impedimento). */
  origin: DocHead | null;
  /** Datos editados, válidos según el schema de edición (solo EDIT). */
  editData: unknown;
  dependents: DependentChange[];
  creditNoteChanges: CreditNoteChange[];
  impediments: Impediment[];
  pendingChoices: PaymentChoice[];
  /** Fechas viejas y nuevas del origen y de los dependientes (períodos y procesos del mes). */
  datesToCheck: Date[];
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const toCents = (value: number) => Math.round(value * 100);
const fromCents = (cents: number) => cents / 100;

// ============================================================================
// CANCELACIONES DE UNA FACTURA
// ============================================================================

interface InvoiceChain {
  cancellations: Cancellation[];
  /** Documentos que cancelan la factura (OP/RC o NC), para los mensajes. */
  cancellingRefs: DocRef[];
}

async function loadPurchaseInvoiceChainTx(
  tx: Tx,
  companyId: string,
  invoiceId: string
): Promise<InvoiceChain> {
  const [items, applications] = await Promise.all([
    tx.paymentOrderItem.findMany({
      where: { invoiceId, paymentOrder: { companyId, status: 'CONFIRMED' } },
      select: {
        id: true,
        amount: true,
        paymentOrderId: true,
        paymentOrder: { select: { date: true, createdAt: true } },
      },
      orderBy: { id: 'asc' },
    }),
    tx.purchaseCreditNoteApplication.findMany({
      where: { invoiceId, companyId, creditNote: { status: { not: 'CANCELLED' } } },
      select: {
        id: true,
        amount: true,
        creditNoteId: true,
        appliedAt: true,
        creditNote: { select: { issueDate: true } },
      },
      orderBy: { id: 'asc' },
    }),
  ]);
  return {
    cancellations: [
      ...items.map((i) => ({
        itemId: i.id,
        documentId: i.paymentOrderId,
        source: 'PAYMENT_ORDER' as const,
        amount: Number(i.amount),
        date: i.paymentOrder.date,
        createdAt: i.paymentOrder.createdAt,
      })),
      ...applications.map((a) => ({
        itemId: a.id,
        documentId: a.creditNoteId,
        source: 'CREDIT_NOTE' as const,
        amount: Number(a.amount),
        date: a.creditNote.issueDate,
        createdAt: a.appliedAt,
      })),
    ],
    cancellingRefs: [
      ...items.map((i) => ({ kind: 'PAYMENT_ORDER' as const, id: i.paymentOrderId })),
      ...applications.map((a) => ({ kind: 'PURCHASE_INVOICE' as const, id: a.creditNoteId })),
    ],
  };
}

async function loadSalesInvoiceChainTx(
  tx: Tx,
  companyId: string,
  invoiceId: string
): Promise<InvoiceChain> {
  const [items, applications] = await Promise.all([
    tx.receiptItem.findMany({
      where: { invoiceId, receipt: { companyId, status: 'CONFIRMED' } },
      select: {
        id: true,
        amount: true,
        receiptId: true,
        receipt: { select: { date: true, createdAt: true } },
      },
      orderBy: { id: 'asc' },
    }),
    tx.salesCreditNoteApplication.findMany({
      where: { invoiceId, companyId, creditNote: { status: { not: 'CANCELLED' } } },
      select: {
        id: true,
        amount: true,
        creditNoteId: true,
        appliedAt: true,
        creditNote: { select: { issueDate: true } },
      },
      orderBy: { id: 'asc' },
    }),
  ]);
  return {
    cancellations: [
      ...items.map((i) => ({
        itemId: i.id,
        documentId: i.receiptId,
        source: 'RECEIPT' as const,
        amount: Number(i.amount),
        date: i.receipt.date,
        createdAt: i.receipt.createdAt,
      })),
      ...applications.map((a) => ({
        itemId: a.id,
        documentId: a.creditNoteId,
        source: 'CREDIT_NOTE' as const,
        amount: Number(a.amount),
        date: a.creditNote.issueDate,
        createdAt: a.appliedAt,
      })),
    ],
    cancellingRefs: [
      ...items.map((i) => ({ kind: 'RECEIPT' as const, id: i.receiptId })),
      ...applications.map((a) => ({ kind: 'SALES_INVOICE' as const, id: a.creditNoteId })),
    ],
  };
}

// ============================================================================
// OP / RC QUE CANCELAN LA FACTURA
// ============================================================================

interface SettlementDoc {
  items: { id: string; amount: number }[];
  payments: (PaymentLine & { endorsed: boolean })[];
  hasWithholdings: boolean;
}

async function loadSettlementDocTx(tx: Tx, ref: DocRef): Promise<SettlementDoc> {
  if (ref.kind === 'PAYMENT_ORDER') {
    const order = await tx.paymentOrder.findUniqueOrThrow({
      where: { id: ref.id },
      select: {
        items: { select: { id: true, amount: true } },
        payments: {
          select: {
            id: true,
            amount: true,
            paymentMethod: true,
            endorsedCheckId: true,
            checkNumber: true,
            bankAccount: { select: { bankName: true } },
            cashRegister: { select: { name: true } },
            installmentsCount: true,
            card: { select: { name: true } },
          },
          orderBy: { id: 'asc' },
        },
        _count: { select: { withholdings: true } },
      },
    });
    return {
      items: order.items.map((i) => ({ id: i.id, amount: Number(i.amount) })),
      payments: order.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        endorsed: Boolean(p.endorsedCheckId),
        label: paymentLabel({ ...p, detail: paymentDetail(p) }),
      })),
      hasWithholdings: order._count.withholdings > 0,
    };
  }
  const receipt = await tx.receipt.findUniqueOrThrow({
    where: { id: ref.id },
    select: {
      items: { select: { id: true, amount: true } },
      payments: {
        select: {
          id: true,
          amount: true,
          paymentMethod: true,
          checkNumber: true,
          bankAccount: { select: { bankName: true } },
          cashRegister: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
      },
      _count: { select: { withholdings: true } },
    },
  });
  return {
    items: receipt.items.map((i) => ({ id: i.id, amount: Number(i.amount) })),
    payments: receipt.payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      endorsed: false,
      label: paymentLabel({ ...p, detail: paymentDetail(p) }),
    })),
    hasWithholdings: receipt._count.withholdings > 0,
  };
}

interface DependentPlan {
  change: DependentChange;
  impediments: Impediment[];
  pendingChoice?: PaymentChoice;
}

/**
 * Qué le pasa a una OP/RC cuyas imputaciones bajan: si todas quedan en 0 se elimina;
 * si no, baja esas imputaciones y la reducción sale de un solo medio de pago (el
 * único, o el que eligió el usuario). Un cheque de tercero endosado no se puede
 * achicar: no es una opción.
 */
async function planDependentTx(
  tx: Tx,
  head: DocHead,
  itemAfter: Map<string, number>,
  choices: PaymentChoices
): Promise<DependentPlan> {
  const doc = await loadSettlementDocTx(tx, head.ref);
  const itemChanges = doc.items
    .filter((item) => itemAfter.has(item.id))
    .map((item) => ({ itemId: item.id, after: itemAfter.get(item.id) ?? item.amount }));
  const base: DependentChange = {
    ref: head.ref,
    mode: 'ADJUST',
    itemChanges,
    label: head.label,
    journalEntryId: head.journalEntry?.id ?? null,
    hasWithholdings: doc.hasWithholdings,
  };

  const remainingCents = doc.items.reduce(
    (sum, item) => sum + toCents(itemAfter.get(item.id) ?? item.amount),
    0
  );
  if (remainingCents === 0) {
    return { change: { ...base, mode: 'DELETE' }, impediments: [] };
  }

  const reduction = fromCents(
    itemChanges.reduce(
      (sum, c) =>
        sum + toCents(doc.items.find((i) => i.id === c.itemId)?.amount ?? 0) - toCents(c.after),
      0
    )
  );
  const reducible = doc.payments.filter((p) => !p.endorsed);
  if (reducible.length === 0) {
    return {
      change: base,
      impediments: [
        {
          ...impediments.invalidState(
            `La reducción no se puede descontar de ${head.label}: solo se pagó con cheques de terceros endosados.`
          ),
          severity: 'MANUAL',
          action: `Corregí ${head.label} a mano y reintentá.`,
        },
      ],
    };
  }

  const result = planPaymentReduction(reducible, reduction, choices[head.ref.id]);
  if (result.kind === 'OK') {
    return {
      change: { ...base, payment: { paymentId: result.paymentId, after: result.after } },
      impediments: [],
    };
  }
  if (result.kind === 'INSUFFICIENT') {
    return { change: base, impediments: [impediments.withholdingsInsufficient(head.label)] };
  }
  return {
    change: base,
    impediments: [],
    pendingChoice: {
      documentId: head.ref.id,
      documentLabel: head.label,
      options: reducible.map((p) => ({ paymentId: p.id, label: p.label })),
      selected: null,
    },
  };
}

// ============================================================================
// IMPEDIMENTOS DEL PLAN
// ============================================================================

/**
 * Notas de crédito/débito que referencian la factura (`originalInvoiceId`): no se puede
 * eliminar, porque borrarla les quitaría la referencia sin mostrarlo. Una nota vigente
 * se puede eliminar o anular primero (MANUAL); una ya anulada no se puede tocar, así
 * que la factura solo se puede anular (BLOCKED).
 */
async function referencingNotesTx(
  tx: Tx,
  companyId: string,
  origin: DocRef
): Promise<Impediment[]> {
  const where = { originalInvoiceId: origin.id, companyId };
  const select = { voucherType: true, fullNumber: true, status: true } as const;
  const notes =
    origin.kind === 'PURCHASE_INVOICE'
      ? (await tx.purchaseInvoice.findMany({ where, select, orderBy: { id: 'asc' } })).map((n) => ({
          label: `la ${voucherShortLabel(n.voucherType, 'PURCHASE')} ${n.fullNumber}`,
          cancelled: n.status === 'CANCELLED',
        }))
      : (await tx.salesInvoice.findMany({ where, select, orderBy: { id: 'asc' } })).map((n) => ({
          label: `la ${voucherShortLabel(n.voucherType, 'SALES')} ${n.fullNumber}`,
          cancelled: n.status === 'CANCELLED',
        }));
  return notes.map((note) =>
    note.cancelled
      ? {
          ...impediments.referencedByNote(note.label),
          severity: 'BLOCKED' as const,
          message: `El comprobante está referenciado por ${note.label}, que está anulada.`,
          action: 'Anulá la factura en lugar de eliminarla.',
        }
      : impediments.referencedByNote(note.label)
  );
}

/**
 * OP/RC en borrador o anuladas que imputan la factura: no forman parte de la cadena
 * (no cuentan para su estado), pero borrar la factura las dejaría apuntando a nada.
 */
async function nonConfirmedImputationsTx(tx: Tx, origin: DocHead): Promise<Impediment[]> {
  const status = { in: ['DRAFT' as const, 'CANCELLED' as const] };
  const docs =
    origin.ref.kind === 'PURCHASE_INVOICE'
      ? (
          await tx.paymentOrderItem.findMany({
            where: { invoiceId: origin.ref.id, paymentOrder: { status } },
            select: { paymentOrder: { select: { fullNumber: true, status: true } } },
          })
        ).map((i) => ({ label: `la ${i.paymentOrder.fullNumber}`, status: i.paymentOrder.status }))
      : (
          await tx.receiptItem.findMany({
            where: { invoiceId: origin.ref.id, receipt: { status } },
            select: { receipt: { select: { fullNumber: true, status: true } } },
          })
        ).map((i) => ({ label: `el recibo ${i.receipt.fullNumber}`, status: i.receipt.status }));

  return docs.map((doc) =>
    doc.status === 'DRAFT'
      ? {
          ...impediments.invalidState(
            `${capitalize(origin.label)} está imputada en ${doc.label}, que está en borrador.`
          ),
          severity: 'MANUAL' as const,
          action: `Quitala de ${doc.label} o eliminá ese borrador y reintentá.`,
        }
      : {
          ...impediments.invalidState(
            `${capitalize(origin.label)} está imputada en ${doc.label}, que está anulado: no se puede eliminar.`
          ),
          action: 'Anulala en lugar de eliminarla.',
        }
  );
}

/** Período cerrado de cualquiera de las fechas, con el mensaje del núcleo contable. */
async function closedPeriodsTx(tx: Tx, companyId: string, dates: Date[]): Promise<Impediment[]> {
  const found: Impediment[] = [];
  for (const date of dates) {
    try {
      await assertPeriodOpen(tx, companyId, date);
    } catch (error) {
      if (!(error instanceof BusinessError)) throw error;
      found.push(impediments.periodClosed(error.message));
    }
  }
  return found;
}

/** Fechas distintas por día UTC (el día de negocio de comprobantes y asientos). */
function distinctDays(dates: Date[]): Date[] {
  const byDay = new Map<string, Date>();
  for (const date of dates) byDay.set(moment.utc(date).format('YYYY-MM-DD'), date);
  return [...byDay.values()];
}

// ============================================================================
// PLAN
// ============================================================================

function emptyPlan(
  request: CorrectionRequest,
  origin: DocHead | null,
  found: Impediment[]
): CorrectionPlan {
  return {
    request,
    origin,
    editData: null,
    dependents: [],
    creditNoteChanges: [],
    impediments: found,
    pendingChoices: [],
    datesToCheck: origin ? [origin.date] : [],
  };
}

/**
 * Arma la cadena de la corrección (§4.3): para una factura, las OP/RC confirmadas y
 * las NC aplicadas que la cancelan, con la reducción repartida de la cancelación más
 * reciente a la más antigua; y todos los impedimentos (estado, asientos registrados,
 * AFIP, contraparte cambiada, notas que la referencian, efectos ya usados, períodos
 * cerrados y procesos del mes). Para OP, RC y MF la cadena es el propio comprobante:
 * las facturas que imputan solo se recalculan.
 */
export async function planCorrectionTx(
  tx: Tx,
  ctx: EffectsCtx,
  request: CorrectionRequest
): Promise<CorrectionPlan> {
  const { companyId } = ctx;
  const { ref } = request;
  const handler = CORRECTION_HANDLERS[ref.kind];

  const origin = await handler.head(tx, companyId, ref.id);
  if (!origin) {
    return emptyPlan(request, null, [impediments.invalidState('El comprobante no existe.')]);
  }
  if (!origin.correctable) {
    const message = origin.cancelled
      ? `${capitalize(origin.label)} ya está anulado.`
      : `${capitalize(origin.label)} no está confirmado: se corrige desde su edición habitual.`;
    return emptyPlan(request, origin, [impediments.invalidState(message)]);
  }

  // Datos editados
  let editData: unknown = null;
  let edited: ReturnType<typeof handler.summarizeEdit> | null = null;
  if (request.mode === 'EDIT') {
    if (origin.editBlockedReason) {
      return emptyPlan(request, origin, [impediments.invalidState(origin.editBlockedReason)]);
    }
    const parsed = handler.editSchema.safeParse(request.data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return emptyPlan(request, origin, [
        impediments.invalidState(
          `Los datos editados no son válidos: ${issue?.message ?? 'revisalos'}.`
        ),
      ]);
    }
    editData = request.data;
    edited = handler.summarizeEdit(request.data);
  }

  const found: Impediment[] = [];
  const dates: Date[] = [origin.date, ...(edited ? [edited.date] : [])];

  // Asiento del origen: Anular admite el registrado (contraasiento, §5.3).
  if (origin.journalEntry?.status === 'POSTED' && request.mode !== 'CANCEL') {
    found.push(impediments.entryPosted(origin.journalEntry.number, origin.label));
  }
  if (origin.journalEntry?.status === 'REVERSED') {
    found.push(
      impediments.invalidState(
        `El asiento N° ${origin.journalEntry.number} de ${origin.label} ya está anulado.`
      )
    );
  }
  found.push(...(await handler.effectImpediments(tx, ref.id, origin.label)));

  // Cadena de una factura
  const dependents: DependentChange[] = [];
  const creditNoteChanges: CreditNoteChange[] = [];
  const pendingChoices: PaymentChoice[] = [];
  const isInvoice = ref.kind === 'PURCHASE_INVOICE' || ref.kind === 'SALES_INVOICE';

  if (isInvoice) {
    const chain =
      ref.kind === 'PURCHASE_INVOICE'
        ? await loadPurchaseInvoiceChainTx(tx, companyId, ref.id)
        : await loadSalesInvoiceChainTx(tx, companyId, ref.id);

    const heads = new Map<string, DocHead>();
    for (const cancelling of chain.cancellingRefs) {
      if (heads.has(cancelling.id)) continue;
      const head = await CORRECTION_HANDLERS[cancelling.kind].head(tx, companyId, cancelling.id);
      if (head) heads.set(cancelling.id, head);
    }

    if (edited && edited.partyId !== origin.partyId && chain.cancellations.length > 0) {
      found.push(impediments.partyChanged([...heads.values()].map((h) => h.label)));
    }

    const cancelledCents = chain.cancellations.reduce((sum, c) => sum + toCents(c.amount), 0);
    const reductionCents =
      edited && edited.total !== null
        ? Math.max(0, cancelledCents - toCents(edited.total))
        : cancelledCents;
    const adjustments = allocateReduction(chain.cancellations, fromCents(reductionCents));

    // Notas de crédito: baja o se borra la aplicación.
    for (const adj of adjustments.filter((a) => a.source === 'CREDIT_NOTE')) {
      creditNoteChanges.push({
        applicationId: adj.itemId,
        creditNoteId: adj.documentId,
        after: adj.after,
      });
    }

    // OP/RC: se ajustan o se eliminan.
    const byDocument = new Map<string, Map<string, number>>();
    for (const adj of adjustments.filter((a) => a.source !== 'CREDIT_NOTE')) {
      const items = byDocument.get(adj.documentId) ?? new Map<string, number>();
      items.set(adj.itemId, adj.after);
      byDocument.set(adj.documentId, items);
    }
    for (const [documentId, itemAfter] of byDocument) {
      const head = heads.get(documentId);
      if (!head) continue;
      const planned = await planDependentTx(tx, head, itemAfter, request.choices ?? {});
      dependents.push(planned.change);
      found.push(...planned.impediments);
      if (planned.pendingChoice) pendingChoices.push(planned.pendingChoice);

      if (head.journalEntry?.status === 'POSTED') {
        found.push(impediments.entryPosted(head.journalEntry.number, head.label));
      }
      found.push(
        ...(await CORRECTION_HANDLERS[head.ref.kind].effectImpediments(tx, head.ref.id, head.label))
      );
      dates.push(head.date);
    }

    if (request.mode === 'DELETE') {
      found.push(...(await referencingNotesTx(tx, companyId, ref)));
      found.push(...(await nonConfirmedImputationsTx(tx, origin)));
    }
  }

  // Período y procesos del mes (fechas viejas y nuevas de todo lo que cambia)
  const datesToCheck = distinctDays(dates);
  found.push(...(await closedPeriodsTx(tx, companyId, datesToCheck)));
  const processes = await findMonthlyProcessEntriesTx(tx, companyId, datesToCheck);
  for (const entry of processes) {
    if (entry.process === 'VAT_SETTLEMENT' && !isInvoice) continue;
    found.push(impediments.monthlyProcess(entry));
  }

  return {
    request,
    origin,
    editData,
    dependents,
    creditNoteChanges,
    impediments: dedupeImpediments(found),
    pendingChoices,
    datesToCheck,
  };
}
