import type { ProductCategory } from './types';

/**
 * Nodo de categoría con sus hijos ya anidados.
 * Mantiene todos los campos de ProductCategory (parent, _count, etc.).
 */
export interface CategoryTreeNode extends ProductCategory {
  children: CategoryTreeNode[];
}

/**
 * Convierte una lista plana de categorías en una estructura jerárquica.
 * Mismo patrón que buildAccountTree (módulo accounting), replicado acá para
 * respetar la separación de módulos.
 *
 * Las categorías cuyo padre no está en la lista se tratan como raíz (safety).
 */
export function buildCategoryTree(categories: ProductCategory[]): CategoryTreeNode[] {
  const nodeMap = new Map<string, CategoryTreeNode>();

  categories.forEach((category) => {
    nodeMap.set(category.id, { ...category, children: [] });
  });

  const roots: CategoryTreeNode[] = [];
  categories.forEach((category) => {
    const node = nodeMap.get(category.id)!;
    const parent = category.parentId ? nodeMap.get(category.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

/**
 * Aplana un árbol conservando el nivel de profundidad de cada nodo.
 * Útil para renderizar selects con indentación visual de la jerarquía.
 */
export function flattenCategoryTree(
  nodes: CategoryTreeNode[],
  level = 0
): Array<{ category: CategoryTreeNode; level: number }> {
  return nodes.flatMap((node) => [
    { category: node, level },
    ...flattenCategoryTree(node.children, level + 1),
  ]);
}

/**
 * Devuelve los IDs de todos los descendientes de una categoría (hijos, nietos, etc.)
 * a partir de la lista plana. Se usa para evitar ciclos en el selector de padre.
 */
export function getDescendantIds(
  categoryId: string,
  categories: ProductCategory[]
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  categories.forEach((category) => {
    if (!category.parentId) return;
    const siblings = childrenByParent.get(category.parentId) ?? [];
    siblings.push(category.id);
    childrenByParent.set(category.parentId, siblings);
  });

  const descendants = new Set<string>();
  const stack = [...(childrenByParent.get(categoryId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (descendants.has(current)) continue;
    descendants.add(current);
    stack.push(...(childrenByParent.get(current) ?? []));
  }

  return descendants;
}
