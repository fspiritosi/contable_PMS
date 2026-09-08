/**
 * Cuándo una línea de factura de compra se imputa a un Bien de Uso (TSK-618).
 *
 * La clienta pidió que el sistema **sugiera** —sin obligar— adjuntar el escaneo
 * del comprobante cuando la compra es de un bien de uso, porque el contador
 * después le pide ese detalle para el anexo y el cuadro de amortizaciones.
 *
 * El criterio vive acá, puro y sin base, para que el formulario de carga y el
 * detalle de la factura usen exactamente la misma regla (mismo patrón que
 * `cost-center.ts` con el centro de costo).
 */

/**
 * Espejo exacto de `effectiveAccountType` (`cost-center.ts:37-42`).
 *
 * `accountIsFixedAsset` es la marca de la cuenta propia del ítem. Cuando el
 * ítem no tiene una cuenta de egresos cargada, el asiento no deja la línea sin
 * imputar: cae en `purchasesAccountId`
 * (`accounting/features/integrations/commercial/index.ts:505`), así que el
 * criterio tiene que mirar esa cuenta efectiva.
 *
 * OJO con el `null`: "el ítem no tiene cuenta" (`null`/`undefined`) y "el ítem
 * tiene una cuenta que no es Bien de Uso" (`false`) NO son lo mismo. Solo el
 * primero cae en la cuenta por defecto. Por eso `getProductsForSelect` mapea
 * con `?? null` y no con `?? false`: con `false` el fallback nunca se aplicaría
 * y volveríamos al falso negativo que TSK-583 arregló.
 */
export function effectiveIsFixedAsset(
  accountIsFixedAsset: boolean | null | undefined,
  defaultIsFixedAsset: boolean | null | undefined
): boolean {
  return accountIsFixedAsset ?? defaultIsFixedAsset ?? false;
}

/**
 * Una línea de factura, vista desde la sugerencia de adjuntar.
 *
 * `isFixedAsset` es la marca ya resuelta con `effectiveIsFixedAsset`: quien
 * arma las líneas es el que conoce la cuenta del ítem y la de la empresa.
 */
export interface FixedAssetLineCheck {
  description: string;
  isFixedAsset?: boolean | null;
}

/** Líneas que se imputan a una cuenta marcada como Bien de Uso. Conserva el orden. */
export function findFixedAssetLines<T extends FixedAssetLineCheck>(lines: T[]): T[] {
  return lines.filter((line) => line.isFixedAsset === true);
}

/** Con qué se nombra una línea a la que todavía no le escribieron la descripción. */
const SIN_DESCRIPCION = '(sin descripción)';

/** Nombre de la línea entre comillas, nunca vacío. */
function quoteDescription(line: FixedAssetLineCheck): string {
  const descripcion = line.description.trim() || SIN_DESCRIPCION;

  return `«${descripcion}»`;
}

/**
 * Enumeración de las líneas involucradas, con singular/plural, en un solo lugar
 * para el formulario y el detalle (mismo patrón que
 * `buildMissingCostCenterMessage`).
 *
 * Devuelve `''` con la lista vacía: sin líneas de Bien de Uso no hay aviso que
 * mostrar, y el llamador no tiene que acordarse de chequear la longitud.
 */
export function buildFixedAssetSuggestionMessage(lines: FixedAssetLineCheck[]): string {
  if (lines.length === 0) return '';

  if (lines.length === 1) {
    return `La línea ${quoteDescription(lines[0])} se imputa a una cuenta de Bienes de Uso.`;
  }

  const nombres = lines.map(quoteDescription).join(', ');

  return `Hay ${lines.length} líneas imputadas a cuentas de Bienes de Uso: ${nombres}.`;
}

/**
 * Aviso del formulario de carga: la factura todavía no existe, así que el
 * adjunto se sube después, desde el detalle (no se agrega dropzone acá).
 */
export const FIXED_ASSET_ATTACHMENT_SUGGESTION =
  'Esta factura incluye bienes de uso. Sería ideal que cargues el escaneo o la imagen ' +
  'del comprobante: vas a poder adjuntarlo al guardar, desde el detalle de la factura.';

/** Aviso persistente del detalle, mientras la factura siga sin comprobante adjunto. */
export const FIXED_ASSET_ATTACHMENT_PENDING =
  'Esta factura incluye bienes de uso y todavía no tiene el comprobante adjunto. Sería ' +
  'ideal que cargues el escaneo o la imagen de la factura: el contador la necesita para ' +
  'el anexo de bienes de uso y el cuadro de amortizaciones.';
