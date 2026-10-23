import 'server-only';

import type { VoucherType } from '@/generated/prisma/enums';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import type { PurchaseInvoiceFormInput } from '@/modules/commercial/features/purchases/features/invoices/shared/validators';
import { BusinessError } from '@/shared/lib/action-result';

import { calculateOtherTaxes, parseInternalTaxes, toPerceptionRecords } from '../perceptions';

/**
 * Escritura de los datos editables de una factura de compra (TSK-792). Vive fuera
 * del archivo `'use server'` de facturas porque recibe una transacción: exportada
 * desde ahí sería un server action público sin permisos.
 */

const distinct = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => Boolean(id))),
];

/**
 * Los datos llegan del cliente (edición de borrador o propuesta del motor): la
 * factura, el proveedor, la OC, sus líneas, los ítems y los centros de costo tienen
 * que ser de la empresa; la OC, del proveedor de la factura, y las líneas de OC, de
 * esa OC.
 */
async function assertPurchaseInvoiceReferencesTx(
  tx: Tx,
  companyId: string,
  invoiceId: string,
  input: PurchaseInvoiceFormInput
): Promise<void> {
  const purchaseOrderId = input.purchaseOrderId || null;
  const orderLineIds = distinct(input.lines.map((line) => line.purchaseOrderLineId));
  const productIds = distinct(input.lines.map((line) => line.productId));
  const costCenterIds = distinct(
    input.lines.flatMap((line) => (line.costCenterAllocations ?? []).map((a) => a.costCenterId))
  );

  const [invoices, suppliers, orders, orderLines, products, costCenters] = await Promise.all([
    tx.purchaseInvoice.count({ where: { id: invoiceId, companyId } }),
    tx.supplier.count({ where: { id: input.supplierId, companyId } }),
    purchaseOrderId
      ? tx.purchaseOrder.count({
          where: { id: purchaseOrderId, companyId, supplierId: input.supplierId },
        })
      : Promise.resolve(1),
    tx.purchaseOrderLine.count({
      where: {
        id: { in: orderLineIds },
        order: { companyId, ...(purchaseOrderId ? { id: purchaseOrderId } : {}) },
      },
    }),
    tx.product.count({ where: { id: { in: productIds }, companyId } }),
    tx.costCenter.count({ where: { id: { in: costCenterIds }, companyId } }),
  ]);

  if (invoices === 0) throw new BusinessError('Factura de compra no encontrada');
  if (suppliers === 0) throw new BusinessError('El proveedor no existe en la empresa');
  if (orders === 0) {
    throw new BusinessError('La orden de compra no es del proveedor de la factura o no existe');
  }
  if (orderLines !== orderLineIds.length) {
    throw new BusinessError('Alguna línea no corresponde a la orden de compra de la factura');
  }
  if (products !== productIds.length) {
    throw new BusinessError('Alguno de los ítems no existe en la empresa');
  }
  if (costCenters !== costCenterIds.length) {
    throw new BusinessError('Alguno de los centros de costo no existe en la empresa');
  }
}

/**
 * Escribe los datos editables de la factura dentro de la transacción del llamador:
 * cabecera y totales, y reemplaza líneas (con su reparto por centro de costo) y
 * percepciones. Mantiene estado, asiento, factura original y createdBy. No mira el
 * estado ni aplica efectos: lo usan `updatePurchaseInvoice` (borrador) y el motor de
 * corrección, que revierte y reaplica los efectos alrededor de esta escritura.
 * Rechaza referencias ajenas a la empresa y un número repetido del proveedor.
 */
export async function writePurchaseInvoiceDataTx(
  tx: Tx,
  companyId: string,
  invoiceId: string,
  input: PurchaseInvoiceFormInput
): Promise<void> {
  await assertPurchaseInvoiceReferencesTx(tx, companyId, invoiceId, input);

  // Calcular totales
  let subtotal = 0;
  let vatAmount = 0;

  const linesData = input.lines.map((line) => {
    const qty = parseFloat(line.quantity);
    const cost = parseFloat(line.unitCost);
    const vat = parseFloat(line.vatRate);

    const lineSubtotal = qty * cost;
    const lineVat = lineSubtotal * (vat / 100);
    const lineTotal = lineSubtotal + lineVat;

    subtotal += lineSubtotal;
    vatAmount += lineVat;

    return {
      productId: line.productId || null,
      description: line.description,
      quantity: qty,
      unitCost: cost,
      vatRate: vat,
      vatAmount: lineVat,
      subtotal: lineSubtotal,
      total: lineTotal,
      purchaseOrderLineId: line.purchaseOrderLineId || null,
      costCenterAllocations: {
        create: (line.costCenterAllocations ?? []).map((a) => ({
          costCenterId: a.costCenterId,
          percentage: a.percentage,
        })),
      },
    };
  });

  // Ver nota en createPurchaseInvoice sobre la semántica de `otherTaxes`.
  const perceptionsData = toPerceptionRecords(input.perceptions ?? []);
  const internalTaxes = parseInternalTaxes(input.internalTaxes);
  const otherTaxes = calculateOtherTaxes(perceptionsData, internalTaxes);

  const total = subtotal + vatAmount + otherTaxes;

  // Verificar que no exista otra factura con el mismo número
  const fullNumber = `${input.pointOfSale}-${input.number}`;
  const duplicate = await tx.purchaseInvoice.findFirst({
    where: { companyId, supplierId: input.supplierId, fullNumber, id: { not: invoiceId } },
    select: { id: true },
  });
  if (duplicate) {
    throw new BusinessError(`Ya existe otra factura de este proveedor con el número ${fullNumber}`);
  }

  // Líneas y percepciones se reemplazan enteras, no se intenta reconciliar
  // fila por fila (TSK-644).
  await tx.purchaseInvoiceLine.deleteMany({ where: { invoiceId } });
  await tx.purchaseInvoicePerception.deleteMany({ where: { invoiceId } });

  await tx.purchaseInvoice.update({
    where: { id: invoiceId, companyId },
    data: {
      supplierId: input.supplierId,
      voucherType: input.voucherType as VoucherType,
      pointOfSale: input.pointOfSale,
      number: input.number,
      fullNumber,
      issueDate: input.issueDate,
      dueDate: input.dueDate || null,
      cae: input.cae || null,
      purchaseOrderId: input.purchaseOrderId || null,
      subtotal,
      netTaxed: subtotal,
      netNonTaxed: 0,
      netExempt: 0,
      vatAmount,
      internalTaxes,
      otherTaxes,
      total,
      notes: input.notes || null,
      lines: { create: linesData },
      perceptions: { create: perceptionsData },
    },
  });
}
