import { z } from 'zod';

import type { PerceptionType } from '@/generated/prisma/enums';

/**
 * Percepciones e impuestos internos de una factura (TSK-644).
 *
 * Los mismos helpers los usan el formulario y el server action, así que el
 * total que ve el usuario mientras carga y el que se persiste no pueden
 * divergir (mismo criterio que `allocation-form` con el reparto por centro).
 */

export const PERCEPTION_TYPE_LABELS: Record<PerceptionType, string> = {
  IVA: 'Percepción IVA',
  IIBB: 'Percepción IIBB',
  MUNICIPAL: 'Percepción Municipal',
};

/** Orden estable para selectores y para el desglose en pantalla y PDF. */
export const PERCEPTION_TYPES: PerceptionType[] = ['IVA', 'IIBB', 'MUNICIPAL'];

const amountRegex = /^\d+(\.\d{1,2})?$/;

/** Una percepción tal como la maneja el formulario: importes como texto. */
export const perceptionSchema = z.object({
  type: z.enum(['IVA', 'IIBB', 'MUNICIPAL']),
  jurisdiction: z.string().optional(),
  baseAmount: z
    .string()
    .min(1, 'La base imponible es requerida')
    .regex(amountRegex, 'Base imponible inválida')
    .refine((v) => parseFloat(v) > 0, 'La base imponible debe ser mayor a cero'),
  amount: z
    .string()
    .min(1, 'El monto es requerido')
    .regex(amountRegex, 'Monto inválido')
    .refine((v) => parseFloat(v) > 0, 'El monto debe ser mayor a cero'),
});

export type PerceptionInput = z.infer<typeof perceptionSchema>;

/** Monto de impuestos internos: opcional, nunca negativo. */
export const internalTaxesSchema = z
  .string()
  .optional()
  .refine(
    (v) => !v || amountRegex.test(v),
    'Monto de impuestos internos inválido'
  );

/** Redondeo a centavos, el mismo que usa el resto del cálculo de totales. */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Tasa implícita de una percepción, derivada de base y monto.
 *
 * No se le pide al usuario: la factura del proveedor trae el importe, y pedir
 * además la alícuota invita a que ambos datos se contradigan. Se persiste
 * porque ARCA la exige en `alic` al informar el tributo.
 *
 * `Decimal(6,3)` en el modelo, así que se redondea a 3 decimales: una
 * percepción de centavos sobre una base grande queda en `0.000`. El importe
 * es el que manda en el total y en el asiento; la tasa es informativa.
 */
export function derivePerceptionRate(
  baseAmount: number,
  amount: number
): number {
  if (!Number.isFinite(baseAmount) || !Number.isFinite(amount)) return 0;
  if (baseAmount <= 0) return 0;
  return Math.round((amount / baseAmount) * 100 * 1000) / 1000;
}

/** Suma de las percepciones cargadas, saneando entradas a medio tipear. */
export function totalPerceptions(
  perceptions: Array<{ amount: string | number }>
): number {
  const sum = perceptions.reduce((acc, p) => {
    const value = typeof p.amount === 'string' ? parseFloat(p.amount) : p.amount;
    return acc + (Number.isFinite(value) ? value : 0);
  }, 0);
  return roundCents(sum);
}

/**
 * "Otros Tributos" del comprobante: percepciones + impuestos internos.
 *
 * Es la definición de AFIP para ese campo —incluye las percepciones—, y es la
 * que ya usaban la importación de comprobantes recibidos (`otrosTributos`) y
 * el `ImpTrib` de la emisión electrónica. El desglose vive en la tabla de
 * percepciones y en `internalTaxes`; este agregado es el que se persiste en
 * `otherTaxes` y el que entra al total.
 */
export function calculateOtherTaxes(
  perceptions: Array<{ amount: string | number }>,
  internalTaxes: string | number | null | undefined
): number {
  const internal =
    typeof internalTaxes === 'string'
      ? parseFloat(internalTaxes)
      : (internalTaxes ?? 0);
  const safeInternal = Number.isFinite(internal) ? internal : 0;
  return roundCents(totalPerceptions(perceptions) + safeInternal);
}

/**
 * Monto de impuestos internos tal como llega del formulario.
 *
 * El campo es opcional y puede llegar vacío o a medio tipear; en todos esos
 * casos vale cero, nunca `NaN`, que se propagaría al total y al asiento.
 */
export function parseInternalTaxes(
  value: string | number | null | undefined
): number {
  const parsed = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return roundCents(parsed);
}

/** Percepción lista para persistir: importes numéricos y tasa ya derivada. */
export interface PerceptionRecord {
  type: PerceptionType;
  jurisdiction: string | null;
  rate: number;
  baseAmount: number;
  amount: number;
}

/** Convierte las percepciones del formulario a filas persistibles. */
export function toPerceptionRecords(
  perceptions: PerceptionInput[]
): PerceptionRecord[] {
  return perceptions.map((p) => {
    const baseAmount = parseFloat(p.baseAmount);
    const amount = parseFloat(p.amount);

    return {
      type: p.type,
      jurisdiction: p.jurisdiction?.trim() || null,
      rate: derivePerceptionRate(baseAmount, amount),
      baseAmount,
      amount,
    };
  });
}

/**
 * Cuentas contables que necesita el asiento de un comprobante con tributos.
 *
 * Se comprueba ANTES de confirmar: si falta una cuenta, el asiento quedaría
 * descuadrado (el total incluye el tributo pero no habría contrapartida) y
 * `validateBalance` lo rechazaría dentro de la transacción, donde el error se
 * degradaba a `logger.warn` y la factura terminaba confirmada sin asiento
 * (TSK-644). Mejor no dejar confirmar y decir qué falta configurar.
 */
export interface TributeAccountCheck {
  /** Etiqueta legible del tributo, la misma que llevará la línea del asiento. */
  label: string;
  /** Cuenta configurada para ese tributo, o null/undefined si falta. */
  accountId: string | null | undefined;
}

/** Cuentas de percepción por tipo, del lado sufrido o del cobrado. */
export type PerceptionAccountMap = Partial<
  Record<PerceptionType, string | null | undefined>
>;

/** Cuenta configurada para un tipo de percepción, o null si falta. */
export function perceptionAccountId(
  type: PerceptionType,
  accounts: PerceptionAccountMap
): string | null {
  return accounts[type] ?? null;
}

/** Devuelve las etiquetas de los tributos que no tienen cuenta configurada. */
export function findMissingTributeAccounts(
  checks: TributeAccountCheck[]
): string[] {
  return checks.filter((c) => !c.accountId).map((c) => c.label);
}

/** Mensaje de error para los tributos sin cuenta contable configurada. */
export function buildMissingTributeAccountsMessage(missing: string[]): string {
  const sustantivo = missing.length === 1 ? 'la cuenta contable' : 'las cuentas contables';

  return (
    `No se puede confirmar el comprobante: falta configurar ${sustantivo} de ` +
    `${missing.join(', ')}. Cargala en Contabilidad → Configuración antes de confirmar.`
  );
}

/** Etiqueta de una percepción para asientos, detalle y PDF. */
export function perceptionLabel(perception: {
  type: PerceptionType;
  jurisdiction?: string | null;
}): string {
  const label = PERCEPTION_TYPE_LABELS[perception.type];
  return perception.jurisdiction
    ? `${label} ${perception.jurisdiction}`
    : label;
}
