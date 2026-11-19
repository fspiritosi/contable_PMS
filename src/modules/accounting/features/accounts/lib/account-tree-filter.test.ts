import { describe, expect, it } from 'vitest';

import { accountMatches, filterAccountTree } from './account-tree-filter';

interface Node {
  id: string;
  code: string;
  name: string;
  children: Node[];
}

const node = (id: string, code: string, name: string, children: Node[] = []): Node => ({
  id,
  code,
  name,
  children,
});

const tree: Node[] = [
  node('a', '1.0.0/00/00', 'ACTIVO', [
    node('ac', '1.1.0/00/00', 'ACTIVO CORRIENTE', [
      node('cb', '1.1.1/00/00', 'CAJA Y BANCOS', [
        node('caja', '1.1.1/01/01', 'Caja'),
        node('galicia', '1.1.1/02/01', 'Banco Galicia'),
      ]),
    ]),
  ]),
  node('p', '2.0.0/00/00', 'PASIVO', [
    node('tc', '2.1.3/00/00', 'Tarjetas de crédito a pagar'),
    node('deb', '2.1.4/00/00', 'Imp. Déb./Créd. bancarios a pagar'),
  ]),
];

const ids = (nodes: Node[]): string[] => nodes.flatMap((n) => [n.id, ...ids(n.children)]);

describe('accountMatches', () => {
  it('ignora mayúsculas y acentos', () => {
    expect(accountMatches({ code: '2.1.3', name: 'Tarjetas de crédito' }, 'CREDITO')).toBe(true);
  });

  it('exige todas las palabras, en cualquier orden', () => {
    const account = { code: '2.1.3', name: 'Tarjetas de crédito a pagar' };
    expect(accountMatches(account, 'credito tarj')).toBe(true);
    expect(accountMatches(account, 'credito banco')).toBe(false);
  });

  it('busca también por código', () => {
    expect(accountMatches({ code: '1.1.1/02/01', name: 'Banco Galicia' }, '1.1.1/02')).toBe(true);
  });
});

describe('filterAccountTree', () => {
  it('sin búsqueda devuelve el árbol tal cual', () => {
    const result = filterAccountTree(tree, '   ');
    expect(result.tree).toBe(tree);
    expect(result.expandedIds.size).toBe(0);
  });

  it('una cuenta profunda trae a sus ancestros y los deja abiertos', () => {
    const result = filterAccountTree(tree, 'galicia');
    expect(ids(result.tree)).toEqual(['a', 'ac', 'cb', 'galicia']);
    expect([...result.expandedIds].sort()).toEqual(['a', 'ac', 'cb']);
    expect(result.matchCount).toBe(1);
  });

  it('una sumatoria que coincide conserva todas sus hijas, cerrada', () => {
    const result = filterAccountTree(tree, 'caja y bancos');
    expect(ids(result.tree)).toEqual(['a', 'ac', 'cb', 'caja', 'galicia']);
    expect(result.expandedIds.has('cb')).toBe(false);
  });

  it('si coinciden la sumatoria y una hija, la abre para mostrar la hija', () => {
    // «pasivo» no está en las hijas; «pagar» sí: coinciden las dos hijas, no la madre.
    const result = filterAccountTree(tree, 'a pagar');
    expect(ids(result.tree)).toEqual(['p', 'tc', 'deb']);
    expect(result.expandedIds.has('p')).toBe(true);
    expect(result.matchCount).toBe(2);
  });

  it('busca sin acentos: «deb» encuentra «Déb.»', () => {
    expect(ids(filterAccountTree(tree, 'imp deb').tree)).toEqual(['p', 'deb']);
  });

  it('sin coincidencias devuelve un árbol vacío', () => {
    const result = filterAccountTree(tree, 'inexistente');
    expect(result.tree).toEqual([]);
    expect(result.matchCount).toBe(0);
  });

  it('no modifica el árbol original', () => {
    filterAccountTree(tree, 'galicia');
    expect(ids(tree)).toHaveLength(8);
    expect(tree[0].children[0].children[0].children).toHaveLength(2);
  });
});
