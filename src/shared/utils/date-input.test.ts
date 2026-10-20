import { describe, expect, it } from 'vitest';

import { businessToday, fromDateInputValue, toDateInputValue } from './date-input';

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

describe('businessToday (fecha por defecto: "hoy" en Argentina)', () => {
  it('a las 22:40 de Argentina (01:40Z del día siguiente) sigue siendo el día de Argentina', () => {
    const now = new Date('2026-10-07T01:40:00.000Z');
    expect(businessToday('local', now)).toEqual(new Date(2026, 9, 6, 12, 0, 0, 0));
    expect(businessToday('utc', now)).toEqual(new Date('2026-10-06T00:00:00.000Z'));
  });

  it('a las 00:00 de Argentina (03:00Z) ya es el día siguiente', () => {
    const now = new Date('2026-10-07T03:00:00.000Z');
    expect(toDateInputValue(businessToday('local', now))).toBe('2026-10-07');
    expect(toDateInputValue(businessToday('utc', now), 'utc')).toBe('2026-10-07');
  });

  it('el último día del mes a la noche no pasa al mes siguiente', () => {
    const now = new Date('2026-11-01T02:30:00.000Z'); // 31/10 23:30 en Argentina
    expect(toDateInputValue(businessToday('local', now))).toBe('2026-10-31');
    expect(toDateInputValue(businessToday('utc', now), 'utc')).toBe('2026-10-31');
  });
});
