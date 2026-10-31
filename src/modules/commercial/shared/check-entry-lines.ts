/**
 * Líneas del asiento de cada evento del ciclo de vida de un cheque (TSK-735).
 *
 * El recibo deja el cheque recibido en "Valores a depositar" y la OP el propio
 * físico en "Valores diferidos a pagar" (`Check.accountId`). Depositar, rechazar,
 * debitar y anular descargan esa cuenta. La "cuenta del cheque" es:
 *
 * - `accountId` si lo tiene;
 * - si es null y vino de un recibo/OP (histórico): el físico quedó abierto en
 *   Cuentas por Cobrar/Pagar del tercero, y el e-cheq ya fue al banco (el del
 *   recibo histórico y todo e-cheq propio de una OP). Un físico cuyo pago de origen
 *   tenía caja o banco (arrastrados de otro medio en el formulario) también fue a
 *   fondos con la regla vieja: se trata como el e-cheq histórico en todas las filas;
 * - si es null y no vino de un documento: se cargó a mano y no se asienta.
 *
 * Cheque propio de una devolución a socio: si la devolución tuvo asiento, debitar
 * asienta como cualquier propio y anularlo entregado se bloquea (hay que corregir la
 * devolución, si no se descuadran Deudas con socios y las cuotas pagadas); si es una
 * devolución histórica sin asiento, debitar y anular no generan asiento.
 *
 * | Evento  | Cheque                                   | Asiento                                   |
 * |---------|------------------------------------------|-------------------------------------------|
 * | DEPOSIT | con cuenta                               | Banco / cuenta del cheque                 |
 * | DEPOSIT | histórico físico                         | Banco / Cobrar (cliente)                  |
 * | DEPOSIT | histórico electrónico                    | sin asiento, aviso                        |
 * | todos   | cargado a mano                           | sin asiento, aviso                        |
 * | REJECT  | con cuenta, histórico e-cheq o histórico | Cheques rechazados (cliente) / Banco      |
 * |         | físico con asiento de depósito           |                                           |
 * | REJECT  | histórico físico depositado sin asiento² | Cheques rechazados (cliente) / Cobrar     |
 * |         |                                          | (cliente)                                 |
 * | DEBIT   | propio con cuenta                        | cuenta del cheque / Banco                 |
 * | DEBIT   | propio histórico físico                  | Pagar (proveedor) / Banco                 |
 * | DEBIT   | e-cheq propio (va por banco)             | sin asiento, aviso                        |
 * | VOID    | PORTFOLIO o DEPOSITED¹, con cuenta       | Cobrar (cliente) / cuenta del cheque      |
 * | VOID    | PORTFOLIO o DEPOSITED¹, histórico físico | sin asiento, aviso (Cobrar seguía abierto)|
 * | VOID    | PORTFOLIO o DEPOSITED¹, histórico e-cheq | Cobrar (cliente) / Banco                  |
 * | VOID    | DELIVERED, con cuenta                    | cuenta del cheque / Pagar (proveedor)     |
 * | VOID    | DELIVERED, histórico físico              | sin asiento, aviso (Pagar seguía abierto) |
 * | VOID    | DELIVERED, e-cheq propio                 | Banco / Pagar (proveedor)                 |
 * | VOID    | ENDORSED o REJECTED                      | sin asiento, aviso                        |
 * | DEBIT   | propio de devolución a socio con asiento | como cualquier propio                     |
 * | VOID    | propio de devolución a socio con asiento | bloqueado: corregir la devolución         |
 * | DEBIT,  | propio de devolución a socio histórica   | sin asiento, aviso                        |
 * | VOID    | (sin asiento)                            |                                           |
 *
 * ¹ DEPOSITED: el llamador revierte antes el asiento del depósito (`applyCheckEventTx`).
 * ² Depositado antes de TSK-735: ni el recibo ni el depósito debitaron Banco en libros y el
 *   saldo del cliente siguió en Cobrar; el rechazo lo reclasifica sin tocar Banco.
 *
 * Puro: sin Prisma, sin React, sin importar de features.
 */

import type { CheckStatus, CheckType } from '@/generated/prisma/enums';
import type { AccountingSettingsAccountField } from '@/shared/lib/accounts/settings-account-labels';

export type CheckEvent = 'DEPOSIT' | 'REJECT' | 'DEBIT' | 'VOID';

export interface CheckEventInput {
  event: CheckEvent;
  check: {
    type: CheckType;
    status: CheckStatus;
    amount: number;
    isElectronic: boolean;
    /** Cuenta en la que quedó registrado el cheque (null = histórico o cargado a mano). */
    accountId: string | null;
    customerId: string | null;
    supplierId: string | null;
    /** `Boolean(receiptPaymentId || paymentOrderPaymentId)`. */
    fromDocument: boolean;
    /**
     * El pago del comprobante de origen (el RC del tercero, la OP del propio) tenía caja o
     * banco: con la regla vieja el asiento lo mandó a fondos.
     */
    fundsAtOrigin: boolean;
    /** Propio que pagó una devolución a socio: su OP y si esa devolución tuvo asiento. */
    partnerRepayment: { orderNumber: string; hadEntry: boolean } | null;
    checkNumber: string;
    /** El depósito generó asiento (`Boolean(depositEntryId)`): el banco quedó debitado en libros. */
    depositEntered: boolean;
  };
  /** Cuenta contable del banco ya resuelta (la propia o "Banco por Defecto"); null si no hay. */
  bankAccountId: string | null;
  settings: {
    receivablesAccountId: string | null;
    payablesAccountId: string | null;
    checksRejectedAccountId: string | null;
  };
}

export interface CheckEntryLine {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
  customerId?: string | null;
  supplierId?: string | null;
}

export type CheckEventLinesResult =
  | { lines: CheckEntryLine[] }
  | { skip: true; warning: string }
  | { missing: AccountingSettingsAccountField | 'bank' }
  /** El evento no se puede registrar desde Tesorería: el mensaje dice qué corregir. */
  | { blocked: string };

/** Una cuenta del asiento con su auxiliar, o la falta que bloquea. */
type Side =
  | { accountId: string; customerId?: string | null; supplierId?: string | null }
  | { missing: AccountingSettingsAccountField | 'bank' };

/** Dónde quedó registrado el cheque (ver docblock). */
export type CheckRegistered = 'account' | 'legacyCounterparty' | 'bank' | 'manual';

const EVENT_LABELS: Record<CheckEvent, string> = {
  DEPOSIT: 'Depósito',
  REJECT: 'Rechazo',
  DEBIT: 'Débito',
  VOID: 'Anulación',
};

const VOID_WITHOUT_ENTRY_STATUS: Partial<Record<CheckStatus, string>> = {
  ENDORSED: 'endosado',
  REJECTED: 'rechazado',
};

/** «cheque N° 123» o «e-cheq N° 123». */
export function checkLabel(check: { isElectronic: boolean; checkNumber: string }): string {
  return `${check.isElectronic ? 'e-cheq' : 'cheque'} N° ${check.checkNumber}`;
}

/** Descripción del asiento y de sus líneas: «Depósito de cheque N° 123». */
export function checkEventDescription(
  event: CheckEvent,
  check: { isElectronic: boolean; checkNumber: string }
): string {
  return `${EVENT_LABELS[event]} de ${checkLabel(check)}`;
}

/**
 * Dónde quedó registrado el cheque. `'bank'`: el asiento del comprobante ya movió el banco
 * (o la caja), así que depositar/debitar no asientan y tienen que hacerse en el banco del
 * cheque.
 */
export function checkRegisteredIn(
  check: Pick<CheckEventInput['check'], 'accountId' | 'fromDocument' | 'isElectronic' | 'fundsAtOrigin'>
): CheckRegistered {
  if (check.accountId) return 'account';
  if (!check.fromDocument) return 'manual';
  return check.isElectronic || check.fundsAtOrigin ? 'bank' : 'legacyCounterparty';
}

/** Lo que el cheque guarda de su comprobante de origen (select de `CHECK_ORIGIN_SELECT`). */
export interface CheckOriginRow {
  type: CheckType;
  accountId: string | null;
  receiptPaymentId: string | null;
  paymentOrderPaymentId: string | null;
  receiptPayment: { cashRegisterId: string | null; bankAccountId: string | null } | null;
  paymentOrderPayment: {
    cashRegisterId: string | null;
    bankAccountId: string | null;
    paymentOrder: { partnerId: string | null; fullNumber: string; journalEntryId: string | null };
  } | null;
}

/**
 * Origen del cheque para la regla: el pago de origen es el del RC para un tercero y el de
 * la OP para un propio (el `paymentOrderPaymentId` de un tercero es el de su endoso). Una
 * devolución a socio "tuvo asiento" si el cheque quedó con cuenta o la OP tiene asiento
 * (el e-cheq propio nunca tiene cuenta: va por banco).
 */
export function checkOrigin(
  row: CheckOriginRow
): Pick<CheckEventInput['check'], 'fromDocument' | 'fundsAtOrigin' | 'partnerRepayment'> {
  const originPayment = row.type === 'THIRD_PARTY' ? row.receiptPayment : row.paymentOrderPayment;
  const order = row.type === 'OWN' ? row.paymentOrderPayment?.paymentOrder : null;
  return {
    fromDocument: Boolean(row.receiptPaymentId || row.paymentOrderPaymentId),
    fundsAtOrigin: Boolean(originPayment?.cashRegisterId || originPayment?.bankAccountId),
    partnerRepayment: order?.partnerId
      ? {
          orderNumber: order.fullNumber,
          hadEntry: Boolean(row.accountId || order.journalEntryId),
        }
      : null,
  };
}

/** Propio de una devolución a socio: sin asiento si la devolución no lo tuvo, bloqueo al anular. */
function partnerRepaymentRule(input: CheckEventInput): CheckEventLinesResult | null {
  const { event, check } = input;
  if (!check.partnerRepayment || (event !== 'DEBIT' && event !== 'VOID')) return null;
  const { orderNumber, hadEntry } = check.partnerRepayment;
  if (!hadEntry) {
    const subject = event === 'DEBIT' ? 'el débito' : 'la anulación';
    return skip(
      `La devolución al socio ${orderNumber} no tenía asiento: ${subject} no genera asiento.`
    );
  }
  if (event === 'VOID' && check.status === 'DELIVERED') {
    return {
      blocked: `El cheque N° ${check.checkNumber} pagó la devolución al socio ${orderNumber}: para anularlo, corregí esa orden de pago.`,
    };
  }
  return null;
}

/** «en el banco» (e-cheq) o «en caja o banco» (físico con caja/banco en el pago de origen). */
function fundsLabel(check: CheckEventInput['check']): string {
  return check.isElectronic ? 'en el banco' : 'en caja o banco';
}

const skip = (warning: string): CheckEventLinesResult => ({ skip: true, warning });

/** Debe `debit` / Haber `credit` por el importe del cheque. */
function pair(input: CheckEventInput, debit: Side, credit: Side): CheckEventLinesResult {
  if ('missing' in debit) return { missing: debit.missing };
  if ('missing' in credit) return { missing: credit.missing };
  const { amount } = input.check;
  const description = checkEventDescription(input.event, input.check);
  return {
    lines: [
      { ...debit, debit: amount, credit: 0, description },
      { ...credit, debit: 0, credit: amount, description },
    ],
  };
}

export function buildCheckEventLines(input: CheckEventInput): CheckEventLinesResult {
  const { event, check, settings } = input;
  const registered = checkRegisteredIn(check);
  const number = `N° ${check.checkNumber}`;

  const bank: Side = input.bankAccountId ? { accountId: input.bankAccountId } : { missing: 'bank' };
  const own: Side = { accountId: check.accountId ?? '' };
  const receivables: Side = settings.receivablesAccountId
    ? { accountId: settings.receivablesAccountId, customerId: check.customerId }
    : { missing: 'receivablesAccountId' };
  const payables: Side = settings.payablesAccountId
    ? { accountId: settings.payablesAccountId, supplierId: check.supplierId }
    : { missing: 'payablesAccountId' };

  if (registered === 'manual') {
    return skip(
      `El cheque ${number} se cargó a mano: registrá el asiento en Contabilidad si corresponde.`
    );
  }

  const partnerResult = partnerRepaymentRule(input);
  if (partnerResult) return partnerResult;

  if (event === 'REJECT') {
    const rejected: Side = settings.checksRejectedAccountId
      ? { accountId: settings.checksRejectedAccountId, customerId: check.customerId }
      : { missing: 'checksRejectedAccountId' };
    // El banco quedó debitado en libros por el depósito (con cuenta o histórico físico con
    // asiento) o por el recibo (e-cheq histórico). Si no, el saldo seguía en Cobrar.
    const bankDebited = registered !== 'legacyCounterparty' || check.depositEntered;
    return pair(input, rejected, bankDebited ? bank : receivables);
  }

  if (event === 'DEPOSIT') {
    if (registered === 'bank') {
      return skip(
        `El ${checkLabel(check)} ya se registró ${fundsLabel(check)} al confirmar el recibo: el depósito no genera asiento.`
      );
    }
    return pair(input, bank, registered === 'account' ? own : receivables);
  }

  if (event === 'DEBIT') {
    if (registered === 'bank') {
      return skip(
        `El ${checkLabel(check)} ya se registró ${fundsLabel(check)} al confirmar la orden de pago: el débito no genera asiento.`
      );
    }
    return pair(input, registered === 'account' ? own : payables, bank);
  }

  // VOID
  if (check.status === 'PORTFOLIO' || check.status === 'DEPOSITED') {
    if (registered === 'legacyCounterparty') {
      return skip(
        `El cheque ${number} no tenía cuenta propia: su importe sigue en "Cuentas por Cobrar" y la anulación no genera asiento.`
      );
    }
    return pair(input, receivables, registered === 'account' ? own : bank);
  }
  if (check.status === 'DELIVERED') {
    if (registered === 'legacyCounterparty') {
      return skip(
        `El cheque ${number} no tenía cuenta propia: su importe sigue en "Cuentas por Pagar" y la anulación no genera asiento.`
      );
    }
    return pair(input, registered === 'account' ? own : bank, payables);
  }
  const statusLabel = VOID_WITHOUT_ENTRY_STATUS[check.status] ?? check.status;
  return skip(
    `La anulación del cheque ${number} (${statusLabel}) no genera asiento: registralo en Contabilidad si corresponde.`
  );
}
