import 'server-only';

import type { PurchaseInvoiceStatus } from '@/generated/prisma/enums';
import {
  createJournalEntryForPurchaseInvoice,
  type DocumentEntryOptions,
} from '@/modules/accounting/features/integrations/commercial';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { BusinessError } from '@/shared/lib/action-result';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';

import { dedupeImpediments, impediments } from '../correction/impediments';
import type { Impediment } from '../correction/types';
import {
  buildMissingCostCenterMessage,
  effectiveAccountType,
  findLinesMissingCostCenter,
} from '../cost-center';
import { applyPurchaseCreditNote, unapplyPurchaseCreditNoteTx } from '../credit-note-compensation';
import {
  buildMissingLineAccountsMessage,
  buildUnavailableLineAccountsMessage,
  findLinesMissingAccount,
  findLinesWithUnavailableAccount,
  formatAccountLabel,
  resolveLineAccount,
} from '../line-accounts';
import {
  buildMissingTributeAccountsMessage,
  findMissingTributeAccounts,
  perceptionAccountId,
} from '../perceptions';
import { isCreditNote, isDebitNote } from '../voucher-utils';
import type { EffectsCtx, EffectsResult } from './types';

/**
 * Efectos de una factura de compra (FC, ND o NC) (TSK-792): lo que mueve fuera de sí
 * misma al confirmarse y su inversa exacta.
 *
 * - NC: devolución de stock al almacén principal (`StockMovement` RETURN con
 *   `referenceType 'purchase_invoice'` y `referenceId` = la NC) y compensación contra
 *   las facturas pendientes del proveedor (`PurchaseCreditNoteApplication`).
 * - FC con OC: `invoicedQty` de las líneas de la OC y su estado de facturación.
 * - Todas: el asiento.
 *
 * Las FC normales NO mueven stock: el stock entra por los remitos de recepción.
 */

/** Movimiento de stock de la devolución de una NC de compra. */
const NC_STOCK_REFERENCE = 'purchase_invoice';

/** Una FC en borrador no aplicó efectos y una anulada ya los deshizo (corrección, TSK-792). */
const hasAppliedEffects = (status: PurchaseInvoiceStatus) =>
  status !== 'DRAFT' && status !== 'CANCELLED';

/** Solo las facturas normales (no NC ni ND) facturan la OC. */
const invoicesPurchaseOrder = (voucherType: Parameters<typeof isCreditNote>[0]) =>
  !isCreditNote(voucherType) && !isDebitNote(voucherType);

/**
 * Validación previa a confirmar (o a reaplicar los efectos tras editar): cuentas de
 * las líneas imputables, cuentas de los tributos, centros de costo si la empresa los
 * exige y almacén principal para las NC. No mira el estado de la factura.
 *
 * Por defecto lee lo guardado; el motor de corrección pasa su transacción para
 * validar los datos que acaba de escribir.
 */
export async function validatePurchaseInvoiceForConfirmation(
  invoiceId: string,
  companyId: string,
  db: Tx = prisma
): Promise<void> {
  const invoice = await db.purchaseInvoice.findFirst({
    where: { id: invoiceId, companyId },
    select: {
      voucherType: true,
      internalTaxes: true,
      lines: {
        select: {
          description: true,
          product: {
            select: {
              name: true,
              // El tipo decide si la línea exige centro de costo (TSK-583);
              // id/code/name para pre-validar la cuenta y nombrarla (TSK-721).
              defaultExpenseAccount: { select: { id: true, code: true, name: true, type: true } },
            },
          },
          costCenterAllocations: { select: { costCenterId: true, percentage: true } },
        },
      },
      perceptions: { select: { type: true, amount: true } },
    },
  });

  if (!invoice) {
    throw new BusinessError('Factura de compra no encontrada');
  }

  const settings = await db.accountingSettings.findUnique({
    where: { companyId },
    select: {
      requireCostCenter: true,
      // Cuentas de los tributos del comprobante (TSK-644)
      internalTaxesAccountId: true,
      perceptionIvaSufferedAccountId: true,
      perceptionIibbSufferedAccountId: true,
      perceptionMunicipalSufferedAccountId: true,
      // Cuenta de compras por defecto: la que usa el asiento si el ítem no
      // tiene una propia o la línea no tiene ítem (TSK-583, hallazgo de
      // revisión final): sin esto, un ítem sin cuenta propia nunca exigía
      // reparto aunque el asiento lo imputara igual a `purchasesAccountId`,
      // que es de resultado. id/code/name para la pre-validación de cuentas
      // de línea (TSK-721).
      purchasesAccount: { select: { id: true, code: true, name: true, type: true } },
    },
  });

  // Cuentas de las líneas (TSK-721). La cuenta la define el ítem; la "Cuenta
  // de compras por defecto" es el respaldo, y el único camino para las
  // líneas sin ítem (gastos no inventariables, importación AFIP). Se
  // comprueba ANTES de la transacción, como los tributos: así el error llega
  // al usuario con el nombre de la línea en vez de quedar una factura
  // confirmada sin asiento.
  const defaultPurchasesAccount = settings?.purchasesAccount ?? null;
  const lineChecks = invoice.lines.map((line) => ({
    description: line.description,
    productName: line.product?.name ?? null, // null = línea sin ítem
    itemAccountId: line.product?.defaultExpenseAccount?.id ?? null,
  }));

  const missingLineAccounts = findLinesMissingAccount(lineChecks, defaultPurchasesAccount?.id);
  if (missingLineAccounts.length > 0) {
    throw new BusinessError(buildMissingLineAccountsMessage(missingLineAccounts, 'expense'));
  }

  // La cuenta efectiva tiene que ser imputable HOY (hoja, activa, sin corte
  // de ejercicio vigente); nunca se cae a la global en silencio. Sin `types`:
  // la cuenta de un ítem puede ser ASSET (bien de uso, TSK-579/618).
  const effectiveAccountIds = [
    ...new Set(
      lineChecks
        .map((l) => resolveLineAccount(l.itemAccountId, defaultPurchasesAccount?.id))
        .filter((accountId): accountId is string => accountId !== null)
    ),
  ];
  const imputableAccounts = await db.account.findMany({
    where: { ...buildImputableAccountsWhere({ companyId }), id: { in: effectiveAccountIds } },
    select: { id: true },
  });
  const unavailableLineAccounts = findLinesWithUnavailableAccount(
    lineChecks,
    defaultPurchasesAccount?.id,
    new Set(imputableAccounts.map((a) => a.id))
  );
  if (unavailableLineAccounts.length > 0) {
    const labels = new Map<string, string>();
    for (const line of invoice.lines) {
      const account = line.product?.defaultExpenseAccount;
      if (account) labels.set(account.id, formatAccountLabel(account));
    }
    if (defaultPurchasesAccount) {
      labels.set(defaultPurchasesAccount.id, formatAccountLabel(defaultPurchasesAccount));
    }

    throw new BusinessError(
      buildUnavailableLineAccountsMessage(
        unavailableLineAccounts.map((u) => ({
          description: u.line.description,
          accountLabel: labels.get(u.accountId) ?? u.accountId,
          source: u.source,
        })),
        'expense'
      )
    );
  }

  // Tributos sin cuenta contable configurada (TSK-644).
  //
  // Se comprueba ANTES de abrir la transacción: si falta una cuenta, el
  // asiento quedaría descuadrado y moriría dentro del `catch` que lo degrada
  // a `logger.warn`, dejando la factura confirmada y sin asiento. Mejor no
  // dejar confirmar y decir exactamente qué cuenta falta.
  const missingTributeAccounts = findMissingTributeAccounts([
    ...invoice.perceptions
      .filter((p) => Number(p.amount) > 0)
      .map((p) => ({
        label: `percepción ${p.type} sufrida`,
        accountId: perceptionAccountId(p.type, {
          IVA: settings?.perceptionIvaSufferedAccountId,
          IIBB: settings?.perceptionIibbSufferedAccountId,
          MUNICIPAL: settings?.perceptionMunicipalSufferedAccountId,
        }),
      })),
    ...(Number(invoice.internalTaxes) > 0
      ? [
          {
            label: 'impuestos internos',
            accountId: settings?.internalTaxesAccountId,
          },
        ]
      : []),
  ]);

  if (missingTributeAccounts.length > 0) {
    throw new BusinessError(buildMissingTributeAccountsMessage(missingTributeAccounts));
  }

  if (settings?.requireCostCenter) {
    const missing = findLinesMissingCostCenter(
      invoice.lines.map((line) => ({
        description: line.description,
        accountType: effectiveAccountType(
          line.product?.defaultExpenseAccount?.type ?? null,
          settings.purchasesAccount?.type
        ),
        allocations: line.costCenterAllocations.map((a) => ({
          costCenterId: a.costCenterId,
          percentage: Number(a.percentage),
        })),
      }))
    );

    if (missing.length > 0) {
      throw new BusinessError(buildMissingCostCenterMessage(missing));
    }
  }

  // Almacén principal solo necesario para NC (decremento de stock por devolución)
  if (isCreditNote(invoice.voucherType)) {
    await findMainWarehouseId(db, companyId);
  }
}

async function findMainWarehouseId(db: Tx, companyId: string): Promise<string> {
  const mainWarehouse = await db.warehouse.findFirst({
    where: { companyId, type: 'MAIN', isActive: true },
    select: { id: true },
  });
  if (!mainWarehouse) {
    throw new BusinessError(
      'No se encontró un almacén principal activo. Configura uno antes de confirmar notas de crédito.'
    );
  }
  return mainWarehouse.id;
}

/**
 * Lo que hace la confirmación de la factura dentro de la transacción salvo el cambio
 * de estado: devolución de stock (NC), facturación de la OC (FC), asiento y
 * compensación de la NC. Espera la factura ya en CONFIRMED.
 *
 * Con `opts.rewriteEntryId` reescribe ese asiento (DRAFT) conservando su número en
 * vez de crear uno nuevo.
 */
export async function applyPurchaseInvoiceEffectsTx(
  tx: Tx,
  ctx: EffectsCtx,
  invoiceId: string,
  opts?: DocumentEntryOptions
): Promise<EffectsResult> {
  const { companyId, userId } = ctx;
  const invoice = await tx.purchaseInvoice.findFirst({
    where: { id: invoiceId, companyId },
    select: {
      fullNumber: true,
      issueDate: true,
      voucherType: true,
      total: true,
      supplierId: true,
      originalInvoiceId: true,
      purchaseOrderId: true,
      lines: {
        select: {
          productId: true,
          quantity: true,
          purchaseOrderLineId: true,
          product: { select: { name: true, trackStock: true } },
        },
      },
    },
  });
  if (!invoice) {
    throw new BusinessError('Factura de compra no encontrada');
  }
  const isNC = isCreditNote(invoice.voucherType);

  // NC de compra: devolvemos al proveedor → decrementar stock
  if (isNC) {
    const warehouseId = await findMainWarehouseId(tx, companyId);
    for (const line of invoice.lines) {
      if (!line.productId || !line.product?.trackStock) continue;

      const quantity = Number(line.quantity);

      await tx.warehouseStock.upsert({
        where: { warehouseId_productId: { warehouseId, productId: line.productId } },
        create: {
          warehouseId,
          productId: line.productId,
          quantity: -quantity,
          reservedQty: 0,
          availableQty: -quantity,
        },
        update: {
          quantity: { decrement: quantity },
          availableQty: { decrement: quantity },
        },
      });

      await tx.stockMovement.create({
        data: {
          companyId,
          warehouseId,
          productId: line.productId,
          type: 'RETURN',
          quantity,
          referenceType: NC_STOCK_REFERENCE,
          referenceId: invoiceId,
          notes: `NC Compra ${invoice.fullNumber} - ${line.product.name}`,
          date: invoice.issueDate,
          createdBy: userId,
        },
      });
    }
  }

  // Incrementar invoicedQty en líneas de OC vinculadas (solo facturas regulares)
  if (invoice.purchaseOrderId && invoicesPurchaseOrder(invoice.voucherType)) {
    for (const line of invoice.lines) {
      if (line.purchaseOrderLineId) {
        await tx.purchaseOrderLine.update({
          where: { id: line.purchaseOrderLineId },
          data: { invoicedQty: { increment: line.quantity } },
        });
      }
    }
    await updatePurchaseOrderInvoicingStatus(tx, invoice.purchaseOrderId);
  }

  // Asiento contable. TSK-721: cualquier error aborta la transacción.
  const journalEntryId = await createJournalEntryForPurchaseInvoice(invoiceId, companyId, tx, opts);
  await tx.purchaseInvoice.update({ where: { id: invoiceId }, data: { journalEntryId } });
  logger.info('Asiento contable generado para factura de compra', {
    data: { invoiceId, journalEntryId, rewritten: Boolean(opts?.rewriteEntryId) },
  });

  // Auto-compensar NC contra facturas/ND pendientes del mismo proveedor
  if (isNC) {
    await applyPurchaseCreditNote(
      tx,
      {
        id: invoiceId,
        total: invoice.total,
        supplierId: invoice.supplierId,
        originalInvoiceId: invoice.originalInvoiceId,
      },
      companyId
    );
  }

  return { journalEntryId };
}

/**
 * Inversa exacta de `applyPurchaseInvoiceEffectsTx`, sin tocar el asiento ni el
 * estado de la factura (los decide el motor de corrección):
 * - NC: devuelve al almacén lo de cada `StockMovement` de la devolución y los borra;
 *   borra las aplicaciones que dio la NC y recalcula las facturas que compensaba.
 * - FC con OC: descuenta `invoicedQty` por línea y recalcula el estado de la OC.
 *
 * Una factura en borrador o anulada no tiene efectos aplicados: no hace nada.
 * No valida que los efectos sigan revertibles: eso lo anticipa
 * `purchaseInvoiceEffectImpedimentsTx`, que el llamador consulta antes.
 */
export async function revertPurchaseInvoiceEffectsTx(
  tx: Tx,
  ctx: EffectsCtx,
  invoiceId: string
): Promise<void> {
  const { companyId } = ctx;
  const invoice = await tx.purchaseInvoice.findFirst({
    where: { id: invoiceId, companyId },
    select: {
      status: true,
      voucherType: true,
      purchaseOrderId: true,
      lines: { select: { quantity: true, purchaseOrderLineId: true } },
    },
  });
  if (!invoice) {
    throw new BusinessError('Factura de compra no encontrada');
  }
  if (!hasAppliedEffects(invoice.status)) return;

  // Stock de la devolución (NC): mismo almacén, cantidad inversa.
  const movements = await tx.stockMovement.findMany({
    where: { companyId, type: 'RETURN', referenceType: NC_STOCK_REFERENCE, referenceId: invoiceId },
    select: { id: true, warehouseId: true, productId: true, quantity: true },
  });
  for (const movement of movements) {
    await tx.warehouseStock.upsert({
      where: {
        warehouseId_productId: { warehouseId: movement.warehouseId, productId: movement.productId },
      },
      create: {
        warehouseId: movement.warehouseId,
        productId: movement.productId,
        quantity: movement.quantity,
        reservedQty: 0,
        availableQty: movement.quantity,
      },
      update: {
        quantity: { increment: movement.quantity },
        availableQty: { increment: movement.quantity },
      },
    });
  }
  if (movements.length > 0) {
    await tx.stockMovement.deleteMany({ where: { id: { in: movements.map((m) => m.id) } } });
  }

  // Facturación de la OC (solo facturas regulares)
  if (invoice.purchaseOrderId && invoicesPurchaseOrder(invoice.voucherType)) {
    for (const line of invoice.lines) {
      if (line.purchaseOrderLineId) {
        await tx.purchaseOrderLine.update({
          where: { id: line.purchaseOrderLineId },
          data: { invoicedQty: { decrement: line.quantity } },
        });
      }
    }
    await updatePurchaseOrderInvoicingStatus(tx, invoice.purchaseOrderId);
  }

  // Compensación de la NC
  if (isCreditNote(invoice.voucherType)) {
    await unapplyPurchaseCreditNoteTx(tx, invoiceId);
  }
}

/**
 * Impedimentos propios de los efectos de la factura, sin mirar el asiento ni el
 * período. Solo la devolución de stock de una NC se ubica por trazabilidad: una NC
 * confirmada con ítems de stock y sin movimientos de devolución es anterior a la
 * trazabilidad o los perdió, y revertir no los encontraría (reaplicar duplicaría la
 * devolución). La OC y la compensación se derivan de las líneas y de las
 * aplicaciones, que siempre se ubican.
 */
export async function purchaseInvoiceEffectImpedimentsTx(
  tx: Tx,
  invoiceId: string,
  docLabel: string
): Promise<Impediment[]> {
  const invoice = await tx.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      status: true,
      voucherType: true,
      lines: { select: { product: { select: { trackStock: true } } } },
    },
  });
  if (!invoice || !hasAppliedEffects(invoice.status) || !isCreditNote(invoice.voucherType)) {
    return [];
  }

  const found: Impediment[] = [];
  if (invoice.lines.some((line) => line.product?.trackStock)) {
    const movements = await tx.stockMovement.count({
      where: { type: 'RETURN', referenceType: NC_STOCK_REFERENCE, referenceId: invoiceId },
    });
    if (movements === 0) {
      found.push(impediments.untraceable(docLabel));
    }
  }
  return dedupeImpediments(found);
}

/**
 * Recalcula el estado de facturación de una OC basado en las cantidades facturadas
 */
export async function updatePurchaseOrderInvoicingStatus(
  tx: Tx,
  purchaseOrderId: string
): Promise<void> {
  const poLines = await tx.purchaseOrderLine.findMany({
    where: { orderId: purchaseOrderId },
    select: { quantity: true, invoicedQty: true },
  });

  const allFullyInvoiced = poLines.every(
    (line) => Number(line.invoicedQty) >= Number(line.quantity)
  );
  const anyPartiallyInvoiced = poLines.some((line) => Number(line.invoicedQty) > 0);

  let newStatus: 'NOT_INVOICED' | 'PARTIALLY_INVOICED' | 'FULLY_INVOICED';
  if (allFullyInvoiced) {
    newStatus = 'FULLY_INVOICED';
  } else if (anyPartiallyInvoiced) {
    newStatus = 'PARTIALLY_INVOICED';
  } else {
    newStatus = 'NOT_INVOICED';
  }

  await tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { invoicingStatus: newStatus },
  });
}
