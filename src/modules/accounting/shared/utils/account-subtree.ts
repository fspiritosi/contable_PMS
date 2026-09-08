/**
 * Recorrido del subárbol del plan de cuentas y decisión de cascada del flag
 * "Bien de Uso" (TSK-618).
 *
 * Vive fuera de `utils/index.ts` a propósito: ese archivo arrastra dependencias
 * de servidor (`next/cache`) y estas funciones tienen que poder testearse sin
 * base y sin Next.
 */

/** Una cuenta, vista desde el recorrido del árbol. */
export interface AccountNodeRef {
  id: string;
  parentId: string | null;
}

/**
 * IDs de la cuenta raíz y de TODOS sus descendientes, con la raíz primero.
 *
 * Mismo algoritmo que usaba `disableAccount` inline
 * (`accounts/actions.server.ts`): índice `childrenByParent` + pila. Función
 * PURA: recibe la lista plana ya leída de la base, no consulta nada.
 *
 * Devuelve siempre la raíz, exista o no en `accounts`, para conservar el
 * comportamiento observable del código que reemplaza.
 */
export function collectSubtreeIds(accounts: AccountNodeRef[], rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const account of accounts) {
    if (account.parentId) {
      const list = childrenByParent.get(account.parentId) ?? [];
      list.push(account.id);
      childrenByParent.set(account.parentId, list);
    }
  }

  const subtreeIds: string[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    subtreeIds.push(id);
    const children = childrenByParent.get(id);
    if (children) stack.push(...children);
  }

  return subtreeIds;
}

/** Por qué se propaga la marca de Bien de Uso al subárbol. */
export type FixedAssetCascadeReason = 'FLAG_CHANGED' | 'PARENT_CHANGED';

export interface FixedAssetCascade {
  /** Valor a escribir en la raíz y en todo su subárbol. */
  value: boolean;
  reason: FixedAssetCascadeReason;
}

/**
 * Decide SI hay que propagar la marca de Bien de Uso y con qué valor.
 * `null` = no propagar nada.
 *
 * ESTE ES EL PUNTO MÁS DELICADO DEL TICKET. La cascada se dispara únicamente
 * cuando el valor efectivo CAMBIA:
 *
 *  - `input === undefined`             → el formulario no mandó el flag: no se propaga.
 *  - `input === current`               → guardaron el rubro sin tocar el tilde (p. ej.
 *                                        editando solo el nombre): NO se propaga, o se
 *                                        pisarían las excepciones destildadas a mano,
 *                                        como las Amortizaciones Acumuladas.
 *  - `input !== current`               → cascada con `input`, razón FLAG_CHANGED.
 *  - cambió el padre y el padre nuevo  → cascada con el valor del padre, razón
 *    tiene otro valor                    PARENT_CHANGED.
 *  - cambió el padre pero tiene el      → NO se propaga: reescribir el subárbol con el
 *    mismo valor                         mismo valor también borraría las excepciones.
 *  - se quedó sin padre (raíz)          → no hay de quién heredar: no se propaga.
 *
 * Si el flag cambió Y el padre cambió en el mismo guardado, manda el flag
 * explícito: es lo que el usuario acaba de tildar en pantalla.
 */
export function resolveFixedAssetCascade(params: {
  current: boolean;
  input: boolean | undefined;
  parentChanged: boolean;
  /** `isFixedAsset` del padre nuevo; `null` si la cuenta queda sin padre. */
  newParentIsFixedAsset: boolean | null;
}): FixedAssetCascade | null {
  const { current, input, parentChanged, newParentIsFixedAsset } = params;

  // El tilde explícito del usuario manda sobre la herencia del rubro.
  if (input !== undefined && input !== current) {
    return { value: input, reason: 'FLAG_CHANGED' };
  }

  // Mover la cuenta a un rubro con OTRO valor la realinea a ella y a su subárbol.
  if (parentChanged && newParentIsFixedAsset !== null && newParentIsFixedAsset !== current) {
    return { value: newParentIsFixedAsset, reason: 'PARENT_CHANGED' };
  }

  return null;
}
