import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { withEndorsedChecks } from '@/modules/commercial/shared/endorsed-checks';
import { formatAccountLabel } from '@/modules/commercial/shared/line-accounts';
import {
  buildMissingPaymentAccountMessage,
  buildOmittedPaymentWarning,
  buildPartnerRepaymentOmittedMessage,
  buildSingleLineEntryMessage,
  classifyPayments,
  endorsedEcheqLabel,
  findPaymentDataError,
  partnerRepaymentTotalsError,
  paymentBankLabel,
  paymentCashRegisterName,
  type EntryDocumentKind,
  type PaymentAccountCheck,
  type ResolvedPaymentSource,
} from '@/modules/commercial/shared/payment-accounts';
import {
  buildMissingSettingsAccountsMessage,
  findMissingSettingsAccounts,
  withholdingSettingsField,
  type SettingsAccountIds,
  type WithholdingRole,
  type WithholdingTaxTypeKey,
} from '@/modules/commercial/shared/settings-accounts';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import {
  ACCOUNTING_SETTINGS_PATH,
  settingsAccountLabel,
  type AccountingSettingsAccountField,
} from '@/shared/lib/accounts/settings-account-labels';
import { BusinessError } from '@/shared/lib/action-result';
import { prisma } from '@/shared/lib/prisma';

/**
 * Pre-validación del asiento de un recibo o una orden de pago (TSK-728).
 *
 * Carga en una pasada el comprobante con sus pagos (caja/banco/tarjeta con su
 * cuenta contable), sus retenciones y los Ajustes contables; corre los
 * helpers puros de `commercial/shared` y verifica que cada cuenta resuelta
 * sea imputable hoy. Devuelve el resultado como DATO (`error`/`warnings`) para
 * que la misma función alimente la vista previa del diálogo de confirmar y la
 * pre-validación de `confirmReceipt`/`confirmPaymentOrder`, que corre ANTES de
 * `prisma.$transaction`: nada se mueve si va a fallar por configuración.
 *
 * Lo llaman actions que YA hicieron `checkPermission` y `getActiveCompanyId`.
 * Sin test unitario: lo cubren los tests de integración de recibos y OP.
 */

type PrismaClientLike = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Una cuenta que el asiento va a usar, para listarla en el diálogo. */
export interface EntryPreviewAccount {
  /** «Cuentas por Cobrar», «Caja "Caja principal"», «Ret. IIBB Sufrida». */
  concept: string;
  /** `code - name`. */
  account: string;
}

/** Serializable: lo devuelven las actions de vista previa. */
export interface EntryPreflight {
  /** «el recibo R-00012», «la orden de pago OP-00001». */
  documentLabel: string;
  /** Motivo por el que la confirmación va a fallar, o `null`. */
  error: string | null;
  /** Avisos que no bloquean (pagos omitidos del asiento). */
  warnings: string[];
  /** Cuentas con las que se genera el asiento (vacío si hay `error` o no hay asiento). */
  accounts: EntryPreviewAccount[];
}

const EMPTY_ACCOUNTS: EntryPreviewAccount[] = [];

/** `select` de pagos común a recibos y OP (la OP suma tarjeta y cheque endosado). */
const PAYMENT_SELECT = {
  paymentMethod: true,
  amount: true,
  cashRegisterId: true,
  bankAccountId: true,
  checkNumber: true,
  cashRegister: { select: { name: true, accountId: true } },
  bankAccount: { select: { bankName: true, accountNumber: true, accountId: true } },
} satisfies Prisma.ReceiptPaymentSelect;

const SETTINGS_COMMON_SELECT = {
  defaultCashAccountId: true,
  defaultBankAccountId: true,
  checksReceivedAccountId: true,
  checksPayableAccountId: true,
  creditCardsPayableAccountId: true,
  partnerDebtsAccountId: true,
  receivablesAccountId: true,
  payablesAccountId: true,
} satisfies Prisma.AccountingSettingsSelect;

const NO_SETTINGS_MESSAGE = `No se encontró configuración contable para la empresa. Configurala en ${ACCOUNTING_SETTINGS_PATH}.`;

/** Una cuenta que el asiento va a usar: de dónde sale y dónde se corrige. */
interface AccountToCheck {
  accountId: string;
  /** Para el listado del diálogo: «Caja "Caja principal"». */
  concept: string;
  /** Para el error: «de la caja "Caja principal"». */
  origin: string;
  fixPath: string;
}
type AccountOrigin = Omit<AccountToCheck, 'accountId'>;

interface PreflightInput<T extends PaymentAccountCheck> {
  companyId: string;
  client: PrismaClientLike;
  documentLabel: string;
  kind: EntryDocumentKind;
  /**
   * Contrapartida de Ajustes. En la devolución a socio solo se exige Cuentas por Pagar si
   * hay cuotas históricas (sin cuenta); si no, `null`.
   */
  counterpartField: 'receivablesAccountId' | 'payablesAccountId' | null;
  withholdingRole: WithholdingRole;
  payments: readonly T[];
  withholdings: readonly { taxType: WithholdingTaxTypeKey }[];
  settings: SettingsAccountIds;
  /** Cuentas propias del comprobante que el asiento también usa (cuotas devueltas al socio). */
  documentAccounts?: readonly AccountToCheck[];
  /**
   * Devolución a socio (TSK-735): su Debe son las cuotas, así que un pago sin línea
   * (Cuenta Corriente) descuadraría el asiento y bloquea en vez de avisar.
   */
  isPartnerRepayment?: boolean;
}

/** Cuotas de tarjeta de socio que devuelve la OP, con la cuenta en la que se registraron. */
const PARTNER_INSTALLMENT_ORIGIN: AccountOrigin = {
  concept: 'Cuotas devueltas al socio',
  origin: 'con la que se registró la cuota del socio',
  fixPath: 'Contabilidad → Plan de Cuentas',
};

function paymentAccountOrigin(resolved: {
  payment: PaymentAccountCheck;
  source: ResolvedPaymentSource;
}): AccountOrigin {
  switch (resolved.source) {
    case 'cashRegister': {
      // En un cheque endosado histórico la caja es la del pago del RC con el que ingresó.
      const caja = `"${paymentCashRegisterName(resolved.payment)}"`;
      return {
        concept: `Caja ${caja}`,
        origin: `de la caja ${caja}`,
        fixPath: 'Tesorería → Cajas',
      };
    }
    case 'bankAccount': {
      // En un e-cheq endosado histórico el banco es el del cheque, no el de la línea de la OP.
      const bank = paymentBankLabel(resolved.payment);
      if (!bank) {
        const echeq = endorsedEcheqLabel(resolved.payment);
        return {
          concept: `Banco del ${echeq}`,
          origin: `de la cuenta bancaria del ${echeq}`,
          fixPath: 'Tesorería → Cuentas Bancarias',
        };
      }
      return {
        concept: `Banco "${bank}"`,
        origin: `de la cuenta bancaria "${bank}"`,
        fixPath: 'Tesorería → Cuentas Bancarias',
      };
    }
    case 'defaultCash':
      return settingsOrigin('defaultCashAccountId');
    case 'defaultBank':
      return settingsOrigin('defaultBankAccountId');
    case 'checksReceived':
      return settingsOrigin('checksReceivedAccountId');
    case 'checksPayable':
      return settingsOrigin('checksPayableAccountId');
    case 'creditCardsPayable':
      return settingsOrigin('creditCardsPayableAccountId');
    case 'partnerDebts':
      return settingsOrigin('partnerDebtsAccountId');
    case 'endorsedLegacyReceivable':
      return settingsOrigin('receivablesAccountId');
    case 'endorsedCheck':
      return {
        concept: 'Cuenta del cheque endosado',
        origin: 'con la que ingresó el cheque endosado',
        fixPath: 'Tesorería → Cheques',
      };
  }
}

function settingsOrigin(field: AccountingSettingsAccountField): AccountOrigin {
  return {
    concept: settingsAccountLabel(field).replaceAll('"', ''),
    origin: `configurada como ${settingsAccountLabel(field)}`,
    fixPath: ACCOUNTING_SETTINGS_PATH,
  };
}

/**
 * Verifica que cada cuenta sea imputable (activa, hoja, sin corte vigente y
 * existente). Dos queries: ids imputables + datos para el label. Devuelve el
 * error listo con la primera que falla, o el listado para el diálogo.
 */
async function checkAccounts(
  client: PrismaClientLike,
  companyId: string,
  documentLabel: string,
  toCheck: readonly AccountToCheck[]
): Promise<{ error: string } | { accounts: EntryPreviewAccount[] }> {
  if (toCheck.length === 0) return { accounts: EMPTY_ACCOUNTS };
  const ids = [...new Set(toCheck.map((a) => a.accountId))];

  const [imputable, all] = await Promise.all([
    client.account.findMany({
      where: { ...buildImputableAccountsWhere({ companyId }), id: { in: ids } },
      select: { id: true },
    }),
    client.account.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const imputableIds = new Set(imputable.map((a) => a.id));
  const byId = new Map(all.map((a) => [a.id, a]));

  const failed = toCheck.find((a) => !imputableIds.has(a.accountId));
  if (failed) {
    const info = byId.get(failed.accountId);
    const cuenta = info
      ? `la cuenta ${formatAccountLabel(info)} (${failed.origin}) no está activa o no es imputable`
      : `la cuenta ${failed.origin} ya no existe en el plan de cuentas`;
    return {
      error: `No se puede confirmar ${documentLabel}: ${cuenta}. Corregila en ${failed.fixPath}.`,
    };
  }

  return {
    accounts: toCheck.map((a) => {
      const info = byId.get(a.accountId);
      return { concept: a.concept, account: info ? formatAccountLabel(info) : a.accountId };
    }),
  };
}

/** Los chequeos en orden; el primero que falla es el `error`. */
async function runPreflight<T extends PaymentAccountCheck>(
  input: PreflightInput<T>
): Promise<EntryPreflight> {
  const { documentLabel, kind, settings } = input;
  const warnings: string[] = [];
  const toCheck: AccountToCheck[] = [];
  const fail = (error: string): EntryPreflight => ({
    documentLabel,
    error,
    warnings,
    accounts: EMPTY_ACCOUNTS,
  });

  // (a) Cuentas obligatorias de Ajustes: contrapartida + una por tipo de retención.
  const withholdingFields = [
    ...new Set(
      input.withholdings.map((w) => withholdingSettingsField(w.taxType, input.withholdingRole))
    ),
  ];
  const required: AccountingSettingsAccountField[] = [
    ...(input.counterpartField ? [input.counterpartField] : []),
    ...withholdingFields,
  ];
  const missing = findMissingSettingsAccounts(settings, required);
  if (missing.length > 0) return fail(buildMissingSettingsAccountsMessage(documentLabel, missing));
  for (const field of required) {
    const accountId = settings[field];
    if (accountId) toCheck.push({ accountId, ...settingsOrigin(field) });
  }
  toCheck.push(...(input.documentAccounts ?? []));

  // (b) Pago al que le falta un dato (número de cheque, endoso por otro importe): bloquea.
  const dataError = findPaymentDataError(documentLabel, input.payments);
  if (dataError) return fail(dataError);

  // (c) Pago sin cuenta resoluble (caja/banco, cuenta de Ajustes, cheque endosado): bloquea.
  const classification = classifyPayments(input.payments, settings, kind);
  if (classification.missing.length > 0) {
    return fail(buildMissingPaymentAccountMessage(documentLabel, classification.missing[0]));
  }
  if (input.isPartnerRepayment && classification.omitted.length > 0) {
    return fail(buildPartnerRepaymentOmittedMessage(documentLabel, classification.omitted[0]));
  }

  // (d) Ningún pago con cuenta ni retención: el asiento quedaría con una sola línea.
  if (classification.resolved.length === 0 && input.withholdings.length === 0) {
    return fail(buildSingleLineEntryMessage(documentLabel, kind, classification.omitted));
  }

  // (e) Imputabilidad de todo lo que el asiento va a usar.
  for (const resolved of classification.resolved) {
    toCheck.push({ accountId: resolved.accountId, ...paymentAccountOrigin(resolved) });
  }
  const checked = await checkAccounts(input.client, input.companyId, documentLabel, toCheck);
  if ('error' in checked) return fail(checked.error);

  warnings.push(...classification.omitted.map((o) => buildOmittedPaymentWarning(o, kind)));
  return { documentLabel, error: null, warnings, accounts: checked.accounts };
}

/** Pre-validación del asiento de un recibo de cobro. */
export async function loadReceiptEntryPreflight(
  companyId: string,
  receiptId: string,
  client: PrismaClientLike = prisma
): Promise<EntryPreflight> {
  const receipt = await client.receipt.findFirst({
    where: { id: receiptId, companyId },
    select: {
      fullNumber: true,
      status: true,
      payments: { select: PAYMENT_SELECT },
      withholdings: { select: { taxType: true } },
    },
  });
  if (!receipt)
    return {
      documentLabel: 'el recibo',
      error: 'Recibo no encontrado',
      warnings: [],
      accounts: [],
    };

  const documentLabel = `el recibo ${receipt.fullNumber}`;
  if (receipt.status !== 'DRAFT') {
    return {
      documentLabel,
      error: 'Recibo no encontrado o ya confirmado',
      warnings: [],
      accounts: [],
    };
  }

  const settings = await client.accountingSettings.findUnique({
    where: { companyId },
    select: {
      ...SETTINGS_COMMON_SELECT,
      withholdingIvaSufferedAccountId: true,
      withholdingGananciasSufferedAccountId: true,
      withholdingIibbSufferedAccountId: true,
      withholdingSussSufferedAccountId: true,
    },
  });
  if (!settings) return { documentLabel, error: NO_SETTINGS_MESSAGE, warnings: [], accounts: [] };

  return runPreflight({
    companyId,
    client,
    documentLabel,
    kind: 'receipt',
    counterpartField: 'receivablesAccountId',
    withholdingRole: 'suffered',
    payments: receipt.payments.map((p) => ({ ...p, amount: Number(p.amount) })),
    withholdings: receipt.withholdings,
    settings,
  });
}

/**
 * Pre-validación del asiento de una orden de pago. En la devolución a socio
 * (`partnerId`, TSK-735) el Debe son las cuotas que salda: se verifica la
 * cuenta de cada una y, si alguna es histórica (sin cuenta), Cuentas por Pagar.
 */
export async function loadPaymentOrderEntryPreflight(
  companyId: string,
  paymentOrderId: string,
  client: PrismaClientLike = prisma
): Promise<EntryPreflight> {
  const order = await client.paymentOrder.findFirst({
    where: { id: paymentOrderId, companyId },
    select: {
      fullNumber: true,
      status: true,
      partnerId: true,
      payments: {
        select: {
          ...PAYMENT_SELECT,
          endorsedCheckId: true,
          card: { select: { name: true, ownerType: true } },
        },
      },
      withholdings: { select: { taxType: true } },
      settledInstallments: { select: { accountId: true, amount: true } },
    },
  });
  if (!order) {
    return {
      documentLabel: 'la orden de pago',
      error: 'Orden de pago no encontrada',
      warnings: [],
      accounts: [],
    };
  }

  const documentLabel = `la orden de pago ${order.fullNumber}`;
  if (order.status !== 'DRAFT') {
    return {
      documentLabel,
      error: 'Orden de pago no encontrada o ya confirmada',
      warnings: [],
      accounts: [],
    };
  }

  const settings = await client.accountingSettings.findUnique({
    where: { companyId },
    select: {
      ...SETTINGS_COMMON_SELECT,
      withholdingIvaEmittedAccountId: true,
      withholdingGananciasEmittedAccountId: true,
      withholdingIibbEmittedAccountId: true,
      withholdingSussEmittedAccountId: true,
    },
  });
  if (!settings) return { documentLabel, error: NO_SETTINGS_MESSAGE, warnings: [], accounts: [] };

  const payments = await withEndorsedChecks(
    client,
    companyId,
    order.payments.map((p) => ({ ...p, amount: Number(p.amount) }))
  );

  const isPartnerRepayment = Boolean(order.partnerId);
  if (isPartnerRepayment) {
    const totalsError = partnerRepaymentTotalsError(
      order.settledInstallments.map((i) => Number(i.amount)),
      payments.map((p) => p.amount)
    );
    if (totalsError) return { documentLabel, error: totalsError, warnings: [], accounts: [] };
  }
  const installmentAccountIds = isPartnerRepayment
    ? [...new Set(order.settledInstallments.flatMap((i) => (i.accountId ? [i.accountId] : [])))]
    : [];
  const hasLegacyInstallments = order.settledInstallments.some((i) => !i.accountId);
  return runPreflight({
    companyId,
    client,
    documentLabel,
    kind: 'paymentOrder',
    counterpartField: !isPartnerRepayment || hasLegacyInstallments ? 'payablesAccountId' : null,
    withholdingRole: 'emitted',
    payments,
    withholdings: order.withholdings,
    settings,
    documentAccounts: installmentAccountIds.map((accountId) => ({
      accountId,
      ...PARTNER_INSTALLMENT_ORIGIN,
    })),
    isPartnerRepayment,
  });
}

/** Lanza `BusinessError` si la pre-validación falló; si no, devuelve los avisos. */
export function assertEntryPreflight(preflight: EntryPreflight): string[] {
  if (preflight.error) throw new BusinessError(preflight.error);
  return preflight.warnings;
}
