import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import type { CreatePaymentOrderFormData } from '@/modules/commercial/features/treasury/shared/validators';
import { BusinessError } from '@/shared/lib/action-result';
import { normalizePaymentFunds } from '../payment-funds';

/**
 * Escritura de los datos editables de una orden de pago (TSK-792). Vive fuera del
 * archivo `'use server'` de órdenes de pago porque recibe una transacción: exportada
 * desde ahí sería un server action público sin permisos.
 */

const distinct = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => Boolean(id))),
];

/** Cheque de tercero a endosar: solo si el pago es de un cheque de tercero (igual que el alta). */
const endorsedCheckIdOf = (payment: CreatePaymentOrderFormData['payments'][number]) =>
  payment.checkOwnership === 'THIRD_PARTY' ? payment.endorsedCheckId || null : null;

/**
 * Filas de las retenciones de una OP, para el alta y para la edición. Régimen, base y
 * jurisdicción (TSK-813) son opcionales; la jurisdicción solo aplica a IIBB.
 */
export function paymentOrderWithholdingRows(
  paymentOrderId: string,
  withholdings: CreatePaymentOrderFormData['withholdings']
): Prisma.PaymentOrderWithholdingCreateManyInput[] {
  return withholdings.map((w) => ({
    paymentOrderId,
    taxType: w.taxType,
    rate: new Prisma.Decimal(w.rate),
    amount: new Prisma.Decimal(w.amount),
    certificateNumber: w.certificateNumber || null,
    regimeCode: w.regimeCode || null,
    taxableBase: w.taxableBase ? new Prisma.Decimal(w.taxableBase) : null,
    jurisdiction: w.taxType === 'IIBB' ? w.jurisdiction || null : null,
  }));
}

/**
 * Los datos llegan del cliente (edición de borrador o propuesta del motor): la OP, el
 * proveedor, las facturas, los gastos, las cajas, las cuentas bancarias, las
 * tarjetas y los cheques a endosar tienen que ser de la empresa, y las facturas, del
 * proveedor de la OP.
 */
async function assertPaymentOrderReferencesTx(
  tx: Tx,
  companyId: string,
  paymentOrderId: string,
  input: CreatePaymentOrderFormData
): Promise<void> {
  const supplierId = input.supplierId || null;
  const invoiceIds = distinct(input.items.map((item) => item.invoiceId));
  const expenseIds = distinct(input.items.map((item) => item.expenseId));
  const cashRegisterIds = distinct(input.payments.map((p) => p.cashRegisterId));
  const bankAccountIds = distinct(input.payments.map((p) => p.bankAccountId));
  const cardIds = distinct(input.payments.map((p) => p.cardId));
  const checkIds = distinct(input.payments.map(endorsedCheckIdOf));

  const [orders, suppliers, invoices, expenses, cashRegisters, bankAccounts, cards, checks] =
    await Promise.all([
      tx.paymentOrder.count({ where: { id: paymentOrderId, companyId } }),
      supplierId ? tx.supplier.count({ where: { id: supplierId, companyId } }) : Promise.resolve(1),
      tx.purchaseInvoice.count({
        where: { id: { in: invoiceIds }, companyId, ...(supplierId ? { supplierId } : {}) },
      }),
      tx.expense.count({ where: { id: { in: expenseIds }, companyId } }),
      tx.cashRegister.count({ where: { id: { in: cashRegisterIds }, companyId } }),
      tx.bankAccount.count({ where: { id: { in: bankAccountIds }, companyId } }),
      tx.card.count({ where: { id: { in: cardIds }, companyId } }),
      tx.check.count({ where: { id: { in: checkIds }, companyId } }),
    ]);

  if (orders === 0) throw new BusinessError('Orden de pago no encontrada');
  if (suppliers === 0) throw new BusinessError('El proveedor no existe en la empresa');
  if (invoices !== invoiceIds.length) {
    throw new BusinessError('Alguna de las facturas no es del proveedor de la orden o no existe');
  }
  if (expenses !== expenseIds.length) {
    throw new BusinessError('Alguno de los gastos no existe en la empresa');
  }
  if (cashRegisters !== cashRegisterIds.length) {
    throw new BusinessError('Alguna de las cajas no existe en la empresa');
  }
  if (bankAccounts !== bankAccountIds.length) {
    throw new BusinessError('Alguna de las cuentas bancarias no existe en la empresa');
  }
  if (cards !== cardIds.length) {
    throw new BusinessError('Alguna de las tarjetas no existe en la empresa');
  }
  if (checks !== checkIds.length) {
    throw new BusinessError('Alguno de los cheques a endosar no existe en la empresa');
  }
}

/**
 * Escribe los datos editables de la OP dentro de la transacción del llamador:
 * proveedor, fecha, notas y total, y reemplaza items, pagos y retenciones. Mantiene
 * number/fullNumber/createdBy. No mira el estado ni mueve fondos: lo usan
 * `updatePaymentOrder` (borrador) y el motor de corrección, que revierte los efectos
 * ANTES de esta escritura (el revert ubica los cheques por el id del pago, que acá se
 * recrea) y los reaplica después. Rechaza referencias ajenas a la empresa.
 */
export async function writePaymentOrderDataTx(
  tx: Tx,
  companyId: string,
  paymentOrderId: string,
  rawInput: CreatePaymentOrderFormData
): Promise<void> {
  // Solo la caja/banco que usa cada medio: el formulario arrastra los de otro medio (TSK-735).
  const input = { ...rawInput, payments: rawInput.payments.map(normalizePaymentFunds) };
  await assertPaymentOrderReferencesTx(tx, companyId, paymentOrderId, input);

  const totalCents = input.items.reduce(
    (sum, item) => sum + Math.round(parseFloat(item.amount) * 100),
    0
  );

  await tx.paymentOrder.update({
    where: { id: paymentOrderId, companyId },
    data: {
      supplierId: input.supplierId || null,
      date: input.date,
      totalAmount: new Prisma.Decimal(totalCents).div(100),
      notes: input.notes || null,
    },
  });

  await tx.paymentOrderItem.deleteMany({ where: { paymentOrderId } });
  await tx.paymentOrderPayment.deleteMany({ where: { paymentOrderId } });
  await tx.paymentOrderWithholding.deleteMany({ where: { paymentOrderId } });

  if (input.items.length > 0) {
    await tx.paymentOrderItem.createMany({
      data: input.items.map((item) => ({
        paymentOrderId,
        invoiceId: item.invoiceId || null,
        expenseId: item.expenseId || null,
        amount: new Prisma.Decimal(item.amount),
      })),
    });
  }

  if (input.payments.length > 0) {
    await tx.paymentOrderPayment.createMany({
      data: input.payments.map((payment) => ({
        paymentOrderId,
        paymentMethod: payment.paymentMethod,
        amount: new Prisma.Decimal(payment.amount),
        cashRegisterId: payment.cashRegisterId || null,
        bankAccountId: payment.bankAccountId || null,
        checkNumber: payment.checkNumber || null,
        cardLast4: payment.cardLast4 || null,
        cardId: payment.cardId || null,
        installmentsCount:
          payment.paymentMethod === 'CREDIT_CARD' ? (payment.installmentsCount ?? null) : null,
        reference: payment.reference || null,
        checkBankName: payment.checkBankName || null,
        checkIssueDate: payment.checkIssueDate || null,
        checkDueDate: payment.checkDueDate || null,
        checkDrawerName: payment.checkDrawerName || null,
        checkDrawerTaxId: payment.checkDrawerTaxId || null,
        endorsedCheckId: endorsedCheckIdOf(payment),
      })),
    });
  }

  if (input.withholdings && input.withholdings.length > 0) {
    await tx.paymentOrderWithholding.createMany({ data: paymentOrderWithholdingRows(paymentOrderId, input.withholdings) });
  }
}
