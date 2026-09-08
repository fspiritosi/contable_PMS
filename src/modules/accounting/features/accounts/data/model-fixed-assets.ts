/**
 * Rubros del Plan de Cuentas Modelo que nacen marcados como Bien de Uso
 * (TSK-618, decisión 3 del análisis).
 *
 * Vive en un archivo aparte de `model-chart-of-accounts.ts` porque ese dataset
 * se regenera desde `docs/contable/Plantilla_Plan_de_Cuentas_6559_0006.xls` y
 * lleva escrito "NO editar a mano": la marca tiene que sobrevivir a una
 * regeneración.
 *
 * El prefijo cubre las 31 cuentas de `1.2.2/*` del dataset —el rubro BIENES DE
 * USO, sus ocho sub-rubros y las imputables de cada uno— y ninguna otra.
 *
 * Incluye a propósito las Amortizaciones Acumuladas: el criterio es "el rubro
 * entero", igual que la cascada del ABM, y quien quiera la excepción la
 * destilda desde el plan de cuentas.
 */
export const MODEL_FIXED_ASSET_CODE_PREFIXES = ['1.2.2'] as const;

/**
 * `true` si el código pertenece a alguno de los rubros de Bienes de Uso del
 * plan modelo.
 *
 * El `startsWith` compara contra `'1.2.2/'` con la barra incluida, para que un
 * futuro `1.2.20` no entre por accidente (hoy el formato `x.x.x/xx/xx` lo hace
 * imposible, pero la función no depende de eso).
 */
export function isModelFixedAssetCode(code: string): boolean {
  return MODEL_FIXED_ASSET_CODE_PREFIXES.some(
    (prefix) => code === prefix || code.startsWith(`${prefix}/`)
  );
}
