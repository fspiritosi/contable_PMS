import { describe, expect, it } from 'vitest';

import { adjustItem, adjustItems, applyPercentage } from './price-index-calc';

describe('aplicar un porcentaje a un importe', () => {
  it('aumenta segun el indice', () => {
    expect(applyPercentage(120000, 4.2)).toBe(125040);
  });

  it('redondea a dos decimales', () => {
    // 99999 * 1.042 = 104198.958
    expect(applyPercentage(99999, 4.2)).toBe(104198.96);
  });

  it('un porcentaje negativo baja el precio', () => {
    expect(applyPercentage(1000, -10)).toBe(900);
  });

  it('un porcentaje en cero no cambia nada', () => {
    expect(applyPercentage(1234.56, 0)).toBe(1234.56);
  });

  it('redondea hacia arriba el caso que cae justo en la mitad', () => {
    // 100 * 1.005 = 100.5 -> el medio centavo sube
    expect(applyPercentage(100, 0.5)).toBe(100.5);
    // 1.005 redondeado a 2 decimales
    expect(applyPercentage(1, 0.5)).toBe(1.01);
  });
});

describe('ajuste de un item de la lista', () => {
  it('recalcula el precio con IVA desde el precio nuevo', () => {
    const resultado = adjustItem({ id: 'a', price: 1000, vatRate: 21 }, 10);

    expect(resultado).toEqual({ id: 'a', price: 1100, priceWithTax: 1331 });
  });

  it('el precio con IVA sale del precio ajustado, no de ajustar el precio con IVA', () => {
    // Si se ajustara priceWithTax por separado, 1210 * 1.1 = 1331 daria igual aca,
    // pero con decimales los dos caminos divergen por redondeo. Este es el caso:
    // price 33.33 -> 36.66 -> conIVA 44.36
    // (ajustar el conIVA original 40.33 * 1.1 daria 44.36 tambien, pero
    //  33.33*1.1=36.663 redondea a 36.66 y 36.66*1.21=44.3586 -> 44.36)
    const resultado = adjustItem({ id: 'b', price: 33.33, vatRate: 21 }, 10);

    expect(resultado.price).toBe(36.66);
    expect(resultado.priceWithTax).toBe(44.36);
  });

  it('un item sin IVA queda con el mismo precio en ambos campos', () => {
    const resultado = adjustItem({ id: 'c', price: 500, vatRate: 0 }, 20);

    expect(resultado).toEqual({ id: 'c', price: 600, priceWithTax: 600 });
  });
});

describe('ajuste de varios items', () => {
  it('ajusta cada item por separado y conserva el orden', () => {
    const items = [
      { id: 'a', price: 100, vatRate: 21 },
      { id: 'b', price: 200, vatRate: 10.5 },
    ];

    expect(adjustItems(items, 5)).toEqual([
      { id: 'a', price: 105, priceWithTax: 127.05 },
      { id: 'b', price: 210, priceWithTax: 232.05 },
    ]);
  });

  it('una lista vacia no rompe', () => {
    expect(adjustItems([], 5)).toEqual([]);
  });
});
