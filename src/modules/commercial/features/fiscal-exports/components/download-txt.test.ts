import { describe, expect, it } from 'vitest';

import { countRecords, encodeArcaTxt } from './download-txt';

describe('encodeArcaTxt (TSK-796)', () => {
  it('un byte por carácter: la ñ y los acentos no corren el ancho fijo', () => {
    const bytes = encodeArcaTxt('PEÑA Á');
    expect(Array.from(bytes)).toEqual([0x50, 0x45, 0xd1, 0x41, 0x20, 0xc1, 0x0d, 0x0a]);
  });

  it('normaliza los acentos descompuestos antes de codificar', () => {
    expect(encodeArcaTxt('Ñ')).toEqual(encodeArcaTxt('Ñ'));
  });

  it('reemplaza por "?" lo que no entra en Latin-1', () => {
    expect(Array.from(encodeArcaTxt('a€b'))).toEqual([0x61, 0x3f, 0x62, 0x0d, 0x0a]);
  });

  it('cada registro termina en CRLF y un archivo vacío queda vacío', () => {
    expect(new TextDecoder('latin1').decode(encodeArcaTxt('A\r\nB'))).toBe('A\r\nB\r\n');
    expect(encodeArcaTxt('')).toHaveLength(0);
  });
});

describe('countRecords', () => {
  it('cuenta una línea por registro', () => {
    expect(countRecords('')).toBe(0);
    expect(countRecords('A')).toBe(1);
    expect(countRecords('A\r\nB')).toBe(2);
  });
});
