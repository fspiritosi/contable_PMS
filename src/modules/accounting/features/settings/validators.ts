import moment from 'moment';
import { z } from 'zod';

import type { IsoDay } from '../../shared/utils/journal-entry-types';
import { parseIsoDay } from '../../shared/utils/utc-month';

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
  // TSK-718: se preselecciona en cada concepto de "Gastos e impuestos bancarios".
  bankChargesAccountId: accountField,
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

// ---------------------------------------------------------------------------
// Ejercicio fiscal (TSK-760, B23/D11/C3). Puro: lo usan el formulario y la action.
// ---------------------------------------------------------------------------

/** Lo que ve el formulario de Ajustes: el ejercicio abierto más antiguo. */
export interface FiscalYearSettingsView {
  fiscalYearNumber: number;
  startDay: IsoDay;
  endDay: IsoDay;
  /** Sin asientos en la empresa, sin meses ni ejercicios cerrados (C3/D11). */
  datesEditable: boolean;
}

export const FISCAL_YEAR_WHOLE_MONTHS_MESSAGE =
  'El ejercicio tiene que empezar el primer día de un mes y terminar el último día de un mes.';

/**
 * Valida un rango de ejercicio en días 'YYYY-MM-DD': fechas válidas, fin posterior al
 * inicio, meses completos (día 1 a fin de mes) y 12 meses como máximo. Devuelve el
 * mensaje del primer problema o `null`.
 */
export function validateFiscalYearRange(startDay: IsoDay, endDay: IsoDay): string | null {
  let start: Date;
  let end: Date;
  try {
    start = parseIsoDay(startDay);
    end = parseIsoDay(endDay);
  } catch (error) {
    return error instanceof Error ? error.message : 'Fecha inválida.';
  }
  if (end <= start) return 'La fecha de fin debe ser posterior a la fecha de inicio';
  const startM = moment.utc(start);
  const endM = moment.utc(end);
  if (startM.date() !== 1 || endM.date() !== endM.daysInMonth()) {
    return FISCAL_YEAR_WHOLE_MONTHS_MESSAGE;
  }
  if (endM.diff(startM, 'months') + 1 > 12)
    return 'El ejercicio fiscal no puede ser mayor a un año';
  return null;
}

export const fiscalYearSettingsSchema = z
  .object({
    startDay: z.string().min(1, 'Ingresá la fecha de inicio'),
    endDay: z.string().min(1, 'Ingresá la fecha de fin'),
  })
  .superRefine((value, ctx) => {
    const error = validateFiscalYearRange(value.startDay, value.endDay);
    if (error) ctx.addIssue({ code: 'custom', message: error, path: ['endDay'] });
  });

export type FiscalYearSettingsInput = z.infer<typeof fiscalYearSettingsSchema>;
