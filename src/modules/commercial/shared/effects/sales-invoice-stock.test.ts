import { describe, expect, it } from 'vitest';

import { Prisma } from '@/generated/prisma/client';

import { stockQuantitiesToMove } from './sales-invoice-stock';

const d = (value: number) => new Prisma.Decimal(value);
const line = (productId: string, quantity: number, trackStock = true) => ({
  productId,
  quantity: d(quantity),
  trackStock,
});
const moved = (result: ReturnType<typeof stockQuantitiesToMove>) =>
  result.map(({ line: l, quantity }) => [l.productId, quantity.toNumber()]);

describe('stockQuantitiesToMove (TSK-798)', () => {
  it('sin remitos mueve todas las líneas con ítem de stock', () => {
    const lines = [line('A', 2), line('S', 1, false), line('A', 3)];
    expect(moved(stockQuantitiesToMove(lines, new Map()))).toEqual([
      ['A', 2],
      ['A', 3],
    ]);
  });

  it('lo entregado por los remitos cubre la línea y no se mueve de nuevo', () => {
    expect(moved(stockQuantitiesToMove([line('A', 4)], new Map([['A', d(4)]])))).toEqual([]);
  });

  it('lo entregado cubre las líneas del producto en orden y solo se mueve el excedente', () => {
    const lines = [line('A', 3), line('A', 2), line('B', 5)];
    expect(moved(stockQuantitiesToMove(lines, new Map([['A', d(4)], ['B', d(1.5)]])))).toEqual([
      ['A', 1],
      ['B', 3.5],
    ]);
  });

  it('una factura por menos de lo entregado no devuelve stock', () => {
    expect(moved(stockQuantitiesToMove([line('A', 2)], new Map([['A', d(5)]])))).toEqual([]);
  });
});
