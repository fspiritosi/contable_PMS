import { describe, it, expect } from 'vitest';
import { validateAccountCodeFormat, AccountCodeFormatError } from './account-code';

describe('validateAccountCodeFormat', () => {
  it('normaliza un código jerárquico completo rellenando los auxiliares', () => {
    expect(validateAccountCodeFormat('1.1.1')).toBe('1.1.1/00/00');
  });

  it('rellena con 0 los segmentos de jerarquía faltantes', () => {
    expect(validateAccountCodeFormat('1')).toBe('1.0.0/00/00');
    expect(validateAccountCodeFormat('1.2')).toBe('1.2.0/00/00');
  });

  it('normaliza los grupos auxiliares a 2 dígitos', () => {
    expect(validateAccountCodeFormat('1.1.1/5')).toBe('1.1.1/05/00');
    expect(validateAccountCodeFormat('1.1.1/5/3')).toBe('1.1.1/05/03');
    expect(validateAccountCodeFormat('2.10.3/12/34')).toBe('2.10.3/12/34');
  });

  it('recorta espacios alrededor del código', () => {
    expect(validateAccountCodeFormat('  1.1.1  ')).toBe('1.1.1/00/00');
  });

  it('rechaza el primer segmento en 0', () => {
    expect(() => validateAccountCodeFormat('0.1.1')).toThrow(AccountCodeFormatError);
    expect(() => validateAccountCodeFormat('0')).toThrow(AccountCodeFormatError);
  });

  it('rechaza códigos vacíos', () => {
    expect(() => validateAccountCodeFormat('')).toThrow(AccountCodeFormatError);
    expect(() => validateAccountCodeFormat('   ')).toThrow(AccountCodeFormatError);
  });

  it('rechaza segmentos no numéricos', () => {
    expect(() => validateAccountCodeFormat('1.a.1')).toThrow(AccountCodeFormatError);
    expect(() => validateAccountCodeFormat('1.1.1/xx')).toThrow(AccountCodeFormatError);
  });

  it('rechaza demasiados niveles de jerarquía', () => {
    expect(() => validateAccountCodeFormat('1.1.1.1')).toThrow(AccountCodeFormatError);
  });

  it('rechaza demasiados grupos', () => {
    expect(() => validateAccountCodeFormat('1.1.1/2/3/4')).toThrow(AccountCodeFormatError);
  });
});
