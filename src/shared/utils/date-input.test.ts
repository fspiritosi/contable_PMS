import { describe, expect, it } from 'vitest';

import { fromDateInputValue, toDateInputValue } from './date-input';

describe('fromDateInputValue', () => {
  it('devuelve null mientras la fecha está vacía o a medio tipear (el navegador reporta "")', () => {
    expect(fromDateInputValue('')).toBeNull();
    expect(fromDateInputValue('', 'utc')).toBeNull();
  });

  it('devuelve null si el texto no es un día real', () => {
    expect(fromDateInputValue('2026-02-30')).toBeNull();
    expect(fromDateInputValue('2026-6-15')).toBeNull();
    expect(fromDateInputValue('15/06/2026')).toBeNull();
  });

  it('en modo local fecha ese día a las 12:00 locales (convención comercial)', () => {
    const date = fromDateInputValue('2026-06-15');
    expect(date).toEqual(new Date(2026, 5, 15, 12, 0, 0, 0));
  });

  it('en modo utc fecha ese día a las 00:00:00.000Z (convención D8 del núcleo contable)', () => {
    expect(fromDateInputValue('2026-06-15', 'utc')).toEqual(new Date('2026-06-15T00:00:00.000Z'));
  });

  it('acepta el año a medio tipear, que el navegador ya reporta como fecha completa', () => {
    expect(fromDateInputValue('0002-06-15')?.getFullYear()).toBe(2);
  });
});

describe('toDateInputValue', () => {
  it('devuelve "" sin fecha o con una fecha inválida', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue(undefined)).toBe('');
    expect(toDateInputValue(new Date('T12:00:00'))).toBe('');
    expect(toDateInputValue(new Date(Number.NaN), 'utc')).toBe('');
  });

  it('en modo utc toma el día UTC, aunque en la zona local ya sea el día anterior', () => {
    expect(toDateInputValue(new Date('2026-06-15T00:00:00.000Z'), 'utc')).toBe('2026-06-15');
  });

  it('ida y vuelta sin correr el día en ambos modos', () => {
    expect(toDateInputValue(fromDateInputValue('2026-01-01'))).toBe('2026-01-01');
    expect(toDateInputValue(fromDateInputValue('2026-12-31', 'utc'), 'utc')).toBe('2026-12-31');
    expect(toDateInputValue(fromDateInputValue('0002-06-15'))).toBe('0002-06-15');
  });
});
