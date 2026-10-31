import 'server-only';

import {
  createJournalEntryForReceipt,
  type DocumentEntryOptions,
} from '@/modules/accounting/features/integrations/commercial';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import { CHECK_STATUS_LABELS } from '@/modules/commercial/features/treasury/shared/validators';
import { BusinessError } from '@/shared/lib/action-result';
import { logger } from '@/shared/lib/logger';

import { dedupeImpediments, impediments } from '../correction/impediments';
import type { Impediment } from '../correction/types';
import { recomputeSalesInvoiceStatusTx } from './document-status.server';
import type { EffectsCtx, EffectsResult } from './types';

/**
 * Efectos de un recibo de cobro (TSK-792): lo que el RC mueve fuera de sí mismo al
 * confirmarse (estado de las facturas, caja, banco, cheques de terceros y asiento)
 * y su inversa exacta.
 *
 * Los vínculos de trazabilidad (`CashMovement.receiptId`,
 * `BankMovement.documentLink = CREATED_BY_DOCUMENT`, `Check.receiptPaymentId`) los
 * escribe `apply` y los usa `revert` para encontrar exactamente lo que se creó.
 */

interface PaymentEffectShape {
  paymentMethod: string;
  cashRegisterId: string | null;
  bankAccountId: string | null;
  checkNumber: string | null;
}

/** El cobro crea un `CashMovement` (INCOME) al confirmar el RC. */
export const createsCashMovement = (payment: PaymentEffectShape) => Boolean(payment.cashRegisterId);

/** El cobro crea un `BankMovement` (DEPOSIT). El e-cheq NO acredita el saldo hasta que se cobra. */
export const createsBankMovement = (payment: PaymentEffectShape) =>
  !payment.cashRegisterId && Boolean(payment.bankAccountId) && payment.paymentMethod !== 'ECHEQ';

/** El cobro crea un cheque de tercero en cartera. */
export const createsCheck = (payment: PaymentEffectShape) =>
  (payment.paymentMethod === 'CHECK' || payment.paymentMethod === 'ECHEQ') &&
  Boolean(payment.checkNumber);

/**
 * Lo que hace la confirmación del RC dentro de la transacción salvo el cambio de
 * estado: recalcula las facturas cobradas, crea los movimientos de caja/banco y los
 * cheques de terceros y genera el asiento. Espera el RC ya en CONFIRMED.
 *
 * Con `opts.rewriteEntryId` reescribe ese asiento (DRAFT) conservando su número en
 * vez de crear uno nuevo.
 */
export async function applyReceiptEffectsTx(
  tx: Tx,
  ctx: EffectsCtx,
  receiptId: string,
  opts?: DocumentEntryOptions
): Promise<EffectsResult> {
  const { companyId, userId } = ctx;
  const receipt = await tx.receipt.findFirst({
    where: { id: receiptId, companyId },
    select: {
      date: true,
      fullNumber: true,
      customerId: true,
      items: { select: { invoiceId: true } },
      // El nombre de la caja es para el error de sesión (TSK-728)
      payments: { include: { cashRegister: { select: { name: true } } } },
    },
  });
  if (!receipt) {
    throw new BusinessError('Recibo no encontrado');
  }

  // 2. Actualizar estado de facturas
  for (const item of receipt.items) {
    await recomputeSalesInvoiceStatusTx(tx, item.invoiceId);
  }

  // Cuenta con la que ingresan los cheques recibidos (TSK-735): la misma del Debe del asiento.
  // Si falta, el asiento de abajo bloquea la confirmación con su mensaje.
  const checksReceivedAccountId = receipt.payments.some(createsCheck)
    ? ((
        await tx.accountingSettings.findUnique({
          where: { companyId },
          select: { checksReceivedAccountId: true },
        })
      )?.checksReceivedAccountId ?? null)
    : null;

  // 3. Crear movimientos de caja/banco según formas de pago
  for (const payment of receipt.payments) {
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

      // Movimiento de caja
      await tx.cashMovement.create({
        data: {
          companyId,
          cashRegisterId: payment.cashRegisterId,
          sessionId: activeSession.id,
          receiptId,
          type: 'INCOME',
          amount: payment.amount,
          date: receipt.date,
          description: `Cobro de ${receipt.fullNumber}`,
          reference: receipt.fullNumber,
          createdBy: userId,
        },
      });

      // Actualizar saldo esperado de la sesión
      await tx.cashRegisterSession.update({
        where: { id: activeSession.id },
        data: {
          expectedBalance: {
            increment: payment.amount,
          },
        },
      });
    } else if (createsBankMovement(payment) && payment.bankAccountId) {
      // Movimiento bancario (el e-cheq NO acredita el saldo hasta que se cobra/acredita el cheque)
      const bankAccount = await tx.bankAccount.findUnique({
        where: { id: payment.bankAccountId },
        select: { balance: true },
      });

      if (bankAccount) {
        await tx.bankMovement.create({
          data: {
            companyId,
            bankAccountId: payment.bankAccountId,
            type: 'DEPOSIT',
            amount: payment.amount,
            date: receipt.date,
            description: `Cobro de ${receipt.fullNumber}`,
            reference: receipt.fullNumber,
            receiptId,
            documentLink: 'CREATED_BY_DOCUMENT',
            reconciled: true,
            reconciledAt: new Date(),
            reconciledBy: userId,
            createdBy: userId,
          },
        });

        // Actualizar saldo
        await tx.bankAccount.update({
          where: { id: payment.bankAccountId },
          data: {
            balance: bankAccount.balance.add(payment.amount),
          },
        });
      }
    }

    // 3b. Si el pago es con cheque o e-cheq, crear registro Check como THIRD_PARTY en PORTFOLIO
    if (createsCheck(payment) && payment.checkNumber) {
      const isEcheq = payment.paymentMethod === 'ECHEQ';
      await tx.check.create({
        data: {
          companyId,
          type: 'THIRD_PARTY',
          status: 'PORTFOLIO',
          isElectronic: isEcheq,
          checkNumber: payment.checkNumber,
          bankName: payment.checkBankName || payment.reference || 'Sin especificar',
          amount: payment.amount,
          issueDate: payment.checkIssueDate ?? receipt.date,
          dueDate: payment.checkDueDate ?? receipt.date,
          drawerName: payment.checkDrawerName || 'Cliente',
          drawerTaxId: payment.checkDrawerTaxId || null,
          customerId: receipt.customerId,
          // e-cheq: cuenta bancaria donde ingresó (cuenta de depósito)
          bankAccountId: isEcheq ? payment.bankAccountId : null,
          // Valores a depositar: contra ella se descarga al depositar o endosar (TSK-735)
          accountId: checksReceivedAccountId,
          receiptPaymentId: payment.id,
          createdBy: userId,
        },
      });
    }
  }

  // Crear asiento contable. Si falla, la transacción entera se revierte.
  // TSK-728: antes solo se relanzaba "período cerrado" y cualquier otro fallo
  // dejaba el recibo confirmado sin asiento.
  const journalEntryId = await createJournalEntryForReceipt(receiptId, companyId, tx, opts);
  await tx.receipt.update({
    where: { id: receiptId },
    data: { journalEntryId },
  });

  logger.info('Asiento contable generado para recibo de cobro', {
    data: { receiptId, journalEntryId, rewritten: Boolean(opts?.rewriteEntryId) },
  });

  return { journalEntryId };
}

/**
 * Inversa exacta de `applyReceiptEffectsTx`, sin tocar el asiento ni el estado del
 * RC (los decide el motor de corrección):
 * - Banco: borra los DEPOSIT creados por el RC y les resta el importe al saldo.
 * - Caja: borra los INCOME del RC y les resta el importe al saldo esperado de la sesión.
 * - Cheques: borra los de terceros que recibió el RC y siguen en cartera.
 * - Al final, recalcula el estado de cada factura cobrada.
 *
 * No valida que los efectos sigan revertibles: eso lo anticipa
 * `receiptEffectImpedimentsTx`, que el llamador consulta antes.
 */
export async function revertReceiptEffectsTx(
  tx: Tx,
  ctx: EffectsCtx,
  receiptId: string
): Promise<void> {
  const { companyId } = ctx;
  const receipt = await tx.receipt.findFirst({
    where: { id: receiptId, companyId },
    select: {
      items: { select: { invoiceId: true } },
      payments: { select: { id: true } },
    },
  });
  if (!receipt) {
    throw new BusinessError('Recibo no encontrado');
  }
  const paymentIds = receipt.payments.map((p) => p.id);

  // Banco: solo lo que creó el RC (los vinculados a mano no se tocan).
  const bankMovements = await tx.bankMovement.findMany({
    where: { companyId, receiptId, type: 'DEPOSIT', documentLink: 'CREATED_BY_DOCUMENT' },
    select: { id: true, bankAccountId: true, amount: true },
  });
  for (const movement of bankMovements) {
    await tx.bankAccount.update({
      where: { id: movement.bankAccountId },
      data: { balance: { decrement: movement.amount } },
    });
  }
  if (bankMovements.length > 0) {
    await tx.bankMovement.deleteMany({ where: { id: { in: bankMovements.map((m) => m.id) } } });
  }

  // Caja
  const cashMovements = await tx.cashMovement.findMany({
    where: { companyId, receiptId, type: 'INCOME' },
    select: { id: true, sessionId: true, amount: true },
  });
  for (const movement of cashMovements) {
    await tx.cashRegisterSession.update({
      where: { id: movement.sessionId },
      data: { expectedBalance: { decrement: movement.amount } },
    });
  }
  if (cashMovements.length > 0) {
    await tx.cashMovement.deleteMany({ where: { id: { in: cashMovements.map((m) => m.id) } } });
  }

  // Cheques de terceros recibidos que siguen en cartera
  if (paymentIds.length > 0) {
    await tx.check.deleteMany({
      where: {
        companyId,
        type: 'THIRD_PARTY',
        status: 'PORTFOLIO',
        receiptPaymentId: { in: paymentIds },
      },
    });
  }

  for (const item of receipt.items) {
    await recomputeSalesInvoiceStatusTx(tx, item.invoiceId);
  }
}

/**
 * Impedimentos propios de los efectos del RC, sin mirar el asiento ni el período:
 * efectos que ya se usaron (caja cerrada, cheque depositado o endosado), vínculos
 * hechos a mano o efectos que no se pueden ubicar con certeza. Cada impedimento
 * aparece una sola vez aunque lo causen varios registros.
 */
export async function receiptEffectImpedimentsTx(
  tx: Tx,
  receiptId: string,
  docLabel: string
): Promise<Impediment[]> {
  const receipt = await tx.receipt.findUnique({
    where: { id: receiptId },
    select: {
      status: true,
      payments: {
        select: {
          id: true,
          paymentMethod: true,
          cashRegisterId: true,
          bankAccountId: true,
          checkNumber: true,
        },
      },
    },
  });
  if (!receipt) return [];
  const paymentIds = receipt.payments.map((p) => p.id);

  const [cashMovements, checks, bankMovements] = await Promise.all([
    tx.cashMovement.findMany({
      where: { receiptId, type: 'INCOME' },
      select: { session: { select: { status: true } }, cashRegister: { select: { name: true } } },
    }),
    tx.check.findMany({
      where: { receiptPaymentId: { in: paymentIds } },
      select: {
        status: true,
        bankName: true,
        checkNumber: true,
        paymentOrderPayment: { select: { paymentOrder: { select: { fullNumber: true } } } },
      },
    }),
    tx.bankMovement.findMany({
      where: { receiptId },
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
    if (check.status === 'PORTFOLIO') continue;
    const checkLabel = `${check.bankName} ${check.checkNumber}`;
    const endorsingOrder = check.paymentOrderPayment?.paymentOrder.fullNumber;
    if (check.status === 'ENDORSED' && endorsingOrder) {
      found.push(impediments.checkEndorsedInOtherOp(checkLabel, endorsingOrder));
    } else {
      // Depositado, acreditado, rechazado, anulado o endosado fuera de una OP: revertir
      // no lo borra (solo borra los que siguen en cartera) y reaplicar lo duplicaría.
      found.push(impediments.checkUsed(checkLabel, CHECK_STATUS_LABELS[check.status]));
    }
  }

  if (bankMovements.some((m) => m.documentLink === 'MANUAL_LINK')) {
    found.push(impediments.bankMovementManualLink(docLabel));
  }
  // Movimiento que no se puede ubicar con certeza (§4.5): banco sin marca de origen, o un
  // RC confirmado con menos movimientos o cheques vinculados que cobros que los crean
  // (anterior a la trazabilidad o desvinculado a mano con `unlinkBankMovementFromDocument`,
  // que borra el vínculo). Revertir no los encontraría y reaplicar duplicaría el efecto.
  const isConfirmed = receipt.status === 'CONFIRMED';
  const bankByDocument = bankMovements.filter(
    (m) => m.documentLink === 'CREATED_BY_DOCUMENT'
  ).length;
  const bankUntraceable =
    bankMovements.some((m) => m.documentLink === null) ||
    (isConfirmed && bankByDocument < receipt.payments.filter(createsBankMovement).length);
  const cashUntraceable =
    isConfirmed && cashMovements.length < receipt.payments.filter(createsCashMovement).length;
  const checksUntraceable =
    isConfirmed && checks.length < receipt.payments.filter(createsCheck).length;

  if (bankUntraceable || cashUntraceable || checksUntraceable) {
    found.push(impediments.untraceable(docLabel));
  }

  return dedupeImpediments(found);
}
