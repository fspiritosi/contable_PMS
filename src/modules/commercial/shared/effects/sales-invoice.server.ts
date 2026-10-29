import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type { SalesInvoiceStatus } from '@/generated/prisma/enums';
import {
  createJournalEntryForSalesInvoice,
  type DocumentEntryOptions,
} from '@/modules/accounting/features/integrations/commercial';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { BusinessError } from '@/shared/lib/action-result';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';

import { isAfipLocked } from '../afip-lock';
import { dedupeImpediments, impediments } from '../correction/impediments';
import type { Impediment } from '../correction/types';
import {
  buildMissingCostCenterMessage,
  effectiveAccountType,
  findLinesMissingCostCenter,
} from '../cost-center';
import { applySalesCreditNote, unapplySalesCreditNoteTx } from '../credit-note-compensation';
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
import { stockQuantitiesToMove } from './sales-invoice-stock';
import type { EffectsCtx, EffectsResult } from './types';

export { isAfipLocked };

/**
 * Efectos de una factura de venta (FV, NC o ND) (TSK-792): lo que mueve fuera de sí
 * misma al confirmarse y su inversa exacta.
 *
 * - FV: descuenta el stock de cada línea con ítem de stock (`StockMovement` SALE),
 *   salvo lo que ya entregaron los remitos facturados en ella (TSK-798).
 * - NC: el cliente devuelve, suma el stock (`StockMovement` RETURN) y compensa las
 *   facturas pendientes del cliente (`SalesCreditNoteApplication`).
 * - ND: no mueve stock (ajuste financiero).
 * - Todas: el asiento.
 *
 * Los movimientos se ubican por `referenceType 'sales_invoice'` y `referenceId` = la
 * factura, en el primer almacén activo de la empresa (por fecha de alta).
 */

const STOCK_REFERENCE = 'sales_invoice';
const STOCK_TYPES: ('SALE' | 'RETURN')[] = ['SALE', 'RETURN'];

/** Una FV en borrador no aplicó efectos y una anulada ya los deshizo (corrección, TSK-792). */
const hasAppliedEffects = (status: SalesInvoiceStatus) =>
  status !== 'DRAFT' && status !== 'CANCELLED';

/**
 * Lo que ya entregaron, por producto, los remitos facturados en esta factura: su
 * stock salió al crear el remito (TSK-798).
 */
async function deliveredByProductTx(
  tx: Tx,
  companyId: string,
  invoiceId: string
): Promise<Map<string, Prisma.Decimal>> {
  const rows = await tx.deliveryNoteLine.groupBy({
    by: ['productId'],
    where: { deliveryNote: { companyId, salesInvoiceId: invoiceId, status: 'INVOICED' } },
    _sum: { quantity: true },
  });
  return new Map(
    rows.map((row) => [row.productId, row._sum.quantity ?? new Prisma.Decimal(0)])
  );
}

/** Líneas de la factura que mueven stock y cuánto (sin lo que ya movieron sus remitos). */
async function stockToMoveTx<T extends { productId: string; quantity: Prisma.Decimal }>(
  tx: Tx,
  companyId: string,
  invoiceId: string,
  lines: (T & { product: { trackStock: boolean } })[]
) {
  const delivered = await deliveredByProductTx(tx, companyId, invoiceId);
  return stockQuantitiesToMove(
    lines.map((line) => ({ ...line, trackStock: line.product.trackStock })),
    delivered
  );
}

/**
 * Validación previa a confirmar (o a reaplicar los efectos tras editar): cuentas de
 * las líneas imputables, cuentas de los tributos y centros de costo si la empresa los
 * exige. No mira el estado de la factura.
 *
 * Por defecto lee lo guardado; el motor de corrección pasa su transacción para
 * validar los datos que acaba de escribir.
 */
export async function validateSalesInvoiceForConfirmation(
  invoiceId: string,
  companyId: string,
  db: Tx = prisma
): Promise<void> {
  const invoice = await db.salesInvoice.findFirst({
    where: { id: invoiceId, companyId },
    select: {
      internalTaxes: true,
      lines: {
        select: {
          description: true,
          product: {
            select: {
              name: true,
              // El tipo de la cuenta decide si la línea exige centro de costo
              // (TSK-583); id/code/name para pre-validar la cuenta de la
              // línea y nombrarla en el mensaje (TSK-721).
              defaultIncomeAccount: { select: { id: true, code: true, name: true, type: true } },
            },
          },
          costCenterAllocations: { select: { costCenterId: true, percentage: true } },
        },
      },
      perceptions: { select: { type: true, amount: true } },
    },
  });

  if (!invoice) {
    throw new BusinessError('Factura no encontrada');
  }

  const settings = await db.accountingSettings.findUnique({
    where: { companyId },
    select: {
      requireCostCenter: true,
      // Cuenta de ventas por defecto: la que usa el asiento si el ítem no
      // tiene una propia (TSK-583, hallazgo de revisión final): sin esto,
      // un ítem sin cuenta propia nunca exigía reparto aunque el asiento lo
      // imputara igual a `salesAccountId`, que es de resultado. id/code/
      // name para la pre-validación de cuentas de línea (TSK-721).
      salesAccount: { select: { id: true, code: true, name: true, type: true } },
      // Cuentas de los tributos del comprobante (TSK-644)
      internalTaxesAccountId: true,
      perceptionIvaCollectedAccountId: true,
      perceptionIibbCollectedAccountId: true,
      perceptionMunicipalCollectedAccountId: true,
    },
  });

  // Cuentas de las líneas (TSK-721). La cuenta la define el ítem; la "Cuenta
  // de ventas por defecto" es el respaldo. Se comprueba ANTES de la
  // transacción, como los tributos: así el error llega al usuario con el
  // nombre de la línea en vez de quedar una factura confirmada sin asiento.
  const defaultSalesAccount = settings?.salesAccount ?? null;
  const lineChecks = invoice.lines.map((line) => ({
    description: line.description,
    productName: line.product.name,
    itemAccountId: line.product.defaultIncomeAccount?.id ?? null,
  }));

  const missingLineAccounts = findLinesMissingAccount(lineChecks, defaultSalesAccount?.id);
  if (missingLineAccounts.length > 0) {
    throw new BusinessError(buildMissingLineAccountsMessage(missingLineAccounts, 'income'));
  }

  // La cuenta efectiva tiene que ser imputable HOY (hoja, activa, sin corte
  // de ejercicio vigente); nunca se cae a la global en silencio. Sin `types`:
  // la cuenta de un ítem puede ser ASSET (TSK-579).
  const effectiveAccountIds = [
    ...new Set(
      lineChecks
        .map((l) => resolveLineAccount(l.itemAccountId, defaultSalesAccount?.id))
        .filter((accountId): accountId is string => accountId !== null)
    ),
  ];
  const imputableAccounts = await db.account.findMany({
    where: { ...buildImputableAccountsWhere({ companyId }), id: { in: effectiveAccountIds } },
    select: { id: true },
  });
  const unavailableLineAccounts = findLinesWithUnavailableAccount(
    lineChecks,
    defaultSalesAccount?.id,
    new Set(imputableAccounts.map((a) => a.id))
  );
  if (unavailableLineAccounts.length > 0) {
    const labels = new Map<string, string>();
    for (const line of invoice.lines) {
      const account = line.product.defaultIncomeAccount;
      if (account) labels.set(account.id, formatAccountLabel(account));
    }
    if (defaultSalesAccount) labels.set(defaultSalesAccount.id, formatAccountLabel(defaultSalesAccount));

    throw new BusinessError(
      buildUnavailableLineAccountsMessage(
        unavailableLineAccounts.map((u) => ({
          description: u.line.description,
          accountLabel: labels.get(u.accountId) ?? u.accountId,
          source: u.source,
        })),
        'income'
      )
    );
  }

  // Tributos sin cuenta contable configurada (TSK-644). Ver la nota
  // equivalente en `validatePurchaseInvoiceForConfirmation`: se comprueba antes
  // de abrir la transacción para no dejar la factura confirmada y sin asiento.
  const missingTributeAccounts = findMissingTributeAccounts([
    ...invoice.perceptions
      .filter((p) => Number(p.amount) > 0)
      .map((p) => ({
        label: `percepción ${p.type} cobrada`,
        accountId: perceptionAccountId(p.type, {
          IVA: settings?.perceptionIvaCollectedAccountId,
          IIBB: settings?.perceptionIibbCollectedAccountId,
          MUNICIPAL: settings?.perceptionMunicipalCollectedAccountId,
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
          line.product?.defaultIncomeAccount?.type ?? null,
          settings.salesAccount?.type
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
}

/**
 * Lo que hace la confirmación de la factura dentro de la transacción salvo el cambio
 * de estado: stock (SALE en la FV, RETURN en la NC, nada en la ND), asiento y
 * compensación de la NC. Espera la factura ya en CONFIRMED.
 *
 * Con `opts.rewriteEntryId` reescribe ese asiento (DRAFT) conservando su número en
 * vez de crear uno nuevo.
 */
export async function applySalesInvoiceEffectsTx(
  tx: Tx,
  ctx: EffectsCtx,
  invoiceId: string,
  opts?: DocumentEntryOptions
): Promise<EffectsResult> {
  const { companyId, userId } = ctx;
  const invoice = await tx.salesInvoice.findFirst({
    where: { id: invoiceId, companyId },
    select: {
      fullNumber: true,
      voucherType: true,
      total: true,
      customerId: true,
      originalInvoiceId: true,
      lines: {
        select: {
          productId: true,
          quantity: true,
          product: { select: { name: true, trackStock: true } },
        },
      },
    },
  });
  if (!invoice) {
    throw new BusinessError('Factura no encontrada');
  }

  // ND no afecta stock (ajuste financiero)
  // NC restaura stock, Factura descuenta stock
  const isND = isDebitNote(invoice.voucherType);
  const isNC = isCreditNote(invoice.voucherType);

  if (!isND) {
    const toMove = await stockToMoveTx(tx, companyId, invoiceId, invoice.lines);
    for (const { line, quantity: quantityToHandle } of toMove) {
      // Buscar almacén principal (o el primero disponible)
      const warehouse = await tx.warehouse.findFirst({
        where: { companyId, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      if (!warehouse) {
        throw new BusinessError('No hay almacenes disponibles para gestionar stock');
      }

      const stockKey = {
        warehouseId_productId: { warehouseId: warehouse.id, productId: line.productId },
      };

      if (isNC) {
        // NC de venta: restaurar stock (devuelve ítems)
        await tx.warehouseStock.upsert({
          where: stockKey,
          update: {
            quantity: { increment: quantityToHandle },
            availableQty: { increment: quantityToHandle },
          },
          create: {
            warehouseId: warehouse.id,
            productId: line.productId,
            quantity: quantityToHandle,
            reservedQty: 0,
            availableQty: quantityToHandle,
          },
        });

        await tx.stockMovement.create({
          data: {
            companyId,
            productId: line.productId,
            warehouseId: warehouse.id,
            type: 'RETURN',
            quantity: quantityToHandle,
            referenceType: STOCK_REFERENCE,
            referenceId: invoiceId,
            notes: `NC Venta ${invoice.fullNumber}`,
            date: new Date(),
            createdBy: userId,
          },
        });
      } else {
        // Factura normal: descontar stock
        const warehouseStock = await tx.warehouseStock.findUnique({
          where: stockKey,
          select: { quantity: true },
        });

        const currentStock = warehouseStock?.quantity || new Prisma.Decimal(0);

        if (currentStock.lessThan(quantityToHandle)) {
          throw new BusinessError(
            `Stock insuficiente para ${line.product.name}. Disponible: ${currentStock}, Requerido: ${quantityToHandle}`
          );
        }

        await tx.warehouseStock.upsert({
          where: stockKey,
          update: {
            quantity: { decrement: quantityToHandle },
            availableQty: { decrement: quantityToHandle },
          },
          create: {
            warehouseId: warehouse.id,
            productId: line.productId,
            quantity: new Prisma.Decimal(0).minus(quantityToHandle),
            reservedQty: 0,
            availableQty: new Prisma.Decimal(0).minus(quantityToHandle),
          },
        });

        await tx.stockMovement.create({
          data: {
            companyId,
            productId: line.productId,
            warehouseId: warehouse.id,
            type: 'SALE',
            quantity: quantityToHandle,
            referenceType: STOCK_REFERENCE,
            referenceId: invoiceId,
            notes: `Factura ${invoice.fullNumber}`,
            date: new Date(),
            createdBy: userId,
          },
        });
      }
    }
  }

  // Asiento contable. TSK-721: cualquier error del asiento aborta la
  // transacción y llega al usuario por el catch del llamador.
  const journalEntryId = await createJournalEntryForSalesInvoice(invoiceId, companyId, tx, opts);
  await tx.salesInvoice.update({ where: { id: invoiceId }, data: { journalEntryId } });
  logger.info('Asiento contable generado para factura de venta', {
    data: { invoiceId, journalEntryId },
  });

  // Auto-compensar NC contra facturas/ND pendientes del mismo cliente
  if (isNC) {
    await applySalesCreditNote(
      tx,
      {
        id: invoiceId,
        total: invoice.total,
        customerId: invoice.customerId,
        originalInvoiceId: invoice.originalInvoiceId,
      },
      companyId
    );
  }

  return { journalEntryId };
}

/**
 * Inversa de `applySalesInvoiceEffectsTx`, sin tocar el asiento ni el estado de la
 * factura (los decide el motor de corrección):
 * - Stock: por cada `StockMovement` SALE/RETURN de la factura, devuelve la cantidad
 *   en el almacén de ese movimiento con el signo inverso (SALE había descontado →
 *   suma; RETURN había sumado → resta) y los borra. Son todos los movimientos de la
 *   factura, no uno por producto.
 * - NC: borra las aplicaciones que dio y recalcula las facturas que compensaba.
 *
 * Una factura en borrador o anulada no tiene efectos aplicados: no hace nada.
 * No valida que los efectos sigan revertibles: eso lo anticipa
 * `salesInvoiceEffectImpedimentsTx`, que el llamador consulta antes.
 */
export async function revertSalesInvoiceEffectsTx(
  tx: Tx,
  ctx: EffectsCtx,
  invoiceId: string
): Promise<void> {
  const { companyId } = ctx;
  const invoice = await tx.salesInvoice.findFirst({
    where: { id: invoiceId, companyId },
    select: { status: true, voucherType: true },
  });
  if (!invoice) {
    throw new BusinessError('Factura no encontrada');
  }
  if (!hasAppliedEffects(invoice.status)) return;

  const movements = await tx.stockMovement.findMany({
    where: {
      companyId,
      type: { in: STOCK_TYPES },
      referenceType: STOCK_REFERENCE,
      referenceId: invoiceId,
    },
    select: { id: true, type: true, warehouseId: true, productId: true, quantity: true },
  });
  for (const movement of movements) {
    const delta = movement.type === 'SALE' ? movement.quantity : movement.quantity.negated();
    await tx.warehouseStock.upsert({
      where: {
        warehouseId_productId: { warehouseId: movement.warehouseId, productId: movement.productId },
      },
      create: {
        warehouseId: movement.warehouseId,
        productId: movement.productId,
        quantity: delta,
        reservedQty: 0,
        availableQty: delta,
      },
      update: {
        quantity: { increment: delta },
        availableQty: { increment: delta },
      },
    });
  }
  if (movements.length > 0) {
    await tx.stockMovement.deleteMany({ where: { id: { in: movements.map((m) => m.id) } } });
  }

  // Compensación de la NC
  if (isCreditNote(invoice.voucherType)) {
    await unapplySalesCreditNoteTx(tx, invoiceId);
  }
}

/**
 * Impedimentos propios de la factura, sin mirar el asiento ni el período:
 * - Con CAE o de un punto de venta AFIP: no se toca (spec §4.1) → `afipCae`.
 * - Una FV o NC confirmada con ítems de stock y sin movimientos ubicables (de la
 *   empresa de la factura) es anterior a la trazabilidad o los perdió: revertir no
 *   los encontraría y reaplicar duplicaría el stock → `untraceable`. La ND no mueve
 *   stock. La compensación de la NC se deriva de sus aplicaciones, que siempre se
 *   ubican.
 */
export async function salesInvoiceEffectImpedimentsTx(
  tx: Tx,
  invoiceId: string,
  docLabel: string
): Promise<Impediment[]> {
  const invoice = await tx.salesInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      companyId: true,
      status: true,
      voucherType: true,
      cae: true,
      pointOfSale: { select: { afipEnabled: true } },
      lines: {
        select: { productId: true, quantity: true, product: { select: { trackStock: true } } },
      },
    },
  });
  if (!invoice) return [];

  const found: Impediment[] = [];
  if (isAfipLocked(invoice)) {
    found.push(impediments.afipCae(docLabel));
  }

  const expectsStock =
    hasAppliedEffects(invoice.status) &&
    !isDebitNote(invoice.voucherType) &&
    (await stockToMoveTx(tx, invoice.companyId, invoiceId, invoice.lines)).length > 0;
  if (expectsStock) {
    const movements = await tx.stockMovement.count({
      where: {
        companyId: invoice.companyId,
        type: { in: STOCK_TYPES },
        referenceType: STOCK_REFERENCE,
        referenceId: invoiceId,
      },
    });
    if (movements === 0) {
      found.push(impediments.untraceable(docLabel));
    }
  }
  return dedupeImpediments(found);
}
