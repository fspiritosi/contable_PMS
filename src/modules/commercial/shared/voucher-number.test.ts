import { describe, expect, it } from 'vitest';

import {
  POINT_OF_SALE_LENGTH,
  VOUCHER_NUMBER_LENGTH,
  padPointOfSale,
  padVoucherNumber,
} from './voucher-number';

describe('normalización del punto de venta', () => {
  it('completa con ceros a la izquierda hasta 4 dígitos', () => {
    expect(padPointOfSale('1')).toBe('0001');
    expect(padPointOfSale('23')).toBe('0023');
    expect(padPointOfSale('456')).toBe('0456');
  });

  it('deja intacto lo que ya tiene el largo correcto', () => {
    expect(padPointOfSale('0001')).toBe('0001');
    expect(padPointOfSale('1234')).toBe('1234');
  });

  it('ignora los espacios sobrantes', () => {
    expect(padPointOfSale('  12  ')).toBe('0012');
  });
});

describe('normalización del número de comprobante', () => {
  it('completa con ceros a la izquierda hasta 8 dígitos', () => {
    expect(padVoucherNumber('123')).toBe('00000123');
    expect(padVoucherNumber('7')).toBe('00000007');
  });

  it('deja intacto lo que ya tiene el largo correcto', () => {
    expect(padVoucherNumber('00000123')).toBe('00000123');
  });
});

describe('casos que no debe tocar', () => {
  it('devuelve la cadena vacía sin rellenar, para que el campo siga siendo obligatorio', () => {
    expect(padPointOfSale('')).toBe('');
    expect(padPointOfSale('   ')).toBe('');
    expect(padVoucherNumber('')).toBe('');
  });

  it('no rellena lo que no son solo dígitos, para que la validación lo rechace', () => {
    expect(padPointOfSale('12a')).toBe('12a');
    expect(padVoucherNumber('12-34')).toBe('12-34');
  });

  it('no recorta lo que excede el largo: eso es un error que hay que mostrar', () => {
    expect(padPointOfSale('12345')).toBe('12345');
    expect(padVoucherNumber('123456789')).toBe('123456789');
  });
});

/**
 * Regresión de TSK-581. La usuaria pedía: "si pongo los últimos dígitos, en
 * general los sistemas rellenan con ceros antes y no tengo que estar contando".
 *
 * La importación desde ARCA/AFIP ya rellenaba, pero la carga manual de una
 * factura de compra exigía tipear los ceros: el esquema pide exactamente 4 y 8
 * dígitos, así que "123" era rechazado en vez de entenderse como "00000123".
 */
describe('carga manual de una factura de compra (TSK-581)', () => {
  it('acepta que se tipeen solo los últimos dígitos', () => {
    expect(padPointOfSale('1')).toHaveLength(POINT_OF_SALE_LENGTH);
    expect(padVoucherNumber('123')).toHaveLength(VOUCHER_NUMBER_LENGTH);
  });
});
