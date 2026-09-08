import { describe, it, expect } from 'vitest';
import {
  collectSubtreeIds,
  resolveFixedAssetCascade,
  type AccountNodeRef,
} from './account-subtree';

/**
 * Plan de cuentas de prueba, calcado del de la clienta (TSK-618):
 *
 *   rubro (1.2.2 BIENES DE USO)
 *     ├── inmuebles (1.2.2/01/00)
 *     │     ├── valores        (1.2.2/01/01)
 *     │     └── amortizaciones (1.2.2/01/03)  ← la excepción destildada a mano
 *     └── rodados   (1.2.2/04/00)
 *   otroRubro (1.2.1) — fuera del subárbol
 */
const PLAN: AccountNodeRef[] = [
  { id: 'rubro', parentId: null },
  { id: 'inmuebles', parentId: 'rubro' },
  { id: 'valores', parentId: 'inmuebles' },
  { id: 'amortizaciones', parentId: 'inmuebles' },
  { id: 'rodados', parentId: 'rubro' },
  { id: 'otroRubro', parentId: null },
  { id: 'otraHija', parentId: 'otroRubro' },
];

describe('collectSubtreeIds', () => {
  it('devuelve la raíz primero y después todos sus descendientes', () => {
    const ids = collectSubtreeIds(PLAN, 'rubro');

    expect(ids[0]).toBe('rubro');
    expect([...ids].sort()).toEqual(
      ['amortizaciones', 'inmuebles', 'rodados', 'rubro', 'valores'].sort()
    );
  });

  it('baja tres niveles completos', () => {
    // valores y amortizaciones son nietas del rubro: la pila no puede quedarse
    // en el primer nivel de hijas.
    expect(collectSubtreeIds(PLAN, 'rubro')).toContain('valores');
    expect(collectSubtreeIds(PLAN, 'rubro')).toContain('amortizaciones');
  });

  it('no se lleva puestas las cuentas de otras ramas', () => {
    const ids = collectSubtreeIds(PLAN, 'rubro');

    expect(ids).not.toContain('otroRubro');
    expect(ids).not.toContain('otraHija');
  });

  it('sobre una hoja devuelve solo la hoja', () => {
    expect(collectSubtreeIds(PLAN, 'valores')).toEqual(['valores']);
  });

  it('devuelve la raíz aunque no esté en la lista (mismo comportamiento que el DFS anterior)', () => {
    expect(collectSubtreeIds([], 'inexistente')).toEqual(['inexistente']);
  });

  it('no entra en bucle con una lista vacía de hijas', () => {
    expect(collectSubtreeIds(PLAN, 'otroRubro')).toEqual(['otroRubro', 'otraHija']);
  });
});

describe('resolveFixedAssetCascade', () => {
  it('propaga cuando el usuario tilda el flag (false → true)', () => {
    expect(
      resolveFixedAssetCascade({
        current: false,
        input: true,
        parentChanged: false,
        newParentIsFixedAsset: null,
      })
    ).toEqual({ value: true, reason: 'FLAG_CHANGED' });
  });

  it('propaga cuando el usuario destilda el flag (true → false)', () => {
    expect(
      resolveFixedAssetCascade({
        current: true,
        input: false,
        parentChanged: false,
        newParentIsFixedAsset: null,
      })
    ).toEqual({ value: false, reason: 'FLAG_CHANGED' });
  });

  it('NO propaga cuando el guardado manda el mismo valor que ya tenía', () => {
    // Es el caso de editar solo el nombre del rubro: el formulario reenvía el
    // flag sin cambios. Si esto propagara, se pisarían las Amortizaciones
    // Acumuladas que el usuario destildó a mano.
    expect(
      resolveFixedAssetCascade({
        current: true,
        input: true,
        parentChanged: false,
        newParentIsFixedAsset: null,
      })
    ).toBeNull();
  });

  it('NO propaga cuando el formulario no manda el flag', () => {
    expect(
      resolveFixedAssetCascade({
        current: true,
        input: undefined,
        parentChanged: false,
        newParentIsFixedAsset: null,
      })
    ).toBeNull();
  });

  it('propaga al mover la cuenta a un rubro con OTRO valor', () => {
    expect(
      resolveFixedAssetCascade({
        current: false,
        input: false,
        parentChanged: true,
        newParentIsFixedAsset: true,
      })
    ).toEqual({ value: true, reason: 'PARENT_CHANGED' });
  });

  it('NO propaga al mover la cuenta a un rubro con el MISMO valor', () => {
    // Reescribir el subárbol con el mismo valor también borraría las excepciones.
    expect(
      resolveFixedAssetCascade({
        current: true,
        input: true,
        parentChanged: true,
        newParentIsFixedAsset: true,
      })
    ).toBeNull();
  });

  it('NO propaga cuando la cuenta queda sin padre (pasa a ser raíz)', () => {
    expect(
      resolveFixedAssetCascade({
        current: true,
        input: undefined,
        parentChanged: true,
        newParentIsFixedAsset: null,
      })
    ).toBeNull();
  });

  it('si el flag y el padre cambian en el mismo guardado, manda el flag explícito', () => {
    expect(
      resolveFixedAssetCascade({
        current: false,
        input: true,
        parentChanged: true,
        newParentIsFixedAsset: false,
      })
    ).toEqual({ value: true, reason: 'FLAG_CHANGED' });
  });
});

describe('la excepción destildada a mano sobrevive a una edición del rubro', () => {
  /**
   * Simulacro del escenario completo que motiva el diseño: el rubro está
   * marcado, la cuenta de Amortizaciones Acumuladas fue destildada a mano y
   * después alguien corrige el NOMBRE del rubro.
   */
  const estado = new Map<string, boolean>([
    ['rubro', true],
    ['inmuebles', true],
    ['valores', true],
    ['amortizaciones', false], // ← destildada a mano
    ['rodados', true],
  ]);

  function guardarRubro(input: boolean | undefined): void {
    const cascade = resolveFixedAssetCascade({
      current: estado.get('rubro')!,
      input,
      parentChanged: false,
      newParentIsFixedAsset: null,
    });
    if (!cascade) return;
    for (const id of collectSubtreeIds(PLAN, 'rubro')) {
      estado.set(id, cascade.value);
    }
  }

  it('editar el nombre del rubro no vuelve a marcar la hija destildada', () => {
    guardarRubro(true); // el formulario reenvía el flag sin tocarlo

    expect(estado.get('amortizaciones')).toBe(false);
    expect(estado.get('valores')).toBe(true);
  });

  it('destildar y volver a tildar el rubro sí reescribe todo el subárbol', () => {
    guardarRubro(false);
    expect(estado.get('valores')).toBe(false);

    guardarRubro(true);
    expect(estado.get('amortizaciones')).toBe(true);
    expect(estado.get('valores')).toBe(true);
  });
});
