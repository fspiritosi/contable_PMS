import 'server-only';

import type { Tx } from '@/modules/accounting/features/integrations/core';
import { buildSalesInvoiceAmounts } from '@/modules/commercial/features/sales/features/invoices/shared/totals';
import type { CreateInvoiceInput } from '@/modules/commercial/features/sales/features/invoices/shared/types';
import { BusinessError } from '@/shared/lib/action-result';

/**
 * Escritura de los datos editables de una factura de venta (TSK-792). Vive fuera del
 * archivo `'use server'` de facturas porque recibe una transacción: exportada desde
 * ahí sería un server action público sin permisos.
 */

/**
 * Datos de la factura validados con `createInvoiceSchema`. El schema no trae el
 * número; si el llamador lo manda (lo que ve el usuario en la edición), tiene que
 * ser el que ya tiene la factura.
 */
export type SalesInvoiceDataInput = CreateInvoiceInput & { number?: number };

const FIXED_FIELDS_MESSAGE =
  'El punto de venta, el tipo y el número de una factura de venta no se pueden modificar.';

const distinct = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => Boolean(id))),
];

/**
 * La numeración es correlativa por punto de venta y tipo (spec §4.2): esos tres
 * campos quedan fijos. Los datos llegan del cliente (edición de borrador o propuesta
 * del motor): la factura, el cliente, los ítems y los centros de costo tienen que ser
 * de la empresa.
 */
async function assertSalesInvoiceReferencesTx(
  tx: Tx,
  companyId: string,
  invoiceId: string,
  input: SalesInvoiceDataInput
): Promise<void> {
  const productIds = distinct(input.lines.map((line) => line.productId));
  const costCenterIds = distinct(
    input.lines.flatMap((line) => (line.costCenterAllocations ?? []).map((a) => a.costCenterId))
  );

  const [invoice, customers, products, costCenters] = await Promise.all([
    tx.salesInvoice.findFirst({
      where: { id: invoiceId, companyId },
      select: { pointOfSaleId: true, voucherType: true, number: true },
    }),
    tx.contractor.count({ where: { id: input.customerId, companyId } }),
    tx.product.count({ where: { id: { in: productIds }, companyId } }),
    tx.costCenter.count({ where: { id: { in: costCenterIds }, companyId } }),
  ]);

  if (!invoice) throw new BusinessError('Factura no encontrada');
  if (
    input.pointOfSaleId !== invoice.pointOfSaleId ||
    input.voucherType !== invoice.voucherType ||
    (input.number !== undefined && input.number !== invoice.number)
  ) {
    throw new BusinessError(FIXED_FIELDS_MESSAGE);
  }
  if (customers === 0) throw new BusinessError('El cliente no existe en la empresa');
  if (products !== productIds.length) {
    throw new BusinessError('Alguno de los ítems no existe en la empresa');
  }
  if (costCenters !== costCenterIds.length) {
    throw new BusinessError('Alguno de los centros de costo no existe en la empresa');
  }
}

/**
 * Escribe los datos editables de la factura dentro de la transacción del llamador:
 * cliente, fechas, notas, descuentos e importes, y reemplaza líneas (con su reparto
 * por centro de costo) y percepciones. Mantiene punto de venta, tipo, número, estado,
 * asiento, CAE, factura original y createdBy. No mira el estado ni aplica efectos: lo
 * usan `updateInvoice` (borrador) y el motor de corrección, que revierte y reaplica
 * los efectos alrededor de esta escritura. Rechaza referencias ajenas a la empresa y
 * cambios de los campos fijos.
 */
export async function writeSalesInvoiceDataTx(
  tx: Tx,
  companyId: string,
  invoiceId: string,
  input: SalesInvoiceDataInput
): Promise<void> {
  await assertSalesInvoiceReferencesTx(tx, companyId, invoiceId, input);

  const { linesData, perceptionsData, amounts } = buildSalesInvoiceAmounts(input);

  // Eliminar líneas existentes: el cascade también borra su reparto por
  // centro de costo (SalesInvoiceLineCostCenter.onDelete: Cascade).
  await tx.salesInvoiceLine.deleteMany({ where: { invoiceId } });

  // Las percepciones se reemplazan enteras, no se reconcilian fila por
  // fila (TSK-644).
  await tx.salesInvoicePerception.deleteMany({ where: { invoiceId } });

  await tx.salesInvoice.update({
    where: { id: invoiceId, companyId },
    data: {
      customerId: input.customerId,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      ...amounts,
      notes: input.notes,
      internalNotes: input.internalNotes,
      lines: { create: linesData },
      perceptions: { create: perceptionsData },
    },
  });
}
