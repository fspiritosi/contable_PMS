import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import {
  createJournalEntryTx,
  deleteDraftJournalEntryTx,
  reverseJournalEntryTx,
  type Tx,
} from '@/modules/accounting/features/integrations/core';
import {
  ACCOUNTING_SETTINGS_PATH,
  settingsAccountLabel,
} from '@/shared/lib/accounts/settings-account-labels';
import { BusinessError } from '@/shared/lib/action-result';

import {
  buildCheckEventLines,
  checkEventDescription,
  checkLabel,
  checkOrigin,
  checkRegisteredIn,
  type CheckEvent,
  type CheckEventLinesResult,
} from '../check-entry-lines';
import { buildMissingPaymentAccountMessage } from '../payment-accounts';
import type { EffectsCtx } from './types';

/**
 * Asiento de un evento del ciclo de vida del cheque (TSK-735): depósito, rechazo,
 * débito del propio y anulación. Corre dentro de la transacción de la acción de
 * Tesorería: si el asiento falla (cuenta faltante, mes cerrado), la acción entera
 * se revierte. Las reglas están en `check-entry-lines.ts`.
 */

/** Columna de `Check` donde queda el asiento de cada evento. */
const ENTRY_COLUMN = {
  DEPOSIT: 'depositEntryId',
  REJECT: 'rejectionEntryId',
  DEBIT: 'debitEntryId',
  VOID: 'voidEntryId',
} as const satisfies Record<CheckEvent, string>;

/**
 * Comprobante de origen del cheque (`checkOrigin`): pago del RC/OP con su caja/banco y,
 * para el propio, la OP (devolución a socio y si tuvo asiento).
 */
export const CHECK_ORIGIN_SELECT = {
  type: true,
  accountId: true,
  receiptPaymentId: true,
  paymentOrderPaymentId: true,
  receiptPayment: { select: { cashRegisterId: true, bankAccountId: true } },
  paymentOrderPayment: {
    select: {
      cashRegisterId: true,
      bankAccountId: true,
      paymentOrder: { select: { partnerId: true, fullNumber: true, journalEntryId: true } },
    },
  },
} satisfies Prisma.CheckSelect;

/** «el depósito del cheque N° 123», para el prefijo «No se puede confirmar …». */
const EVENT_SUBJECT: Record<CheckEvent, string> = {
  DEPOSIT: 'el depósito del',
  REJECT: 'el rechazo del',
  DEBIT: 'el débito del',
  VOID: 'la anulación del',
};

export interface ApplyCheckEventInput {
  checkId: string;
  event: CheckEvent;
  /** Fecha del asiento (depósito/débito: la elegida; rechazo/anulación: hoy de Argentina). */
  date: Date;
  /** Cuenta bancaria del evento (depósito/débito); si no viene, la del cheque. */
  bankAccountId?: string;
}

interface BankForMessage {
  bankName: string;
  accountNumber: string;
  accountId: string | null;
}

/** Mensaje de bloqueo por una cuenta que el asiento necesita y no se pudo resolver. */
function missingMessage(
  subject: string,
  missing: Extract<CheckEventLinesResult, { missing: unknown }>['missing'],
  amount: number,
  bank: BankForMessage | null
): string {
  if (missing !== 'bank') {
    return (
      `No se puede confirmar ${subject}: necesita la cuenta ${settingsAccountLabel(missing)}. ` +
      `Configurala en ${ACCOUNTING_SETTINGS_PATH}.`
    );
  }
  if (!bank) {
    return (
      `No se puede confirmar ${subject}: el cheque no tiene cuenta bancaria y no está definido ` +
      `el ${settingsAccountLabel('defaultBankAccountId')} en ${ACCOUNTING_SETTINGS_PATH}.`
    );
  }
  return buildMissingPaymentAccountMessage(subject, {
    payment: {
      paymentMethod: 'CHECK',
      amount,
      cashRegisterId: null,
      bankAccountId: null,
      bankAccount: bank,
    },
    via: 'bankAccount',
  });
}

/**
 * Anular un cheque depositado deshace primero el asiento del depósito: se borra si
 * está en borrador y se revierte si está registrado (uno ya anulado no se toca).
 */
async function undoDepositEntryTx(
  tx: Tx,
  ctx: EffectsCtx,
  depositEntryId: string,
  date: Date
): Promise<void> {
  const entry = await tx.journalEntry.findFirst({
    where: { id: depositEntryId, companyId: ctx.companyId },
    select: { status: true },
  });
  if (entry?.status === 'DRAFT') {
    await deleteDraftJournalEntryTx(tx, { companyId: ctx.companyId, entryId: depositEntryId });
  } else if (entry?.status === 'POSTED') {
    await reverseJournalEntryTx(tx, {
      companyId: ctx.companyId,
      entryId: depositEntryId,
      date,
      createdBy: ctx.userId,
      source: `check-deposit-undo:${depositEntryId}`,
    });
  }
}

/**
 * Arma y crea (DRAFT, `system`) el asiento del evento y guarda su id en la columna
 * del evento. Se llama ANTES de cambiar el estado del cheque: la anulación decide
 * por el estado previo. Sin asiento (cheque cargado a mano, e-cheq ya en banco) →
 * `entryId: null` con el aviso. Lanza `BusinessError` si el evento está bloqueado
 * (anular el propio de una devolución a socio) o si un cheque ya registrado en un banco
 * se deposita/debita en otro.
 */
export async function applyCheckEventTx(
  tx: Tx,
  ctx: EffectsCtx,
  input: ApplyCheckEventInput
): Promise<{ entryId: string | null; warnings: string[] }> {
  const { companyId } = ctx;
  const { event } = input;

  const check = await tx.check.findFirst({
    where: { id: input.checkId, companyId },
    select: {
      ...CHECK_ORIGIN_SELECT,
      status: true,
      amount: true,
      isElectronic: true,
      customerId: true,
      supplierId: true,
      checkNumber: true,
      bankAccountId: true,
      bankAccount: { select: { bankName: true, accountNumber: true } },
      depositEntryId: true,
    },
  });
  if (!check) throw new BusinessError('Cheque no encontrado');
  const origin = checkOrigin(check);

  // Sin asiento porque el banco ya se movió en libros con el comprobante (e-cheq): el
  // depósito/débito tiene que ser en ese banco, si no Tesorería y libros quedan en bancos
  // distintos (TSK-735).
  const registeredBank =
    checkRegisteredIn({ ...check, ...origin }) === 'bank' ? check.bankAccount : null;
  if (
    (event === 'DEPOSIT' || event === 'DEBIT') &&
    registeredBank &&
    input.bankAccountId &&
    input.bankAccountId !== check.bankAccountId
  ) {
    const verb = event === 'DEPOSIT' ? 'depositalo' : 'debitalo';
    throw new BusinessError(
      `El ${checkLabel(check)} se registró en ${registeredBank.bankName} ${registeredBank.accountNumber}: ${verb} en esa cuenta.`
    );
  }

  const settings = await tx.accountingSettings.findUnique({
    where: { companyId },
    select: {
      receivablesAccountId: true,
      payablesAccountId: true,
      checksRejectedAccountId: true,
      defaultBankAccountId: true,
    },
  });

  if (event === 'VOID' && check.status === 'DEPOSITED' && check.depositEntryId) {
    await undoDepositEntryTx(tx, ctx, check.depositEntryId, input.date);
  }

  const bankAccountId = input.bankAccountId ?? check.bankAccountId;
  const bank = bankAccountId
    ? await tx.bankAccount.findFirst({
        where: { id: bankAccountId, companyId },
        select: { bankName: true, accountNumber: true, accountId: true },
      })
    : null;

  const amount = Number(check.amount);
  const result = buildCheckEventLines({
    event,
    check: {
      type: check.type,
      status: check.status,
      amount,
      isElectronic: check.isElectronic,
      accountId: check.accountId,
      customerId: check.customerId,
      supplierId: check.supplierId,
      ...origin,
      checkNumber: check.checkNumber,
      depositEntered: Boolean(check.depositEntryId),
    },
    bankAccountId: bank?.accountId || settings?.defaultBankAccountId || null,
    settings: {
      receivablesAccountId: settings?.receivablesAccountId ?? null,
      payablesAccountId: settings?.payablesAccountId ?? null,
      checksRejectedAccountId: settings?.checksRejectedAccountId ?? null,
    },
  });

  if ('blocked' in result) throw new BusinessError(result.blocked);
  if ('skip' in result) return { entryId: null, warnings: [result.warning] };
  if ('missing' in result) {
    const subject = `${EVENT_SUBJECT[event]} ${checkLabel(check)}`;
    throw new BusinessError(missingMessage(subject, result.missing, amount, bank));
  }

  // Mes cerrado o cuenta no imputable: `BusinessError` y la acción entera se revierte.
  const entry = await createJournalEntryTx(tx, {
    companyId,
    date: input.date,
    description: checkEventDescription(event, check),
    status: 'DRAFT',
    createdBy: 'system',
    source: `check-${event.toLowerCase()}:${input.checkId}`,
    lines: result.lines.map((line) => ({
      ...line,
      debit: new Prisma.Decimal(line.debit),
      credit: new Prisma.Decimal(line.credit),
    })),
  });

  await tx.check.update({
    where: { id: input.checkId },
    data: { [ENTRY_COLUMN[event]]: entry.id },
  });

  return { entryId: entry.id, warnings: [] };
}
