/**
 * Nombre en pantalla de cada cuenta de Ajustes contables (TSK-728).
 *
 * Los mensajes de error al confirmar un comprobante ("falta configurar
 * "Cuentas por Cobrar" en Contabilidad → Configuración") tienen que decir el
 * nombre EXACTO del campo tal como lo ve el usuario en el formulario. Ese
 * formulario vive en `accounting` y los mensajes en `commercial`, dos módulos
 * que no pueden importarse entre sí: por eso los textos viven acá, en
 * `shared/lib`, y los dos leen de la misma constante. Sin Prisma, sin React.
 *
 * Los nombres de campo son los de `commercialIntegrationSchema`
 * (`accounting/features/settings/validators.ts`); un test de ese schema
 * verifica que cada `*AccountId` tenga label.
 */

export const ACCOUNTING_SETTINGS_ACCOUNT_FIELDS = [
  'salesAccountId',
  'purchasesAccountId',
  'expensesAccountId',
  'receivablesAccountId',
  'payablesAccountId',
  'vatDebitAccountId',
  'vatCreditAccountId',
  'defaultCashAccountId',
  'defaultBankAccountId',
  'bankChargesAccountId',
  'resultAccountId',
  'partnerContributionsAccountId',
  'withholdingIvaEmittedAccountId',
  'withholdingGananciasEmittedAccountId',
  'withholdingIibbEmittedAccountId',
  'withholdingSussEmittedAccountId',
  'withholdingIvaSufferedAccountId',
  'withholdingGananciasSufferedAccountId',
  'withholdingIibbSufferedAccountId',
  'withholdingSussSufferedAccountId',
  'perceptionIvaCollectedAccountId',
  'perceptionIibbCollectedAccountId',
  'perceptionMunicipalCollectedAccountId',
  'perceptionIvaSufferedAccountId',
  'perceptionIibbSufferedAccountId',
  'perceptionMunicipalSufferedAccountId',
  'internalTaxesAccountId',
  'fixedAssetAccountId',
  'accumulatedDepreciationAccountId',
  'depreciationExpenseAccountId',
  'assetDisposalGainLossAccountId',
] as const;

export type AccountingSettingsAccountField = (typeof ACCOUNTING_SETTINGS_ACCOUNT_FIELDS)[number];

/** Texto literal del `label` de cada campo en Contabilidad → Configuración. */
export const ACCOUNTING_SETTINGS_ACCOUNT_LABELS: Record<AccountingSettingsAccountField, string> = {
  salesAccountId: 'Cuenta de ventas por defecto',
  purchasesAccountId: 'Cuenta de compras por defecto',
  expensesAccountId: 'Cuenta de Gastos Operativos',
  receivablesAccountId: 'Cuentas por Cobrar',
  payablesAccountId: 'Cuentas por Pagar',
  vatDebitAccountId: 'IVA Débito Fiscal',
  vatCreditAccountId: 'IVA Crédito Fiscal',
  defaultCashAccountId: 'Caja por Defecto',
  defaultBankAccountId: 'Banco por Defecto',
  bankChargesAccountId: 'Gastos bancarios por defecto',
  resultAccountId: 'Cuenta de Resultado del Ejercicio',
  partnerContributionsAccountId: 'Cuenta de aportes de socios por defecto',
  withholdingIvaEmittedAccountId: 'Ret. IVA Emitida',
  withholdingGananciasEmittedAccountId: 'Ret. Ganancias Emitida',
  withholdingIibbEmittedAccountId: 'Ret. IIBB Emitida',
  withholdingSussEmittedAccountId: 'Ret. SUSS Emitida',
  withholdingIvaSufferedAccountId: 'Ret. IVA Sufrida',
  withholdingGananciasSufferedAccountId: 'Ret. Ganancias Sufrida',
  withholdingIibbSufferedAccountId: 'Ret. IIBB Sufrida',
  withholdingSussSufferedAccountId: 'Ret. SUSS Sufrida',
  perceptionIvaCollectedAccountId: 'Perc. IVA Cobrada',
  perceptionIibbCollectedAccountId: 'Perc. IIBB Cobrada',
  perceptionMunicipalCollectedAccountId: 'Perc. Municipal Cobrada',
  perceptionIvaSufferedAccountId: 'Perc. IVA Sufrida',
  perceptionIibbSufferedAccountId: 'Perc. IIBB Sufrida',
  perceptionMunicipalSufferedAccountId: 'Perc. Municipal Sufrida',
  internalTaxesAccountId: 'Impuestos Internos',
  fixedAssetAccountId: 'Cuenta de Bienes de Uso por defecto',
  accumulatedDepreciationAccountId: 'Amortización acumulada por defecto',
  depreciationExpenseAccountId: 'Gasto de amortización por defecto',
  assetDisposalGainLossAccountId: 'Resultado por venta/baja de Bienes de Uso',
};

/** El "dónde" de todos los mensajes que mandan a configurar una cuenta. */
export const ACCOUNTING_SETTINGS_PATH = 'Contabilidad → Configuración';

/** El label entre comillas dobles, como lo escriben los mensajes desde TSK-721. */
export function settingsAccountLabel(field: AccountingSettingsAccountField): string {
  return `"${ACCOUNTING_SETTINGS_ACCOUNT_LABELS[field]}"`;
}
