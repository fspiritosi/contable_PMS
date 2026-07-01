/**
 * Normalización y validación del código contable al formato canónico `x.x.x/xx/xx`.
 *
 * Regla (ticket #376, decisión 1.7.4):
 * - El código se compone de hasta 3 grupos separados por `/`:
 *     1) `x.x.x` (3 segmentos separados por `.`)
 *     2) `xx`    (auxiliar 1)
 *     3) `xx`    (auxiliar 2)
 * - Los segmentos ausentes o vacíos se rellenan con `0`.
 * - Todos los segmentos deben ser numéricos.
 * - El PRIMER segmento del primer grupo nunca puede ser `0`.
 *
 * Es una función PURA y síncrona: se reutiliza en el script de normalización de
 * datos (Fase 1), en el form de alta/edición y en el import de Excel (Fase 2/3),
 * para que la lógica coincida en todos los puntos de entrada.
 */

export class AccountCodeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountCodeFormatError';
  }
}

/**
 * Normaliza un código contable al formato canónico `A.B.C/DD/EE`.
 *
 * @throws {AccountCodeFormatError} si algún segmento no es numérico o el primer segmento es 0.
 * @returns el código normalizado listo para persistir.
 */
export function validateAccountCodeFormat(code: string): string {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new AccountCodeFormatError('El código de cuenta no puede estar vacío');
  }

  const raw = code.trim();

  // Separar en grupos por "/" (máximo 3: [x.x.x], [xx], [xx])
  const groups = raw.split('/');
  if (groups.length > 3) {
    throw new AccountCodeFormatError(
      `El código "${code}" tiene demasiados grupos (formato esperado x.x.x/xx/xx)`
    );
  }

  // Grupo 1: jerarquía x.x.x (3 segmentos)
  const hierarchyRaw = groups[0] ?? '';
  const hierarchySegments = hierarchyRaw.split('.');
  if (hierarchySegments.length > 3) {
    throw new AccountCodeFormatError(
      `El código "${code}" tiene demasiados niveles en la jerarquía (máximo x.x.x)`
    );
  }

  // Normalizar los 3 segmentos de jerarquía (vacíos -> 0)
  const hierarchy = normalizeSegments(hierarchySegments, 3, code);

  // El primer segmento nunca puede ser 0
  if (hierarchy[0] === 0) {
    throw new AccountCodeFormatError(
      `El código "${code}" no puede tener 0 como primer segmento`
    );
  }

  // Grupos auxiliares (2 dígitos cada uno, vacíos -> 0)
  const aux1 = normalizeAuxGroup(groups[1] ?? '', code);
  const aux2 = normalizeAuxGroup(groups[2] ?? '', code);

  const hierarchyStr = hierarchy.join('.');
  const aux1Str = String(aux1).padStart(2, '0');
  const aux2Str = String(aux2).padStart(2, '0');

  return `${hierarchyStr}/${aux1Str}/${aux2Str}`;
}

/**
 * Normaliza un arreglo de segmentos numéricos a longitud fija, rellenando con 0.
 */
function normalizeSegments(segments: string[], length: number, originalCode: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < length; i++) {
    const seg = (segments[i] ?? '').trim();
    if (seg === '') {
      result.push(0);
      continue;
    }
    if (!/^\d+$/.test(seg)) {
      throw new AccountCodeFormatError(
        `El código "${originalCode}" contiene un segmento no numérico: "${seg}"`
      );
    }
    result.push(parseInt(seg, 10));
  }
  return result;
}

/**
 * Normaliza un grupo auxiliar (un solo número). Vacío -> 0.
 */
function normalizeAuxGroup(group: string, originalCode: string): number {
  const seg = group.trim();
  if (seg === '') return 0;
  if (!/^\d+$/.test(seg)) {
    throw new AccountCodeFormatError(
      `El código "${originalCode}" contiene un grupo auxiliar no numérico: "${seg}"`
    );
  }
  return parseInt(seg, 10);
}
