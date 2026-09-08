import { describe, expect, it } from 'vitest';

import {
  FIXED_ASSET_ATTACHMENT_PENDING,
  FIXED_ASSET_ATTACHMENT_SUGGESTION,
  buildFixedAssetSuggestionMessage,
  effectiveIsFixedAsset,
  findFixedAssetLines,
  type FixedAssetLineCheck,
} from './fixed-asset';

/**
 * Espejo del test de `effectiveAccountType` (TSK-583).
 *
 * La marca que importa no es la de la cuenta del ítem sino la de la cuenta que
 * el asiento va a imputar de verdad: la del ítem si la tiene, y si no la de
 * compras por defecto de la empresa
 * (`accounting/features/integrations/commercial/index.ts:505`).
 */
describe('marca efectiva de Bien de Uso de una línea (TSK-618)', () => {
  it('usa la marca de la cuenta del ítem cuando el ítem tiene cuenta', () => {
    expect(effectiveIsFixedAsset(true, false)).toBe(true);
  });

  it('la cuenta del ítem manda aunque la cuenta por defecto esté marcada', () => {
    expect(effectiveIsFixedAsset(false, true)).toBe(false);
  });

  it('cae en la cuenta por defecto de la empresa si el ítem no tiene cuenta propia', () => {
    expect(effectiveIsFixedAsset(null, true)).toBe(true);
    expect(effectiveIsFixedAsset(undefined, true)).toBe(true);
  });

  it('sin cuenta propia ni cuenta por defecto marcada, no es Bien de Uso', () => {
    expect(effectiveIsFixedAsset(null, false)).toBe(false);
    expect(effectiveIsFixedAsset(undefined, undefined)).toBe(false);
    expect(effectiveIsFixedAsset(null, null)).toBe(false);
  });

  /**
   * El punto más fácil de romper del ticket, y la razón por la que
   * `getProductsForSelect` mapea con `?? null` y no con `?? false`:
   *
   *  - `null`  = "el ítem no tiene cuenta de egresos" → cae en la cuenta por
   *              defecto, y hereda su marca.
   *  - `false` = "el ítem tiene una cuenta y esa cuenta no es Bien de Uso" →
   *              NO cae en la cuenta por defecto.
   *
   * Es el mismo falso negativo que TSK-583 arregló con `effectiveAccountType`.
   */
  it('distingue "el ítem no tiene cuenta" (null) de "tiene una que no es BU" (false)', () => {
    expect(effectiveIsFixedAsset(null, true)).toBe(true);
    expect(effectiveIsFixedAsset(false, true)).toBe(false);
  });
});

/**
 * Los cuatro escenarios de carga, tal como llegan del formulario: la línea
 * resuelve su marca con `effectiveIsFixedAsset` y `findFixedAssetLines`
 * se queda con las que disparan el aviso.
 */
const LINEAS: FixedAssetLineCheck[] = [
  // Ítem con cuenta marcada como Bien de Uso.
  { description: 'Rodado Ford Ranger', isFixedAsset: effectiveIsFixedAsset(true, false) },
  // Ítem con cuenta de gasto común.
  { description: 'Combustible', isFixedAsset: effectiveIsFixedAsset(false, false) },
  // Ítem sin cuenta de egresos: cae en la cuenta de compras por defecto, que no está marcada.
  { description: 'Servicio de flete', isFixedAsset: effectiveIsFixedAsset(null, false) },
  // Línea sin ítem: idem, cae en la cuenta por defecto.
  { description: 'Gasto suelto', isFixedAsset: effectiveIsFixedAsset(undefined, false) },
];

describe('líneas que disparan la sugerencia de adjuntar el comprobante', () => {
  it('dispara con la línea imputada a una cuenta marcada', () => {
    expect(findFixedAssetLines(LINEAS).map((l) => l.description)).toEqual([
      'Rodado Ford Ranger',
    ]);
  });

  it('no dispara con un ítem cuya cuenta no está marcada', () => {
    const gasto = LINEAS.filter((l) => l.description === 'Combustible');
    expect(findFixedAssetLines(gasto)).toEqual([]);
  });

  /** Corolario de 1.2.4: sin ítem no hay cuenta propia, se cae en la de compras. */
  it('no dispara con una línea sin ítem cuando la cuenta por defecto no está marcada', () => {
    const suelta = LINEAS.filter((l) => l.description === 'Gasto suelto');
    expect(findFixedAssetLines(suelta)).toEqual([]);
  });

  it('dispara con una línea sin ítem si la cuenta por defecto sí está marcada', () => {
    const suelta: FixedAssetLineCheck[] = [
      { description: 'Gasto suelto', isFixedAsset: effectiveIsFixedAsset(undefined, true) },
    ];
    expect(findFixedAssetLines(suelta).map((l) => l.description)).toEqual(['Gasto suelto']);
  });

  it('no dispara con un ítem sin cuenta de egresos cuando la cuenta por defecto no está marcada', () => {
    const flete = LINEAS.filter((l) => l.description === 'Servicio de flete');
    expect(findFixedAssetLines(flete)).toEqual([]);
  });

  it('devuelve solo las líneas de Bien de Uso y conserva el orden', () => {
    const mezcladas: FixedAssetLineCheck[] = [
      { description: 'Combustible', isFixedAsset: false },
      { description: 'Rodado Ford Ranger', isFixedAsset: true },
      { description: 'Gasto suelto', isFixedAsset: null },
      { description: 'Instalación de balanza', isFixedAsset: true },
    ];
    expect(findFixedAssetLines(mezcladas).map((l) => l.description)).toEqual([
      'Rodado Ford Ranger',
      'Instalación de balanza',
    ]);
  });

  it('sin ninguna línea de Bien de Uso devuelve un array vacío', () => {
    expect(findFixedAssetLines([])).toEqual([]);
    expect(
      findFixedAssetLines([{ description: 'Combustible', isFixedAsset: false }])
    ).toEqual([]);
  });

  it('conserva los campos extra de la línea que le pase el llamador', () => {
    const lineas = [
      { description: 'Rodado Ford Ranger', isFixedAsset: true, index: 3 },
      { description: 'Combustible', isFixedAsset: false, index: 4 },
    ];
    expect(findFixedAssetLines(lineas)).toEqual([
      { description: 'Rodado Ford Ranger', isFixedAsset: true, index: 3 },
    ]);
  });
});

/**
 * Empresa sin contabilidad activa: no hay plan de cuentas ni
 * `AccountingSettings`, así que ningún ítem tiene cuenta y la cuenta por
 * defecto no existe. El aviso nunca aparece, y sin errores.
 */
describe('empresa sin contabilidad activa', () => {
  it('no dispara el aviso en ninguna línea', () => {
    const lineas: FixedAssetLineCheck[] = [
      { description: 'Rodado Ford Ranger', isFixedAsset: effectiveIsFixedAsset(null, false) },
      { description: 'Combustible', isFixedAsset: effectiveIsFixedAsset(undefined, false) },
    ];
    expect(findFixedAssetLines(lineas)).toEqual([]);
    expect(buildFixedAssetSuggestionMessage(findFixedAssetLines(lineas))).toBe('');
  });
});

describe('mensaje del aviso', () => {
  it('no arma nada con la lista vacía', () => {
    expect(buildFixedAssetSuggestionMessage([])).toBe('');
  });

  it('usa el singular con una sola línea', () => {
    expect(
      buildFixedAssetSuggestionMessage([
        { description: 'Rodado Ford Ranger', isFixedAsset: true },
      ])
    ).toBe('La línea «Rodado Ford Ranger» se imputa a una cuenta de Bienes de Uso.');
  });

  it('usa el plural y enumera con dos o más líneas', () => {
    expect(
      buildFixedAssetSuggestionMessage([
        { description: 'Rodado Ford Ranger', isFixedAsset: true },
        { description: 'Instalación de balanza', isFixedAsset: true },
      ])
    ).toBe(
      'Hay 2 líneas imputadas a cuentas de Bienes de Uso: «Rodado Ford Ranger», «Instalación de balanza».'
    );
  });

  /** El aviso nunca debe quedar con comillas vacías mientras se carga la línea. */
  it('reemplaza la descripción vacía por un texto legible', () => {
    expect(
      buildFixedAssetSuggestionMessage([{ description: '   ', isFixedAsset: true }])
    ).toBe('La línea «(sin descripción)» se imputa a una cuenta de Bienes de Uso.');
  });
});

describe('textos fijos del aviso', () => {
  it('sugiere adjuntar sin obligar, como pidió el ticket', () => {
    expect(FIXED_ASSET_ATTACHMENT_SUGGESTION).toContain('Sería ideal que cargues');
    expect(FIXED_ASSET_ATTACHMENT_SUGGESTION).not.toContain('obligatorio');
  });

  it('el aviso del detalle recuerda que el adjunto sigue faltando', () => {
    expect(FIXED_ASSET_ATTACHMENT_PENDING).toContain('todavía no tiene el comprobante adjunto');
  });
});
