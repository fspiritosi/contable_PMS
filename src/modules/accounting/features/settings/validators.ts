import { z } from 'zod';

/**
 * Campo de cuenta contable. Acepta el id de la cuenta, "__clear__" (Sin asignar),
 * cadena vacía o ausencia de valor, y normaliza todo eso a null.
 *
 * Es `nullish` a propósito: si se agrega un campo al formulario y se olvida
 * sumarlo a `defaultValues`, llega como `undefined`. Con `nullable()` eso hacía
 * fallar la validación de TODO el formulario y, al no haber `FormMessage`, el
 * botón "Guardar" no hacía nada sin mostrar ningún error (TSK-492).
 */
export const accountField = z
  .string()
  .nullish()
  .transform((val) => (!val || val === '__clear__' ? null : val));

/** Cuentas por defecto que enlazan el módulo comercial con la contabilidad. */
export const commercialIntegrationSchema = z.object({
  salesAccountId: accountField,
  purchasesAccountId: accountField,
  receivablesAccountId: accountField,
  payablesAccountId: accountField,
  vatDebitAccountId: accountField,
  vatCreditAccountId: accountField,
  defaultCashAccountId: accountField,
  defaultBankAccountId: accountField,
  expensesAccountId: accountField,
  resultAccountId: accountField,
  partnerContributionsAccountId: accountField,
  withholdingIvaEmittedAccountId: accountField,
  withholdingGananciasEmittedAccountId: accountField,
  withholdingIibbEmittedAccountId: accountField,
  withholdingSussEmittedAccountId: accountField,
  withholdingIvaSufferedAccountId: accountField,
  withholdingGananciasSufferedAccountId: accountField,
  withholdingIibbSufferedAccountId: accountField,
  withholdingSussSufferedAccountId: accountField,
  // Cuentas de Percepciones e Impuestos Internos (TSK-644). Las de percepción
  // ya existían en el modelo y el asiento las usaba, pero nunca se habían
  // expuesto acá, así que no había forma de configurarlas.
  perceptionIvaCollectedAccountId: accountField,
  perceptionIibbCollectedAccountId: accountField,
  perceptionMunicipalCollectedAccountId: accountField,
  perceptionIvaSufferedAccountId: accountField,
  perceptionIibbSufferedAccountId: accountField,
  perceptionMunicipalSufferedAccountId: accountField,
  internalTaxesAccountId: accountField,
  // Cuentas de Activos Fijos
  fixedAssetAccountId: accountField,
  accumulatedDepreciationAccountId: accountField,
  depreciationExpenseAccountId: accountField,
  assetDisposalGainLossAccountId: accountField,
  /**
   * Con esto activo, toda línea imputada a una cuenta de resultado necesita
   * reparto por centro de costo para poder confirmar la factura (TSK-583).
   */
  requireCostCenter: z.boolean().default(false),
});

/** Lo que maneja el formulario: un campo sin default llega como undefined. */
export type CommercialIntegrationInput = z.input<typeof commercialIntegrationSchema>;
/**
 * Lo que sale ya normalizado hacia el server action: los campos de cuenta
 * siempre `string | null` (por `accountField`); `requireCostCenter` siempre
 * `boolean` (TSK-583 dejó de ser cierto que todo el objeto fuera `string |
 * null`).
 */
export type CommercialIntegrationValues = z.output<typeof commercialIntegrationSchema>;
