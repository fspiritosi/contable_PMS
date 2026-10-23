import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import {
  deleteDraftJournalEntryTx,
  reverseJournalEntryTx,
  type Tx,
} from '@/modules/accounting/features/integrations/core';
import { BusinessError } from '@/shared/lib/action-result';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';

import {
  recomputeExpenseStatusTx,
  recomputePurchaseInvoiceStatusTx,
  recomputeSalesInvoiceStatusTx,
} from '../effects/document-status.server';
import type { EffectsCtx } from '../effects/types';
import { planCorrectionTx, type CorrectionPlan, type DependentChange } from './chain.server';
import { describeChanges } from './describe-changes';
import { fingerprintProposal } from './fingerprint';
import { impediments } from './impediments';
import { CORRECTION_HANDLERS } from './registry.server';
import { LINK_KINDS, LINK_ROW_LABEL, loadChainSnapshotTx } from './snapshot.server';
import type { CorrectionProposal, CorrectionRequest, DocRef, ProposalCard } from './types';

/**
 * Motor de la corrección en cadena (TSK-792, spec §5 y §7).
 *
 * La vista previa y la aplicación hacen lo mismo dentro de una transacción:
 * planificar, sacar la foto de la cadena, ejecutar (revertir efectos, escribir datos,
 * reaplicar efectos, recalcular estados), sacar la foto de nuevo y comparar. La vista
 * previa siempre descarta la transacción (no queda rastro ni se consume numeración);
 * la aplicación solo la confirma si no hay impedimentos ni elecciones pendientes y la
 * huella coincide con la que vio el usuario.
 */

/** Descarta la transacción de la simulación: Prisma hace rollback y la relanza. */
class RollbackSignal extends Error {
  constructor() {
    super('Simulación de la corrección descartada');
    this.name = 'RollbackSignal';
  }
}

/** La cadena puede ser larga (varias OP/RC con sus efectos y asientos). */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

const WITHHOLDINGS_WARNING =
  'Tiene retenciones: no se recalculan. Revisá el certificado de retención.';

/** Por qué no se aplicó: la UI decide qué mostrar (impedimentos, elección o propuesta nueva). */
export type ApplyRejectionReason = 'STALE' | 'IMPEDIMENTS' | 'PENDING_CHOICES' | 'SIMULATION_ERROR';

export type ApplyResult =
  | { applied: true }
  | { applied: false; stale: true; reason: ApplyRejectionReason; proposal: CorrectionProposal };

/** Tabla de cada tipo, para bloquear la fila del origen (constantes: no vienen del usuario). */
const ORIGIN_TABLES: Record<DocRef['kind'], string> = {
  PURCHASE_INVOICE: 'purchase_invoices',
  SALES_INVOICE: 'sales_invoices',
  PAYMENT_ORDER: 'payment_orders',
  RECEIPT: 'receipts',
  FUND_MOVEMENT: 'fund_movements',
};

/**
 * `SELECT … FOR UPDATE` sobre la fila del comprobante de origen (R15): dos
 * correcciones del mismo comprobante se serializan, y la segunda planifica sobre lo
 * que dejó la primera (su huella ya no coincide y vuelve como STALE).
 */
async function lockOriginTx(tx: Tx, companyId: string, ref: DocRef): Promise<void> {
  const table = Prisma.raw(ORIGIN_TABLES[ref.kind]);
  await tx.$queryRaw`SELECT id FROM ${table} WHERE id = ${ref.id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
}

// ============================================================================
// FACTURAS Y GASTOS A RECALCULAR
// ============================================================================

/** Facturas y gastos cuyo estado depende de lo que cambia (antes y después de ejecutar). */
class TouchedDocuments {
  readonly purchaseInvoices = new Set<string>();
  readonly salesInvoices = new Set<string>();
  readonly expenses = new Set<string>();

  addInvoice(ref: DocRef): void {
    if (ref.kind === 'PURCHASE_INVOICE') this.purchaseInvoices.add(ref.id);
    if (ref.kind === 'SALES_INVOICE') this.salesInvoices.add(ref.id);
  }

  /** Lo que imputan hoy las OP/RC de la cadena. */
  async collectImputations(tx: Tx, refs: readonly DocRef[]): Promise<void> {
    const orderIds = refs.filter((r) => r.kind === 'PAYMENT_ORDER').map((r) => r.id);
    const receiptIds = refs.filter((r) => r.kind === 'RECEIPT').map((r) => r.id);
    const [orderItems, receiptItems] = await Promise.all([
      tx.paymentOrderItem.findMany({
        where: { paymentOrderId: { in: orderIds } },
        select: { invoiceId: true, expenseId: true },
      }),
      tx.receiptItem.findMany({
        where: { receiptId: { in: receiptIds } },
        select: { invoiceId: true },
      }),
    ]);
    for (const item of orderItems) {
      if (item.invoiceId) this.purchaseInvoices.add(item.invoiceId);
      if (item.expenseId) this.expenses.add(item.expenseId);
    }
    for (const item of receiptItems) this.salesInvoices.add(item.invoiceId);
  }

  /** Recalcula los que siguen existiendo (solo cuentan OP/RC confirmadas y NC vigentes). */
  async recompute(tx: Tx): Promise<void> {
    const [purchases, sales, expenses] = await Promise.all([
      tx.purchaseInvoice.findMany({
        where: { id: { in: [...this.purchaseInvoices] } },
        select: { id: true },
      }),
      tx.salesInvoice.findMany({
        where: { id: { in: [...this.salesInvoices] } },
        select: { id: true },
      }),
      tx.expense.findMany({ where: { id: { in: [...this.expenses] } }, select: { id: true } }),
    ]);
    for (const { id } of purchases) await recomputePurchaseInvoiceStatusTx(tx, id);
    for (const { id } of sales) await recomputeSalesInvoiceStatusTx(tx, id);
    for (const { id } of expenses) await recomputeExpenseStatusTx(tx, id);
  }
}

// ============================================================================
// EJECUCIÓN
// ============================================================================

const decimal = (value: number) => new Prisma.Decimal(value.toFixed(2));

/** Baja las imputaciones y el medio elegido de una OP/RC y recalcula su total. */
async function adjustSettlementTx(tx: Tx, dep: DependentChange): Promise<void> {
  const id = dep.ref.id;
  if (dep.ref.kind === 'PAYMENT_ORDER') {
    for (const change of dep.itemChanges) {
      if (change.after === 0) await tx.paymentOrderItem.delete({ where: { id: change.itemId } });
      else
        await tx.paymentOrderItem.update({
          where: { id: change.itemId },
          data: { amount: decimal(change.after) },
        });
    }
    if (dep.payment) {
      if (dep.payment.after === 0)
        await tx.paymentOrderPayment.delete({ where: { id: dep.payment.paymentId } });
      else
        await tx.paymentOrderPayment.update({
          where: { id: dep.payment.paymentId },
          data: { amount: decimal(dep.payment.after) },
        });
    }
    const total = await tx.paymentOrderItem.aggregate({
      where: { paymentOrderId: id },
      _sum: { amount: true },
    });
    await tx.paymentOrder.update({
      where: { id },
      data: { totalAmount: total._sum.amount ?? 0 },
    });
    return;
  }

  for (const change of dep.itemChanges) {
    if (change.after === 0) await tx.receiptItem.delete({ where: { id: change.itemId } });
    else
      await tx.receiptItem.update({
        where: { id: change.itemId },
        data: { amount: decimal(change.after) },
      });
  }
  if (dep.payment) {
    if (dep.payment.after === 0)
      await tx.receiptPayment.delete({ where: { id: dep.payment.paymentId } });
    else
      await tx.receiptPayment.update({
        where: { id: dep.payment.paymentId },
        data: { amount: decimal(dep.payment.after) },
      });
  }
  const total = await tx.receiptItem.aggregate({
    where: { receiptId: id },
    _sum: { amount: true },
  });
  await tx.receipt.update({ where: { id }, data: { totalAmount: total._sum.amount ?? 0 } });
}

/** Aplicaciones de NC que bajan o se borran, y las OP/RC que se ajustan o eliminan. */
async function settleChainTx(tx: Tx, ctx: EffectsCtx, plan: CorrectionPlan): Promise<void> {
  const isPurchase = plan.request.ref.kind === 'PURCHASE_INVOICE';
  for (const change of plan.creditNoteChanges) {
    const where = { id: change.applicationId };
    if (isPurchase) {
      if (change.after === 0) await tx.purchaseCreditNoteApplication.delete({ where });
      else
        await tx.purchaseCreditNoteApplication.update({
          where,
          data: { amount: decimal(change.after) },
        });
    } else if (change.after === 0) {
      await tx.salesCreditNoteApplication.delete({ where });
    } else {
      await tx.salesCreditNoteApplication.update({
        where,
        data: { amount: decimal(change.after) },
      });
    }
  }

  for (const dep of plan.dependents) {
    const handler = CORRECTION_HANDLERS[dep.ref.kind];
    if (dep.mode === 'DELETE') {
      if (dep.journalEntryId) {
        await deleteDraftJournalEntryTx(tx, {
          companyId: ctx.companyId,
          entryId: dep.journalEntryId,
        });
      }
      await handler.remove(tx, dep.ref.id);
    } else {
      await adjustSettlementTx(tx, dep);
      await handler.apply(
        tx,
        ctx,
        dep.ref.id,
        dep.journalEntryId ? { rewriteEntryId: dep.journalEntryId } : undefined
      );
    }
  }
}

/**
 * Ejecuta el plan (sin impedimentos) dentro de la transacción, en el orden del spec:
 * revertir los efectos de los dependientes y del origen, escribir/eliminar/anular el
 * origen, ajustar o eliminar los dependientes y recalcular el estado de las facturas
 * y gastos tocados. Al eliminar, la cadena se resuelve antes de borrar el origen (las
 * imputaciones lo referencian).
 */
async function executePlanTx(tx: Tx, ctx: EffectsCtx, plan: CorrectionPlan): Promise<void> {
  const { companyId } = ctx;
  const { request, origin } = plan;
  if (!origin) throw new BusinessError('El comprobante no existe.');
  const { id } = request.ref;
  const handler = CORRECTION_HANDLERS[request.ref.kind];
  const entry = origin.journalEntry;

  const chainRefs = [request.ref, ...plan.dependents.map((d) => d.ref)];
  const touched = new TouchedDocuments();
  touched.addInvoice(request.ref);
  for (const change of plan.creditNoteChanges) {
    touched.addInvoice({ kind: request.ref.kind, id: change.creditNoteId });
  }
  await touched.collectImputations(tx, chainRefs);

  // 1-2. Revertir: dependientes y origen (con sus estados todavía confirmados).
  for (const dep of plan.dependents) {
    await CORRECTION_HANDLERS[dep.ref.kind].revert(tx, ctx, dep.ref.id);
  }
  await handler.revert(tx, ctx, id);

  // 3-4. Origen y cadena
  if (request.mode === 'DELETE') {
    await settleChainTx(tx, ctx, plan);
    await handler.releaseLinks?.(tx, companyId, id);
    if (entry) await deleteDraftJournalEntryTx(tx, { companyId, entryId: entry.id });
    await handler.remove(tx, id);
  } else {
    if (request.mode === 'EDIT') {
      await handler.write(tx, companyId, id, plan.editData);
      await handler.validateForConfirmation?.(tx, id, companyId);
      await handler.apply(tx, ctx, id, entry ? { rewriteEntryId: entry.id } : undefined);
    } else {
      await handler.releaseLinks?.(tx, companyId, id);
      if (entry?.status === 'POSTED') {
        // §5.3: contraasiento con la fecha del comprobante, no la de hoy.
        await reverseJournalEntryTx(tx, {
          companyId,
          entryId: entry.id,
          date: origin.date,
          createdBy: ctx.userId,
          source: `correction-cancel:${request.ref.kind}:${id}`,
        });
      } else if (entry) {
        await deleteDraftJournalEntryTx(tx, { companyId, entryId: entry.id });
      }
      await handler.markCancelled(tx, id, entry?.status === 'DRAFT');
    }
    await settleChainTx(tx, ctx, plan);
  }

  // 5. Estados de facturas y gastos (lo que imputaban antes y lo que imputan ahora).
  await touched.collectImputations(tx, chainRefs);
  await touched.recompute(tx);
}

// ============================================================================
// SIMULACIÓN
// ============================================================================

interface Simulation {
  proposal: CorrectionProposal;
  /** Sin impedimentos ni elecciones pendientes, y la ejecución no falló: se puede confirmar. */
  ready: boolean;
  /** Por qué no está lista (si no lo está). */
  rejection?: Exclude<ApplyRejectionReason, 'STALE'>;
}

/**
 * Retoques de las tarjetas que `describeChanges` no conoce: el aviso de retenciones en
 * cada OP/RC que se ajusta (§4.3) y "Se desvincula" para los registros vinculados
 * (remitos, cuotas, proyecciones) que pierden su vínculo con el comprobante.
 */
function decorateCards(cards: ProposalCard[], plan: CorrectionPlan): ProposalCard[] {
  const warned = new Set(
    plan.dependents
      .filter((d) => d.mode === 'ADJUST' && d.hasWithholdings)
      .map((d) => `${d.ref.kind}:${d.ref.id}`)
  );
  return cards.map((card) => {
    const unlinked =
      card.action !== 'DELETE' &&
      LINK_KINDS.some((kind) => card.key.startsWith(`${kind}:`)) &&
      card.rows.some((row) => row.label === LINK_ROW_LABEL);
    return {
      ...card,
      ...(unlinked ? { action: 'UNLINK' as const } : {}),
      ...(warned.has(card.key) ? { warning: WITHHOLDINGS_WARNING } : {}),
    };
  });
}

/**
 * Planifica y, si se puede, ejecuta dentro de `tx` comparando las fotos de antes y
 * después. Con impedimentos no ejecuta. Si solo faltan elecciones de medio de pago,
 * ejecuta con el primer medio de cada una para mostrar las tarjetas, sin huella.
 */
async function simulateTx(
  tx: Tx,
  ctx: EffectsCtx,
  request: CorrectionRequest
): Promise<Simulation> {
  await lockOriginTx(tx, ctx.companyId, request.ref);
  const plan = await planCorrectionTx(tx, ctx, request);
  const base = { mode: request.mode, origin: request.ref, pendingChoices: plan.pendingChoices };
  const blocked = (
    rejection: NonNullable<Simulation['rejection']>,
    found = plan.impediments
  ): Simulation => ({
    ready: false,
    rejection,
    proposal: { ...base, cards: [], impediments: found, fingerprint: '' },
  });

  if (plan.impediments.length > 0) return blocked('IMPEDIMENTS');

  let executable = plan;
  if (plan.pendingChoices.length > 0) {
    const defaults = Object.fromEntries(
      plan.pendingChoices.map((c) => [c.documentId, c.options[0]?.paymentId ?? ''])
    );
    executable = await planCorrectionTx(tx, ctx, {
      ...request,
      choices: { ...request.choices, ...defaults },
    });
    // El primer medio puede no alcanzar: no hay nada que mostrar hasta que el usuario elija.
    if (executable.impediments.length > 0) return blocked('PENDING_CHOICES', []);
  }

  const refs: DocRef[] = [
    request.ref,
    ...executable.dependents.map((d) => d.ref),
    ...executable.creditNoteChanges.map((c) => ({ kind: request.ref.kind, id: c.creditNoteId })),
  ];
  const before = await loadChainSnapshotTx(tx, ctx.companyId, refs);
  try {
    await executePlanTx(tx, ctx, executable);
  } catch (error) {
    if (!(error instanceof BusinessError)) throw error;
    return blocked('SIMULATION_ERROR', [impediments.simulationError(error.message)]);
  }
  const after = await loadChainSnapshotTx(tx, ctx.companyId, refs, before.scope);
  const cards = decorateCards(describeChanges(before, after), executable);

  const ready = plan.pendingChoices.length === 0;
  return {
    ready,
    ...(ready ? {} : { rejection: 'PENDING_CHOICES' as const }),
    proposal: {
      ...base,
      cards,
      impediments: [],
      fingerprint: ready ? fingerprintProposal(cards, request.choices ?? {}) : '',
    },
  };
}

/** Corre la simulación en una transacción; `commit` decide si se confirma o se descarta. */
async function runSimulation<T>(
  ctx: EffectsCtx,
  request: CorrectionRequest,
  decide: (simulation: Simulation) => { commit: boolean; result: T }
): Promise<T> {
  const holder: { result?: T } = {};
  try {
    await prisma.$transaction(async (tx) => {
      const { commit, result } = decide(await simulateTx(tx, ctx, request));
      holder.result = result;
      if (!commit) throw new RollbackSignal();
    }, TX_OPTIONS);
  } catch (error) {
    if (!(error instanceof RollbackSignal)) throw error;
  }
  if (holder.result === undefined) {
    throw new BusinessError('No se pudo calcular la corrección.');
  }
  return holder.result;
}

// ============================================================================
// API
// ============================================================================

/**
 * Propuesta de la corrección sin aplicar nada: la transacción se descarta siempre
 * (tampoco se consume numeración de asientos).
 */
export async function previewCorrection(
  ctx: EffectsCtx,
  request: CorrectionRequest
): Promise<CorrectionProposal> {
  return runSimulation(ctx, request, (simulation) => ({
    commit: false,
    result: simulation.proposal,
  }));
}

/**
 * Aplica la corrección en una sola transacción, solo si no hay impedimentos ni
 * elecciones pendientes y la propuesta es la misma que vio el usuario (`fingerprint`).
 * Si algo cambió en el medio, no aplica nada y devuelve la propuesta nueva.
 */
export async function applyCorrection(
  ctx: EffectsCtx,
  request: CorrectionRequest,
  fingerprint: string
): Promise<ApplyResult> {
  const result = await runSimulation<ApplyResult>(ctx, request, (simulation) => {
    const commit = simulation.ready && simulation.proposal.fingerprint === fingerprint;
    return commit
      ? { commit, result: { applied: true } }
      : {
          commit,
          result: {
            applied: false,
            stale: true,
            reason: simulation.rejection ?? 'STALE',
            proposal: simulation.proposal,
          },
        };
  });

  logger.info('Corrección en cadena', {
    data: {
      companyId: ctx.companyId,
      userId: ctx.userId,
      mode: request.mode,
      origin: request.ref,
      applied: result.applied,
      reason: result.applied ? undefined : result.reason,
    },
  });
  return result;
}
