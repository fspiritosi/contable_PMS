import 'server-only';

import moment from 'moment';

import { Prisma } from '@/generated/prisma/client';
import {
  createJournalEntryForPaymentOrder,
  type DocumentEntryOptions,
} from '@/modules/accounting/features/integrations/commercial';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import { CHECK_STATUS_LABELS } from '@/modules/commercial/features/treasury/shared/validators';
import { BusinessError } from '@/shared/lib/action-result';
import { logger } from '@/shared/lib/logger';

import { dedupeImpediments, impediments } from '../correction/impediments';
import type { Impediment } from '../correction/types';
import {
  recomputeExpenseStatusTx,
  recomputePurchaseInvoiceStatusTx,
} from './document-status.server';
import type { EffectsCtx, EffectsResult } from './types';

/**
 * Efectos de una orden de pago (TSK-792): lo que la OP mueve fuera de sí misma al
 * confirmarse (estado de facturas y gastos, caja, banco, cheques, cuotas de
 * tarjeta, cuotas de socio y asiento) y su inversa exacta.
 *
 * Los vínculos de trazabilidad (`CashMovement.paymentOrderId`,
 * `BankMovement.documentLink = CREATED_BY_DOCUMENT`,
 * `CashflowProjection.paymentOrderInstallmentId`) los escribe `apply` y los usa
 * `revert` para encontrar exactamente lo que se creó.
 */

/** Pago con tarjeta de un socio: la empresa no mueve plata ahora (el socio adelantó el pago). */
const isPartnerCardPayment = (payment: { card: { ownerType: string } | null }) =>
  payment.card?.ownerType === 'PARTNER';

interface PaymentMovementShape {
  paymentMethod: string;
  cashRegisterId: string | null;
  bankAccountId: string | null;
  card: { ownerType: string } | null;
}

/** El pago crea un `CashMovement` al confirmar la OP. */
const createsCashMovement = (payment: PaymentMovementShape) =>
  !isPartnerCardPayment(payment) && Boolean(payment.cashRegisterId);

/** El pago crea un `BankMovement` al confirmar la OP. El e-cheq NO debita el saldo hasta que el cheque se debita/cobra. */
const createsBankMovement = (payment: PaymentMovementShape) =>
  !isPartnerCardPayment(payment) &&
  !payment.cashRegisterId &&
  Boolean(payment.bankAccountId) &&
  payment.paymentMethod !== 'ECHEQ';

/** Recalcula el estado de cada factura y gasto imputado por la OP (solo cuentan las OP CONFIRMED). */
async function recomputeImputedDocumentsTx(
  tx: Tx,
  items: { invoiceId: string | null; expenseId: string | null }[]
): Promise<void> {
  for (const item of items) {
    if (item.invoiceId) {
      await recomputePurchaseInvoiceStatusTx(tx, item.invoiceId);
    } else if (item.expenseId) {
      await recomputeExpenseStatusTx(tx, item.expenseId);
    }
  }
}

/**
 * Lo que hace la confirmación de la OP dentro de la transacción salvo el cambio de
 * estado: recalcula facturas y gastos, crea movimientos de caja/banco, cheques,
 * cuotas de tarjeta con sus proyecciones, salda las cuotas de socio y genera el
 * asiento (solo OP a proveedor). Espera la OP ya en CONFIRMED.
 *
 * Con `opts.rewriteEntryId` reescribe ese asiento (DRAFT) conservando su número
 * en vez de crear uno nuevo.
 */
export async function applyPaymentOrderEffectsTx(
  tx: Tx,
  ctx: EffectsCtx,
  paymentOrderId: string,
  opts?: DocumentEntryOptions
): Promise<EffectsResult> {
  const { companyId, userId } = ctx;
  const paymentOrder = await tx.paymentOrder.findFirst({
    where: { id: paymentOrderId, companyId },
    select: {
      date: true,
      fullNumber: true,
      supplierId: true,
      partnerId: true,
      items: { select: { invoiceId: true, expenseId: true } },
      // El nombre de la caja es para el error de sesión (TSK-728)
      payments: {
        include: { card: true, cashRegister: { select: { name: true } } },
      },
      supplier: { select: { businessName: true, taxId: true } },
    },
  });
  if (!paymentOrder) {
    throw new BusinessError('Orden de pago no encontrada');
  }

  // 2. Actualizar estado de facturas y gastos
  await recomputeImputedDocumentsTx(tx, paymentOrder.items);

  // 3. Crear movimientos de caja/banco según formas de pago
  for (const payment of paymentOrder.payments) {
    // Si se pagó con la tarjeta de un socio, la empresa NO mueve plata ahora:
    // el socio adelantó el pago. El egreso ocurre al devolverle (OP de devolución).
    if (isPartnerCardPayment(payment)) {
      continue;
    }

    if (createsCashMovement(payment) && payment.cashRegisterId) {
      // Obtener sesión activa de la caja
      const activeSession = await tx.cashRegisterSession.findFirst({
        where: {
          cashRegisterId: payment.cashRegisterId,
          status: 'OPEN',
        },
        select: { id: true },
      });

      if (!activeSession) {
        throw new BusinessError(
          `No hay sesión abierta para la caja "${payment.cashRegister?.name ?? 'seleccionada'}"`
        );
      }

      // Movimiento de caja (EXPENSE)
      await tx.cashMovement.create({
        data: {
          companyId,
          cashRegisterId: payment.cashRegisterId,
          sessionId: activeSession.id,
          paymentOrderId,
          type: 'EXPENSE',
          amount: payment.amount,
          date: paymentOrder.date,
          description: `Pago de ${paymentOrder.fullNumber}`,
          reference: paymentOrder.fullNumber,
          createdBy: userId,
        },
      });

      // Actualizar saldo esperado de la sesión (restar)
      await tx.cashRegisterSession.update({
        where: { id: activeSession.id },
        data: {
          expectedBalance: {
            decrement: payment.amount,
          },
        },
      });
    } else if (createsBankMovement(payment) && payment.bankAccountId) {
      // Movimiento bancario (WITHDRAWAL).
      const bankAccount = await tx.bankAccount.findUnique({
        where: { id: payment.bankAccountId },
        select: { balance: true },
      });

      if (bankAccount) {
        await tx.bankMovement.create({
          data: {
            companyId,
            bankAccountId: payment.bankAccountId,
            type: 'WITHDRAWAL',
            amount: payment.amount,
            date: paymentOrder.date,
            description: `Pago de ${paymentOrder.fullNumber}`,
            reference: paymentOrder.fullNumber,
            paymentOrderId,
            documentLink: 'CREATED_BY_DOCUMENT',
            reconciled: true,
            reconciledAt: new Date(),
            reconciledBy: userId,
            createdBy: userId,
          },
        });

        // Actualizar saldo (restar)
        await tx.bankAccount.update({
          where: { id: payment.bankAccountId },
          data: {
            balance: bankAccount.balance.sub(payment.amount),
          },
        });
      }
    }

    // 3b. Cheque o e-cheq como medio de pago
    if (payment.paymentMethod === 'CHECK' || payment.paymentMethod === 'ECHEQ') {
      if (payment.endorsedCheckId) {
        // Cheque/e-cheq DE TERCEROS: se endosa un cheque en cartera al proveedor
        const endorsed = await tx.check.findFirst({
          where: {
            id: payment.endorsedCheckId,
            companyId,
            type: 'THIRD_PARTY',
            status: 'PORTFOLIO',
          },
          select: { id: true },
        });
        if (!endorsed) {
          throw new BusinessError(
            'El cheque de tercero seleccionado ya no está disponible en cartera'
          );
        }
        await tx.check.update({
          where: { id: endorsed.id },
          data: {
            status: 'ENDORSED',
            endorsedToName: paymentOrder.supplier?.businessName || 'Proveedor',
            endorsedToTaxId: paymentOrder.supplier?.taxId || null,
            endorsedAt: paymentOrder.date,
            supplierId: paymentOrder.supplierId,
            paymentOrderPaymentId: payment.id,
          },
        });
      } else if (payment.checkNumber) {
        // Cheque/e-cheq PROPIO: se emite un cheque nuevo
        const isEcheq = payment.paymentMethod === 'ECHEQ';
        await tx.check.create({
          data: {
            companyId,
            type: 'OWN',
            status: 'DELIVERED',
            isElectronic: isEcheq,
            checkNumber: payment.checkNumber,
            bankName: payment.checkBankName || payment.reference || 'Sin especificar',
            amount: payment.amount,
            issueDate: payment.checkIssueDate ?? paymentOrder.date,
            dueDate: payment.checkDueDate ?? paymentOrder.date,
            drawerName: payment.checkDrawerName || 'Empresa',
            drawerTaxId: payment.checkDrawerTaxId || null,
            supplierId: paymentOrder.supplierId,
            // e-cheq propio: cuenta bancaria desde la que se emite
            bankAccountId: isEcheq ? payment.bankAccountId : null,
            paymentOrderPaymentId: payment.id,
            createdBy: userId,
          },
        });
      }
    }
  }

  // 3c. Tarjetas: generar el cronograma de cuotas (la deuda).
  //  - Crédito (empresa o socio): N cuotas mensuales.
  //  - Débito de un socio: 1 cuota (la empresa le debe el total al socio).
  //  - Débito de empresa: nada (el dinero ya salió del banco en el paso 3).
  // Si la tarjeta es de un socio, la cuota queda asociada a él (partnerId) y representa
  // lo que la empresa le debe; se salda con una OP de devolución.
  for (const payment of paymentOrder.payments) {
    if (!payment.card) continue;
    const card = payment.card;
    const isPartnerCard = card.ownerType === 'PARTNER' && Boolean(card.partnerId);
    const paymentAmount = Number(payment.amount);

    let installmentsCount = 0;
    if (payment.paymentMethod === 'CREDIT_CARD') {
      installmentsCount = Math.max(1, payment.installmentsCount ?? 1);
    } else if (payment.paymentMethod === 'DEBIT_CARD' && isPartnerCard) {
      installmentsCount = 1;
    }
    if (installmentsCount === 0) continue;

    // Reparto en centavos para que la suma cuadre exactamente con el total
    const totalCents = Math.round(paymentAmount * 100);
    const baseCents = Math.floor(totalCents / installmentsCount);
    const remainderCents = totalCents - baseCents * installmentsCount;

    for (let i = 1; i <= installmentsCount; i++) {
      const cents = baseCents + (i <= remainderCents ? 1 : 0);
      const amount = new Prisma.Decimal((cents / 100).toFixed(2));

      // Vencimiento: cuotas de crédito vencen i meses después; la cuota única de débito
      // de socio vence en la fecha de la OP (se le debe ya). Si la tarjeta tiene día de
      // vencimiento configurado, se ajusta a ese día del mes correspondiente.
      let dueDate =
        payment.paymentMethod === 'CREDIT_CARD'
          ? moment(paymentOrder.date).add(i, 'months')
          : moment(paymentOrder.date);
      if (card.dueDay) {
        dueDate = dueDate.date(Math.min(card.dueDay, dueDate.daysInMonth()));
      }

      const installment = await tx.paymentOrderInstallment.create({
        data: {
          companyId,
          paymentOrderId,
          cardId: card.id,
          partnerId: isPartnerCard ? card.partnerId : null,
          number: i,
          dueDate: dueDate.toDate(),
          amount,
          status: 'PENDING',
        },
      });

      // Proyección de cashflow (egreso futuro: pago a la tarjeta o devolución al socio)
      await tx.cashflowProjection.create({
        data: {
          companyId,
          type: 'EXPENSE',
          category: 'OTHER',
          description:
            installmentsCount > 1
              ? `Cuota ${i}/${installmentsCount} ${paymentOrder.fullNumber} — ${card.name}`
              : `${paymentOrder.fullNumber} — ${card.name}`,
          amount,
          date: dueDate.toDate(),
          status: 'PENDING',
          paymentOrderInstallmentId: installment.id,
          createdBy: userId,
        },
      });
    }
  }

  // 3d. OP de devolución a un socio: saldar las cuotas reservadas por esta OP.
  // La cuota pasa a PAID (deja de contar en el saldo del socio); el egreso real de
  // caja/banco ya se registró en el paso 3.
  if (paymentOrder.partnerId) {
    await tx.paymentOrderInstallment.updateMany({
      where: { settledByPaymentOrderId: paymentOrderId, status: 'PENDING' },
      data: { status: 'PAID', paidAt: paymentOrder.date },
    });
    // Las OP de devolución a socio no generan asiento de compra (seguimiento del plan 728, 2.4-4).
    return { journalEntryId: null };
  }

  // Asiento contable (solo OP a proveedor). Si falla, la transacción entera se
  // revierte. TSK-728: antes solo se relanzaba "período cerrado" y cualquier otro
  // fallo dejaba la OP confirmada sin asiento.
  const journalEntryId = await createJournalEntryForPaymentOrder(
    paymentOrderId,
    companyId,
    tx,
    opts
  );
  await tx.paymentOrder.update({
    where: { id: paymentOrderId },
    data: { journalEntryId },
  });

  logger.info('Asiento contable generado para orden de pago', {
    data: { paymentOrderId, journalEntryId, rewritten: Boolean(opts?.rewriteEntryId) },
  });

  return { journalEntryId };
}

/**
 * Inversa exacta de `applyPaymentOrderEffectsTx`, sin tocar el asiento ni el estado
 * de la OP (los decide el motor de corrección):
 * - Banco: borra los movimientos creados por la OP y devuelve el egreso al saldo.
 * - Caja: borra los movimientos de la OP y devuelve el egreso al saldo esperado de la sesión.
 * - Cheques: borra el propio entregado; el de tercero endosado vuelve a cartera sin datos de endoso.
 * - Cuotas: borra las de origen pendientes con sus proyecciones.
 * - OP de socio: las cuotas que saldó vuelven a pendientes.
 * - Al final, recalcula el estado de cada factura y gasto imputado.
 *
 * No valida que los efectos sigan revertibles: eso lo anticipa
 * `paymentOrderEffectImpedimentsTx`, que el llamador consulta antes.
 */
export async function revertPaymentOrderEffectsTx(
  tx: Tx,
  ctx: EffectsCtx,
  paymentOrderId: string
): Promise<void> {
  const { companyId } = ctx;
  const paymentOrder = await tx.paymentOrder.findFirst({
    where: { id: paymentOrderId, companyId },
    select: {
      partnerId: true,
      items: { select: { invoiceId: true, expenseId: true } },
      payments: { select: { id: true } },
    },
  });
  if (!paymentOrder) {
    throw new BusinessError('Orden de pago no encontrada');
  }
  const paymentIds = paymentOrder.payments.map((p) => p.id);

  // Banco: solo lo que creó la OP (los vinculados a mano no se tocan).
  const bankMovements = await tx.bankMovement.findMany({
    where: { companyId, paymentOrderId, documentLink: 'CREATED_BY_DOCUMENT' },
    select: { id: true, bankAccountId: true, amount: true },
  });
  for (const movement of bankMovements) {
    await tx.bankAccount.update({
      where: { id: movement.bankAccountId },
      data: { balance: { increment: movement.amount } },
    });
  }
  if (bankMovements.length > 0) {
    await tx.bankMovement.deleteMany({ where: { id: { in: bankMovements.map((m) => m.id) } } });
  }

  // Caja
  const cashMovements = await tx.cashMovement.findMany({
    where: { companyId, paymentOrderId },
    select: { id: true, sessionId: true, amount: true },
  });
  for (const movement of cashMovements) {
    await tx.cashRegisterSession.update({
      where: { id: movement.sessionId },
      data: { expectedBalance: { increment: movement.amount } },
    });
  }
  if (cashMovements.length > 0) {
    await tx.cashMovement.deleteMany({ where: { id: { in: cashMovements.map((m) => m.id) } } });
  }

  // Cheques
  if (paymentIds.length > 0) {
    await tx.check.deleteMany({
      where: {
        companyId,
        type: 'OWN',
        status: 'DELIVERED',
        paymentOrderPaymentId: { in: paymentIds },
      },
    });
    await tx.check.updateMany({
      where: {
        companyId,
        type: 'THIRD_PARTY',
        status: 'ENDORSED',
        paymentOrderPaymentId: { in: paymentIds },
      },
      data: {
        status: 'PORTFOLIO',
        endorsedToName: null,
        endorsedToTaxId: null,
        endorsedAt: null,
        supplierId: null,
        paymentOrderPaymentId: null,
      },
    });
  }

  // Cuotas de origen con sus proyecciones (la FK de la proyección es SET NULL: se borran antes).
  const installments = await tx.paymentOrderInstallment.findMany({
    where: { companyId, paymentOrderId, status: 'PENDING' },
    select: { id: true },
  });
  if (installments.length > 0) {
    const installmentIds = installments.map((i) => i.id);
    await tx.cashflowProjection.deleteMany({
      where: { paymentOrderInstallmentId: { in: installmentIds } },
    });
    await tx.paymentOrderInstallment.deleteMany({ where: { id: { in: installmentIds } } });
  }

  // OP de devolución a socio: las cuotas que saldó vuelven a pendientes (siguen reservadas por ella).
  if (paymentOrder.partnerId) {
    await tx.paymentOrderInstallment.updateMany({
      where: { settledByPaymentOrderId: paymentOrderId, status: 'PAID' },
      data: { status: 'PENDING', paidAt: null },
    });
  }

  await recomputeImputedDocumentsTx(tx, paymentOrder.items);
}

/**
 * Impedimentos propios de los efectos de la OP, sin mirar el asiento ni el período:
 * efectos que ya se usaron (caja cerrada, cheque usado, cuota pagada), vínculos
 * hechos a mano o efectos anteriores a la trazabilidad. Cada impedimento aparece
 * una sola vez aunque lo causen varios registros.
 */
export async function paymentOrderEffectImpedimentsTx(
  tx: Tx,
  paymentOrderId: string,
  docLabel: string
): Promise<Impediment[]> {
  const paymentOrder = await tx.paymentOrder.findUnique({
    where: { id: paymentOrderId },
    select: {
      status: true,
      payments: {
        select: {
          id: true,
          paymentMethod: true,
          cashRegisterId: true,
          bankAccountId: true,
          card: { select: { ownerType: true } },
        },
      },
    },
  });
  if (!paymentOrder) return [];
  const paymentIds = paymentOrder.payments.map((p) => p.id);

  const [cashMovements, checks, installments, bankMovements] = await Promise.all([
    tx.cashMovement.findMany({
      where: { paymentOrderId },
      select: { session: { select: { status: true } }, cashRegister: { select: { name: true } } },
    }),
    tx.check.findMany({
      where: { paymentOrderPaymentId: { in: paymentIds } },
      select: { type: true, status: true, bankName: true, checkNumber: true },
    }),
    tx.paymentOrderInstallment.findMany({
      where: { paymentOrderId },
      select: {
        status: true,
        projection: { select: { status: true, _count: { select: { documentLinks: true } } } },
      },
    }),
    tx.bankMovement.findMany({
      where: { paymentOrderId },
      select: { documentLink: true },
    }),
  ]);

  const found: Impediment[] = [];

  for (const movement of cashMovements) {
    if (movement.session.status === 'CLOSED') {
      found.push(impediments.cashSessionClosed(movement.cashRegister.name, docLabel));
    }
  }

  for (const check of checks) {
    const expected = check.type === 'OWN' ? 'DELIVERED' : 'ENDORSED';
    if (check.status !== expected) {
      found.push(
        impediments.checkUsed(
          `${check.bankName} ${check.checkNumber}`,
          CHECK_STATUS_LABELS[check.status]
        )
      );
    }
  }

  const installmentUsed = installments.some(
    (i) =>
      i.status === 'PAID' ||
      (i.projection !== null &&
        (i.projection.status !== 'PENDING' || i.projection._count.documentLinks > 0))
  );
  if (installmentUsed) found.push(impediments.installmentPaid(docLabel));

  if (bankMovements.some((m) => m.documentLink === 'MANUAL_LINK')) {
    found.push(impediments.bankMovementManualLink(docLabel));
  }
  // Movimiento que no se puede ubicar con certeza (§4.5): banco sin marca de origen, o una
  // OP confirmada con menos movimientos vinculados que pagos que los crean (anterior a la
  // trazabilidad o desvinculado a mano con `unlinkBankMovementFromDocument`, que borra el
  // vínculo). Revertir no los encontraría y reaplicar duplicaría el efecto.
  const isConfirmed = paymentOrder.status === 'CONFIRMED';
  const bankPayments = paymentOrder.payments.filter(createsBankMovement).length;
  const bankByDocument = bankMovements.filter(
    (m) => m.documentLink === 'CREATED_BY_DOCUMENT'
  ).length;
  const bankUntraceable =
    bankMovements.some((m) => m.documentLink === null) ||
    (isConfirmed && bankByDocument < bankPayments);
  const cashPayments = paymentOrder.payments.filter(createsCashMovement).length;
  const cashUntraceable = isConfirmed && cashMovements.length < cashPayments;

  if (bankUntraceable || cashUntraceable) found.push(impediments.untraceable(docLabel));

  return dedupeImpediments(found);
}
