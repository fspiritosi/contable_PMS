import { describe, expect, it } from 'vitest';

import { formatMoneyDisplay, insertDecimalComma, parseMoneyDisplay } from './money-input';

describe('formatMoneyDisplay / parseMoneyDisplay', () => {
  it('muestra miles con punto y decimales con coma', () => {
    expect(formatMoneyDisplay('4000000.5')).toBe('4.000.000,5');
    expect(formatMoneyDisplay('-1234')).toBe('-1.234');
  });

  it('descarta los puntos tipeados (son separadores de miles)', () => {
    expect(parseMoneyDisplay('24.000', 2)).toBe('24000');
    expect(parseMoneyDisplay('24.000,555', 2)).toBe('24000.55');
  });
});

describe('insertDecimalComma (punto del teclado numérico, TSK-851)', () => {
  it('al final del número deja la coma decimal', () => {
    const next = insertDecimalComma('24', 2, 2, 2);
    expect(next).toBe('24,');
    expect(parseMoneyDisplay(`${next}5`, 2)).toBe('24.5');
  });

  it('respeta los miles ya formateados', () => {
    expect(parseMoneyDisplay(insertDecimalComma('24.000', 6, 6, 2) ?? '', 2)).toBe('24000.');
  });

  it('en el medio parte el número en entero y decimales', () => {
    expect(parseMoneyDisplay(insertDecimalComma('2.450', 4, 4, 2) ?? '', 2)).toBe('245.0');
  });

  it('reemplaza la selección', () => {
    expect(insertDecimalComma('1.234', 0, 5, 2)).toBe('0,');
  });

  it('al principio antepone el cero, también en negativos', () => {
    expect(insertDecimalComma('', 0, 0, 2)).toBe('0,');
    expect(insertDecimalComma('-', 1, 1, 2)).toBe('-0,');
  });

  it('no inserta una segunda coma ni en importes sin decimales', () => {
    expect(insertDecimalComma('24,5', 4, 4, 2)).toBeNull();
    expect(insertDecimalComma('24', 2, 2, 0)).toBeNull();
  });

  it('reemplazar una selección que contiene la coma sí la admite', () => {
    expect(insertDecimalComma('24,5', 2, 4, 2)).toBe('24,');
  });
});
