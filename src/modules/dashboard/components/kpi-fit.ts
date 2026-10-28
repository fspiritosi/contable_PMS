// src/modules/dashboard/components/kpi-fit.ts

/** Tamaño de los montos de las cards de KPIs cuando entran holgados (= text-2xl). */
export const KPI_VALUE_MAX_REM = 1.5;

/**
 * Ancho medio de un carácter de un monto en negrita con cifras tabulares, en `em`.
 * Medido en el navegador: "$ 999.999.999.999,99" (20 caracteres) ocupa 236 px a 24 px.
 * Se redondea hacia arriba para dejar margen.
 */
const CHAR_WIDTH_EM = 0.52;

/**
 * Tamaño de fuente CSS para que un valor de `chars` caracteres entre en el ancho de su
 * card (TSK-790). Usa `cqi`, así que el valor tiene que estar dentro de un elemento con
 * `@container`. Toda la fila usa el largo del valor más largo, para que los montos
 * se vean del mismo tamaño.
 */
export function kpiValueFontSize(chars: number): string {
  const ems = Math.max(chars, 1) * CHAR_WIDTH_EM;
  return `min(${KPI_VALUE_MAX_REM}rem, calc(100cqi / ${ems.toFixed(2)}))`;
}
