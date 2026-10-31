/**
 * Cuenta contable de cada pago de un recibo o una orden de pago (TSK-728, TSK-735).
 *
 * La cadena de resolución (cuenta propia de la caja/banco → "Caja por
 * Defecto"/"Banco por Defecto" de Ajustes) estaba copiada dos veces en el
 * asiento (recibo y OP). Acá la regla está una sola vez y distingue tres
 * resultados:
 *
 * - `resolved`: el pago tiene cuenta y va al asiento.
 * - `missing`: el medio mueve fondos o valores y NO se pudo resolver cuenta:
 *   obligatoria, la confirmación se bloquea con un mensaje que nombra el medio
 *   y dónde configurarlo.
 * - `omitted`: "Cuenta Corriente" (no es un movimiento de fondos) y el cobro con
 *   tarjeta de crédito en un recibo (sin cuenta definida todavía). El
 *   pago queda fuera del asiento con aviso y la línea de Cuentas por
 *   Cobrar/Pagar va por el importe contabilizable (total − omitidos).
 *
 * TSK-735: cheques y tarjetas tienen cuenta propia (Valores a depositar,
 * Valores diferidos a pagar, Tarjetas de crédito a pagar, Deudas con socios).
 * Orden de resolución: tarjeta de socio → cheque recibido (RC) → cheque
 * endosado (OP; con cuenta registrada, histórico físico a Cuentas por Cobrar o
 * e-cheq al banco del cheque; si el cheque ya no existe, bloquea) → cheque
 * propio (OP) → tarjeta de crédito de la empresa (solo OP) → "Cuenta Corriente"
 * → cadena de caja/banco.
 *
 * Funciones puras: sin Prisma, sin React, sin importar de features.
 */

import type { PaymentMethod } from '@/generated/prisma/enums';
import {
  ACCOUNTING_SETTINGS_PATH,
  type AccountingSettingsAccountField,
  settingsAccountLabel,
} from '@/shared/lib/accounts/settings-account-labels';
import { formatCurrency } from '@/shared/utils/formatters';

/** Un pago visto desde la resolución de su cuenta: `ReceiptPayment` o `PaymentOrderPayment` con sus relaciones. */
export interface PaymentAccountCheck {
  paymentMethod: PaymentMethod;
  amount: number;
  cashRegisterId: string | null;
  bankAccountId: string | null;
  checkNumber?: string | null;
  endorsedCheckId?: string | null;
  cashRegister?: { name: string; accountId: string | null } | null;
  bankAccount?: { bankName: string; accountNumber: string; accountId: string | null } | null;
  card?: { name: string; ownerType: 'COMPANY' | 'PARTNER' } | null;
  /**
   * Cheque endosado en una OP, con la cuenta con la que ingresó (`accountId` null = histórico).
   * `null` con `endorsedCheckId` cargado = el cheque ya no existe en la empresa: bloquea.
   */
  endorsedCheck?: EndorsedCheckInfo | null;
}

/** Lo que la resolución necesita del cheque endosado (ver `loadEndorsedChecks`). */
export interface EndorsedCheckInfo {
  accountId: string | null;
  customerId: string | null;
  isElectronic: boolean;
  checkNumber?: string | null;
  bankAccount: {
    accountId: string | null;
    bankName?: string;
    accountNumber?: string;
  } | null;
}

/** Lo que se necesita de `AccountingSettings`. */
export interface PaymentAccountSettings {
  defaultCashAccountId?: string | null;
  defaultBankAccountId?: string | null;
  checksReceivedAccountId?: string | null;
  checksPayableAccountId?: string | null;
  creditCardsPayableAccountId?: string | null;
  partnerDebtsAccountId?: string | null;
  /** Para endosos y cuotas históricos que ingresaron sin cuenta. */
  receivablesAccountId?: string | null;
  payablesAccountId?: string | null;
}

export type ResolvedPaymentSource =
  | 'cashRegister'
  | 'bankAccount'
  | 'defaultCash'
  | 'defaultBank'
  | 'checksReceived'
  | 'checksPayable'
  | 'endorsedCheck'
  | 'endorsedLegacyReceivable'
  | 'creditCardsPayable'
  | 'partnerDebts';
export type MissingPaymentAccountVia =
  | 'cashRegister'
  | 'bankAccount'
  | 'noCashRegister'
  | 'noBankAccount'
  | 'endorsedCheckNotFound'
  | 'settings:checksReceivedAccountId'
  | 'settings:checksPayableAccountId'
  | 'settings:creditCardsPayableAccountId'
  | 'settings:partnerDebtsAccountId'
  | 'settings:receivablesAccountId';
export type OmittedPaymentReason = 'ACCOUNT' | 'CUSTOMER_CREDIT_CARD';

export type PaymentAccountResolution =
  | {
      kind: 'resolved';
      accountId: string;
      source: ResolvedPaymentSource;
      /** Cliente del cheque, para la línea de Cuentas por Cobrar de un endoso histórico. */
      customerId?: string | null;
    }
  | { kind: 'missing'; via: MissingPaymentAccountVia }
  | { kind: 'omitted'; reason: OmittedPaymentReason };

export type EntryDocumentKind = 'receipt' | 'paymentOrder';

export interface ResolvedPayment<T extends PaymentAccountCheck> {
  payment: T;
  accountId: string;
  source: ResolvedPaymentSource;
  customerId?: string | null;
}
export interface MissingPaymentAccount<T extends PaymentAccountCheck> {
  payment: T;
  via: MissingPaymentAccountVia;
}
export interface OmittedPayment<T extends PaymentAccountCheck> {
  payment: T;
  reason: OmittedPaymentReason;
}

export interface PaymentsClassification<T extends PaymentAccountCheck> {
  resolved: ResolvedPayment<T>[];
  missing: MissingPaymentAccount<T>[];
  omitted: OmittedPayment<T>[];
  /** Suma de `amount` de los omitidos: lo que NO entra al asiento. */
  omittedAmount: number;
}

/**
 * Copiado literal de `treasury/shared/validators.ts` (`PAYMENT_METHOD_LABELS`):
 * `commercial/shared` no debe depender de una feature.
 */
const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  CHECK: 'Cheque',
  ECHEQ: 'E-Cheq',
  TRANSFER: 'Transferencia',
  DEBIT_CARD: 'Tarjeta de Débito',
  CREDIT_CARD: 'Tarjeta de Crédito',
  ACCOUNT: 'Cuenta Corriente',
};

type SettingsMissingVia = Extract<MissingPaymentAccountVia, `settings:${string}`>;

function isSettingsVia(via: MissingPaymentAccountVia): via is SettingsMissingVia {
  return via.startsWith('settings:');
}

/** Cuenta de Ajustes o falta obligatoria de ese campo. */
function fromSettings(
  accountId: string | null | undefined,
  source: ResolvedPaymentSource,
  via: SettingsMissingVia
): PaymentAccountResolution {
  return accountId ? { kind: 'resolved', accountId, source } : { kind: 'missing', via };
}

/** Cheque endosado en una OP: cuenta registrada, histórico físico o e-cheq al banco. */
function resolveEndorsedCheck(
  payment: PaymentAccountCheck,
  settings: PaymentAccountSettings
): PaymentAccountResolution {
  const check = payment.endorsedCheck;
  // Id colgado (cheque borrado o de otra empresa): no se cae en silencio al histórico.
  if (!check) return { kind: 'missing', via: 'endorsedCheckNotFound' };
  if (check.accountId) {
    return { kind: 'resolved', accountId: check.accountId, source: 'endorsedCheck' };
  }
  if (!check.isElectronic) {
    const receivables = settings.receivablesAccountId || null;
    return receivables
      ? {
          kind: 'resolved',
          accountId: receivables,
          source: 'endorsedLegacyReceivable',
          customerId: check.customerId,
        }
      : { kind: 'missing', via: 'settings:receivablesAccountId' };
  }
  const bankAccountId = check.bankAccount?.accountId || null;
  if (bankAccountId) return { kind: 'resolved', accountId: bankAccountId, source: 'bankAccount' };
  const defaultBank = settings.defaultBankAccountId || null;
  return defaultBank
    ? { kind: 'resolved', accountId: defaultBank, source: 'defaultBank' }
    : { kind: 'missing', via: 'noBankAccount' };
}

/**
 * Cuenta del pago. Usa `||` a propósito: una cadena vacía cuenta como "sin
 * valor". Ver el docblock del archivo para el orden de resolución.
 */
export function resolvePaymentAccount(
  payment: PaymentAccountCheck,
  settings: PaymentAccountSettings,
  kind: EntryDocumentKind
): PaymentAccountResolution {
  const isCheck = payment.paymentMethod === 'CHECK' || payment.paymentMethod === 'ECHEQ';

  if (payment.card?.ownerType === 'PARTNER') {
    return fromSettings(
      settings.partnerDebtsAccountId || null,
      'partnerDebts',
      'settings:partnerDebtsAccountId'
    );
  }
  if (isCheck && kind === 'receipt') {
    return fromSettings(
      settings.checksReceivedAccountId || null,
      'checksReceived',
      'settings:checksReceivedAccountId'
    );
  }
  if (isCheck && kind === 'paymentOrder') {
    if (payment.endorsedCheckId) return resolveEndorsedCheck(payment, settings);
    if (payment.paymentMethod === 'CHECK') {
      return fromSettings(
        settings.checksPayableAccountId || null,
        'checksPayable',
        'settings:checksPayableAccountId'
      );
    }
    // E-cheq propio: sigue la cadena de banco de abajo.
  }
  if (payment.paymentMethod === 'CREDIT_CARD' && kind === 'receipt') {
    return { kind: 'omitted', reason: 'CUSTOMER_CREDIT_CARD' };
  }
  if (payment.paymentMethod === 'CREDIT_CARD') {
    return fromSettings(
      settings.creditCardsPayableAccountId || null,
      'creditCardsPayable',
      'settings:creditCardsPayableAccountId'
    );
  }
  if (payment.paymentMethod === 'ACCOUNT') return { kind: 'omitted', reason: 'ACCOUNT' };

  const cashRegisterId = payment.cashRegisterId || null;
  const bankAccountId = payment.bankAccountId || null;
  const cashAccountId = payment.cashRegister?.accountId || null;
  const bankAccountAccountId = payment.bankAccount?.accountId || null;
  const defaultCash = settings.defaultCashAccountId || null;
  const defaultBank = settings.defaultBankAccountId || null;

  // Mismo orden que tenía el asiento: propia de caja > propia de banco > por defecto.
  if (cashRegisterId && cashAccountId) {
    return { kind: 'resolved', accountId: cashAccountId, source: 'cashRegister' };
  }
  if (bankAccountId && bankAccountAccountId) {
    return { kind: 'resolved', accountId: bankAccountAccountId, source: 'bankAccount' };
  }
  if (cashRegisterId && defaultCash) {
    return { kind: 'resolved', accountId: defaultCash, source: 'defaultCash' };
  }
  if (bankAccountId && defaultBank) {
    return { kind: 'resolved', accountId: defaultBank, source: 'defaultBank' };
  }
  if (cashRegisterId) return { kind: 'missing', via: 'cashRegister' };
  if (bankAccountId) return { kind: 'missing', via: 'bankAccount' };

  return payment.paymentMethod === 'CASH'
    ? { kind: 'missing', via: 'noCashRegister' }
    : { kind: 'missing', via: 'noBankAccount' };
}

/** Reparte los pagos según su resolución, conservando orden y objeto original. */
export function classifyPayments<T extends PaymentAccountCheck>(
  payments: readonly T[],
  settings: PaymentAccountSettings,
  kind: EntryDocumentKind
): PaymentsClassification<T> {
  const result: PaymentsClassification<T> = {
    resolved: [],
    missing: [],
    omitted: [],
    omittedAmount: 0,
  };

  for (const payment of payments) {
    const resolution = resolvePaymentAccount(payment, settings, kind);
    if (resolution.kind === 'resolved') {
      result.resolved.push({
        payment,
        accountId: resolution.accountId,
        source: resolution.source,
        customerId: resolution.customerId,
      });
    } else if (resolution.kind === 'missing') {
      result.missing.push({ payment, via: resolution.via });
    } else {
      result.omitted.push({ payment, reason: resolution.reason });
      result.omittedAmount += payment.amount;
    }
  }

  // Suma de flotantes: se redondea a centavos para comparar con el total.
  result.omittedAmount = Math.round(result.omittedAmount * 100) / 100;
  return result;
}

/** `Banco Galicia 123-456`, como lo nombran los mensajes. */
function bankAccountLabel(bank: { bankName: string; accountNumber: string }): string {
  return `${bank.bankName} ${bank.accountNumber}`;
}

/**
 * Cuenta bancaria por la que va un pago con banco: la de la línea o, en un e-cheq
 * endosado, la del cheque (la línea de la OP no la tiene). `null` si no hay banco que nombrar.
 */
export function paymentBankLabel(payment: PaymentAccountCheck): string | null {
  if (payment.endorsedCheckId) {
    const bank = payment.endorsedCheck?.bankAccount;
    return bank?.bankName ? `${bank.bankName} ${bank.accountNumber ?? ''}`.trim() : null;
  }
  return payment.bankAccount ? bankAccountLabel(payment.bankAccount) : null;
}

/** «e-cheq endosado N° 123» (sin artículo), para los mensajes del endoso histórico electrónico. */
export function endorsedEcheqLabel(payment: PaymentAccountCheck): string {
  const number = payment.endorsedCheck?.checkNumber || payment.checkNumber;
  return number ? `e-cheq endosado N° ${number}` : 'e-cheq endosado';
}

/** «Cheque N° 123 por $ 1.000,00», «Transferencia (Banco Galicia 123-456) por $ …». */
export function describePayment(payment: PaymentAccountCheck): string {
  const method = PAYMENT_METHOD_LABELS[payment.paymentMethod];
  const importe = formatCurrency(payment.amount);

  if (payment.checkNumber) return `${method} N° ${payment.checkNumber} por ${importe}`;
  if (payment.card) return `${method} (${payment.card.name}) por ${importe}`;
  if (payment.cashRegister) return `${method} (${payment.cashRegister.name}) por ${importe}`;
  if (payment.bankAccount)
    return `${method} (${bankAccountLabel(payment.bankAccount)}) por ${importe}`;
  return `${method} por ${importe}`;
}

/** Bloqueo: un pago de caja/banco sin cuenta resoluble, y dónde se arregla. */
export function buildMissingPaymentAccountMessage(
  documentLabel: string,
  missing: MissingPaymentAccount<PaymentAccountCheck>
): string {
  const { payment, via } = missing;
  const prefix = `No se puede confirmar ${documentLabel}:`;

  if (isSettingsVia(via)) {
    const field = via.slice('settings:'.length) as AccountingSettingsAccountField;
    return (
      `${prefix} ${PAYMENT_METHOD_LABELS[payment.paymentMethod]} por ${formatCurrency(payment.amount)} ` +
      `necesita la cuenta ${settingsAccountLabel(field)}. Configurala en ${ACCOUNTING_SETTINGS_PATH}.`
    );
  }

  switch (via) {
    case 'endorsedCheckNotFound':
      return `${prefix} el cheque endosado ya no existe en Tesorería → Cheques.`;
    case 'cashRegister':
      return (
        `${prefix} la caja "${payment.cashRegister?.name ?? ''}" no tiene cuenta contable asociada. ` +
        `Configurala en Tesorería → Cajas o definí la ${settingsAccountLabel('defaultCashAccountId')} ` +
        `en ${ACCOUNTING_SETTINGS_PATH}.`
      );
    case 'bankAccount':
      return (
        `${prefix} la cuenta bancaria "${payment.bankAccount ? bankAccountLabel(payment.bankAccount) : ''}" ` +
        `no tiene cuenta contable asociada. Configurala en Tesorería → Cuentas Bancarias o definí ` +
        `el ${settingsAccountLabel('defaultBankAccountId')} en ${ACCOUNTING_SETTINGS_PATH}.`
      );
    case 'noCashRegister':
      return (
        `${prefix} el pago en ${PAYMENT_METHOD_LABELS[payment.paymentMethod]} de ` +
        `${formatCurrency(payment.amount)} no tiene caja asignada. Editá el comprobante y elegí la caja.`
      );
    case 'noBankAccount':
      if (payment.endorsedCheckId) return endorsedEcheqWithoutBankMessage(prefix, payment);
      return (
        `${prefix} el pago en ${PAYMENT_METHOD_LABELS[payment.paymentMethod]} de ` +
        `${formatCurrency(payment.amount)} no tiene cuenta bancaria asignada. ` +
        `Editá el comprobante y elegí la cuenta bancaria.`
      );
  }
}

/** E-cheq endosado histórico sin cuenta resoluble: su banco no tiene cuenta y no hay "Banco por Defecto". */
function endorsedEcheqWithoutBankMessage(prefix: string, payment: PaymentAccountCheck): string {
  const echeq = endorsedEcheqLabel(payment);
  const bank = paymentBankLabel(payment);
  const defaultBank = `el ${settingsAccountLabel('defaultBankAccountId')} en ${ACCOUNTING_SETTINGS_PATH}`;
  return bank
    ? `${prefix} la cuenta bancaria "${bank}" del ${echeq} no tiene cuenta contable asociada. ` +
        `Configurala en Tesorería → Cuentas Bancarias o definí ${defaultBank}.`
    : `${prefix} el ${echeq} no tiene cuenta bancaria. Definí ${defaultBank}.`;
}

const OMITTED_REASON_TEXT: Record<OmittedPaymentReason, string> = {
  CUSTOMER_CREDIT_CARD:
    'el cobro con tarjeta de crédito todavía no tiene cuenta asignada en el sistema',
  ACCOUNT: '"Cuenta Corriente" no representa un movimiento de fondos',
};

/** Cuenta de contrapartida del comprobante, con el mismo texto que Ajustes. */
function counterpartLabel(kind: EntryDocumentKind): string {
  return settingsAccountLabel(
    kind === 'receipt' ? 'receivablesAccountId' : 'payablesAccountId'
  ).replaceAll('"', '');
}

/** Aviso (no bloqueo): el pago queda fuera del asiento y por qué. */
export function buildOmittedPaymentWarning(
  omitted: OmittedPayment<PaymentAccountCheck>,
  kind: EntryDocumentKind
): string {
  return (
    `${describePayment(omitted.payment)} no genera línea en el asiento contable: ` +
    `${OMITTED_REASON_TEXT[omitted.reason]}. Ese importe queda pendiente en ` +
    `${counterpartLabel(kind)} hasta que se regularice.`
  );
}

const SUGGESTED_PAYMENTS: Record<EntryDocumentKind, string> = {
  receipt: 'un pago en efectivo, transferencia o cheque',
  paymentOrder: 'un pago en efectivo, transferencia, cheque o tarjeta',
};

/** Bloqueo: ningún pago con cuenta ni retención, el asiento quedaría con una sola línea. */
export function buildSingleLineEntryMessage(
  documentLabel: string,
  kind: EntryDocumentKind,
  omitted: readonly OmittedPayment<PaymentAccountCheck>[]
): string {
  const motivo =
    omitted.length === 0
      ? 'no hay pagos ni retenciones'
      : `ningún pago genera línea contable (${omitted.map((o) => describePayment(o.payment)).join(', ')}) ` +
        'y no hay retenciones';

  return (
    `No se puede confirmar ${documentLabel}: ${motivo}, así que el asiento quedaría con una ` +
    `sola línea. Agregá ${SUGGESTED_PAYMENTS[kind]}, o una retención.`
  );
}

/**
 * Bloqueo de la devolución a socio (TSK-735): el Debe son las cuotas devueltas, así que un
 * pago sin línea (Cuenta Corriente) descuadraría el asiento.
 */
export function buildPartnerRepaymentOmittedMessage(
  documentLabel: string,
  omitted: OmittedPayment<PaymentAccountCheck>
): string {
  return (
    `No se puede confirmar ${documentLabel}: ${describePayment(omitted.payment)} no genera línea ` +
    `en el asiento contable (${OMITTED_REASON_TEXT[omitted.reason]}) y la devolución al socio ` +
    'tiene que salir de una caja, un banco o un cheque. Elegí otro medio de pago.'
  );
}
