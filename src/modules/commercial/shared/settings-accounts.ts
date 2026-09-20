/**
 * Cuentas de Ajustes contables que un comprobante necesita para su asiento
 * (TSK-728).
 *
 * Recibos, órdenes de pago y gastos se confirmaban aunque faltara una cuenta
 * global: la integración devolvía `null` y el action lo degradaba a un `warn`.
 * Ahora el confirm pregunta ANTES de la transacción qué cuentas faltan y
 * devuelve un mensaje que nombra cada campo con el mismo texto que muestra
 * Contabilidad → Configuración. Funciones puras: sin Prisma, sin React; el
 * registro de `AccountingSettings` entra tal cual.
 */

import {
  ACCOUNTING_SETTINGS_PATH,
  settingsAccountLabel,
  type AccountingSettingsAccountField,
} from '@/shared/lib/accounts/settings-account-labels';

/** El registro de `AccountingSettings` de Prisma (o cualquier subconjunto). */
export type SettingsAccountIds = Partial<Record<AccountingSettingsAccountField, string | null>>;

export type WithholdingTaxTypeKey = 'IVA' | 'GANANCIAS' | 'IIBB' | 'SUSS';
export type WithholdingRole = 'emitted' | 'suffered';

/**
 * Campos requeridos que no tienen cuenta. Usa `||` a propósito: una cadena
 * vacía cuenta como "sin cuenta". Conserva el orden de `required`.
 */
export function findMissingSettingsAccounts(
  settings: SettingsAccountIds,
  required: readonly AccountingSettingsAccountField[]
): AccountingSettingsAccountField[] {
  return required.filter((field) => !(settings[field] || null));
}

const WITHHOLDING_SETTINGS_FIELD: Record<
  WithholdingRole,
  Record<WithholdingTaxTypeKey, AccountingSettingsAccountField>
> = {
  emitted: {
    IVA: 'withholdingIvaEmittedAccountId',
    GANANCIAS: 'withholdingGananciasEmittedAccountId',
    IIBB: 'withholdingIibbEmittedAccountId',
    SUSS: 'withholdingSussEmittedAccountId',
  },
  suffered: {
    IVA: 'withholdingIvaSufferedAccountId',
    GANANCIAS: 'withholdingGananciasSufferedAccountId',
    IIBB: 'withholdingIibbSufferedAccountId',
    SUSS: 'withholdingSussSufferedAccountId',
  },
};

/**
 * Campo de Ajustes donde se configura la cuenta de una retención: emitida
 * (la empresa retiene al proveedor, OP) o sufrida (el cliente le retiene a la
 * empresa, recibo).
 */
export function withholdingSettingsField(
  taxType: WithholdingTaxTypeKey,
  role: WithholdingRole
): AccountingSettingsAccountField {
  return WITHHOLDING_SETTINGS_FIELD[role][taxType];
}

/** `"A"`, `"A" y "B"`, `"A", "B" y "C"`. */
function joinLabels(fields: readonly AccountingSettingsAccountField[]): string {
  const labels = fields.map(settingsAccountLabel);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

/**
 * Aviso al confirmar: qué cuentas de Ajustes faltan y dónde se cargan.
 * `documentLabel` ya viene con artículo: "el recibo R-00012".
 */
export function buildMissingSettingsAccountsMessage(
  documentLabel: string,
  missing: readonly AccountingSettingsAccountField[]
): string {
  return (
    `No se puede confirmar ${documentLabel}: falta configurar ${joinLabels(missing)} ` +
    `en ${ACCOUNTING_SETTINGS_PATH}.`
  );
}
