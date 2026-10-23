import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import type { CreateReceiptFormData } from '@/modules/commercial/features/treasury/shared/validators';
import { BusinessError } from '@/shared/lib/action-result';

/**
 * Escritura de los datos editables de un recibo (TSK-792). Vive fuera del archivo
 * `'use server'` de recibos porque recibe una transacción: exportada desde ahí sería
 * un server action público sin permisos.
 */

const distinct = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => Boolean(id))),
];

/**
 * Los datos llegan del cliente (edición de borrador o propuesta del motor): el
 * recibo, el cliente, las facturas, las cajas y las cuentas bancarias tienen que ser
 * de la empresa, y las facturas de ese cliente.
 */
async function assertReceiptReferencesTx(
  tx: Tx,
  companyId: string,
  receiptId: string,
  input: CreateReceiptFormData
): Promise<void> {
  const invoiceIds = distinct(input.items.map((item) => item.invoiceId));
  const cashRegisterIds = distinct(input.payments.map((p) => p.cashRegisterId));
  const bankAccountIds = distinct(input.payments.map((p) => p.bankAccountId));

  const [receipts, customers, invoices, cashRegisters, bankAccounts] = await Promise.all([
    tx.receipt.count({ where: { id: receiptId, companyId } }),
    tx.contractor.count({ where: { id: input.customerId, companyId } }),
    tx.salesInvoice.count({
      where: { id: { in: invoiceIds }, companyId, customerId: input.customerId },
    }),
    tx.cashRegister.count({ where: { id: { in: cashRegisterIds }, companyId } }),
    tx.bankAccount.count({ where: { id: { in: bankAccountIds }, companyId } }),
  ]);

  if (receipts === 0) throw new BusinessError('Recibo no encontrado');
  if (customers === 0) throw new BusinessError('El cliente no existe en la empresa');
  if (invoices !== invoiceIds.length) {
    throw new BusinessError('Alguna de las facturas no es del cliente del recibo o no existe');
  }
  if (cashRegisters !== cashRegisterIds.length) {
    throw new BusinessError('Alguna de las cajas no existe en la empresa');
  }
  if (bankAccounts !== bankAccountIds.length) {
    throw new BusinessError('Alguna de las cuentas bancarias no existe en la empresa');
  }
}

/**
 * Escribe los datos editables del recibo dentro de la transacción del llamador:
 * cliente, fecha, notas y total, y reemplaza items, pagos y retenciones. Mantiene
 * number/fullNumber/createdBy. No mira el estado ni mueve fondos: lo usan
 * `updateReceipt` (borrador) y el motor de corrección, que revierte y reaplica los
 * efectos alrededor de esta escritura. Rechaza referencias ajenas a la empresa.
 */
export async function writeReceiptDataTx(
  tx: Tx,
  companyId: string,
  receiptId: string,
  input: CreateReceiptFormData
): Promise<void> {
  await assertReceiptReferencesTx(tx, companyId, receiptId, input);

  const totalCents = input.items.reduce(
    (sum, item) => sum + Math.round(parseFloat(item.amount) * 100),
    0
  );

  await tx.receipt.update({
    where: { id: receiptId, companyId },
    data: {
      customerId: input.customerId,
      date: input.date,
      totalAmount: new Prisma.Decimal(totalCents).div(100),
      notes: input.notes || null,
    },
  });

  await tx.receiptItem.deleteMany({ where: { receiptId } });
  await tx.receiptPayment.deleteMany({ where: { receiptId } });
  await tx.receiptWithholding.deleteMany({ where: { receiptId } });

  await tx.receiptItem.createMany({
    data: input.items.map((item) => ({
      receiptId,
      invoiceId: item.invoiceId,
      amount: new Prisma.Decimal(item.amount),
    })),
  });

  if (input.payments.length > 0) {
    await tx.receiptPayment.createMany({
      data: input.payments.map((payment) => ({
        receiptId,
        paymentMethod: payment.paymentMethod,
        amount: new Prisma.Decimal(payment.amount),
        cashRegisterId: payment.cashRegisterId || null,
        bankAccountId: payment.bankAccountId || null,
        checkNumber: payment.checkNumber || null,
        cardLast4: payment.cardLast4 || null,
        reference: payment.reference || null,
        // Metadata del cheque / e-cheq
        checkBankName: payment.checkBankName || null,
        checkIssueDate: payment.checkIssueDate || null,
        checkDueDate: payment.checkDueDate || null,
        checkDrawerName: payment.checkDrawerName || null,
        checkDrawerTaxId: payment.checkDrawerTaxId || null,
      })),
    });
  }

  if (input.withholdings.length > 0) {
    await tx.receiptWithholding.createMany({
      data: input.withholdings.map((w) => ({
        receiptId,
        taxType: w.taxType,
        rate: new Prisma.Decimal(w.rate),
        amount: new Prisma.Decimal(w.amount),
        certificateNumber: w.certificateNumber || null,
      })),
    });
  }
}
