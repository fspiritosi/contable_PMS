/**
 * Búsqueda en el plan de cuentas (TSK-850).
 *
 * La tabla del plan es un árbol que solo renderiza las filas expandidas, así
 * que el Ctrl+F del navegador no encuentra una cuenta que está dentro de una
 * sumatoria cerrada. Este filtro poda el árbol a las cuentas que coinciden y a
 * sus ancestros, y devuelve qué nodos hay que abrir para que se vean.
 *
 * Puro y genérico para testearlo sin React ni base.
 */

export interface FilterableAccountNode<T> {
  id: string;
  code: string;
  name: string;
  children: T[];
}

export interface AccountTreeFilterResult<T> {
  /** Árbol podado: cuentas que coinciden (con todas sus hijas) y sus ancestros. */
  tree: T[];
  /** Nodos a expandir para que se vea cada coincidencia. */
  expandedIds: Set<string>;
  /** Cantidad de cuentas que coinciden por sí mismas. */
  matchCount: number;
}

/** Minúsculas y sin acentos: «Imp. Déb.» y «imp. deb.» son lo mismo. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Cada palabra de la búsqueda tiene que aparecer en el código o en el nombre,
 * en cualquier orden: «tarj credito» encuentra «Tarjetas de crédito a pagar».
 */
export function accountMatches(account: { code: string; name: string }, query: string): boolean {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeSearchText(`${account.code} ${account.name}`);
  return terms.every((term) => haystack.includes(term));
}

export function filterAccountTree<T extends FilterableAccountNode<T>>(
  accounts: T[],
  query: string
): AccountTreeFilterResult<T> {
  const expandedIds = new Set<string>();
  if (normalizeSearchText(query) === '') {
    return { tree: accounts, expandedIds, matchCount: 0 };
  }

  let matchCount = 0;

  const visit = (node: T): T | null => {
    const selfMatches = accountMatches(node, query);
    const matchingChildren = node.children
      .map(visit)
      .filter((child): child is T => child !== null);

    if (selfMatches) matchCount++;
    if (matchingChildren.length > 0) expandedIds.add(node.id);

    if (selfMatches) {
      // La cuenta que coincide conserva todas sus hijas (cerradas, salvo las que
      // haya que abrir para mostrar otra coincidencia).
      const kept = new Map(matchingChildren.map((child) => [child.id, child]));
      return { ...node, children: node.children.map((child) => kept.get(child.id) ?? child) };
    }
    if (matchingChildren.length > 0) return { ...node, children: matchingChildren };
    return null;
  };

  const tree = accounts.map(visit).filter((node): node is T => node !== null);
  return { tree, expandedIds, matchCount };
}
