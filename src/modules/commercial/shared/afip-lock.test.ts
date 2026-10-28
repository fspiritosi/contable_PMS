import { describe, expect, it } from 'vitest';

import { isAfipLocked } from './afip-lock';

describe('isAfipLocked', () => {
  it('sin CAE y con punto de venta no AFIP → no bloqueada', () => {
    expect(isAfipLocked({ cae: null, pointOfSale: { afipEnabled: false } })).toBe(false);
  });

  it('CAE vacío cuenta como sin CAE', () => {
    expect(isAfipLocked({ cae: '', pointOfSale: { afipEnabled: false } })).toBe(false);
  });

  it('con CAE → bloqueada', () => {
    expect(isAfipLocked({ cae: '71234567890123', pointOfSale: { afipEnabled: false } })).toBe(true);
  });

  it('punto de venta habilitado para AFIP, aunque todavía no tenga CAE → bloqueada', () => {
    expect(isAfipLocked({ cae: null, pointOfSale: { afipEnabled: true } })).toBe(true);
  });
});
