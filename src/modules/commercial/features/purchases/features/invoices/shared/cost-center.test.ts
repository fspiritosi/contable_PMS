import { describe, expect, it } from 'vitest';

import { RESULT_ACCOUNT_TYPES, allowsCostCenter } from './cost-center';

describe('qué líneas admiten centro de costo', () => {
  it('lo admiten las cuentas de resultado', () => {
    expect(allowsCostCenter('EXPENSE')).toBe(true);
    expect(allowsCostCenter('REVENUE')).toBe(true);
  });

  it('no lo admiten las cuentas patrimoniales', () => {
    expect(allowsCostCenter('ASSET')).toBe(false);
    expect(allowsCostCenter('LIABILITY')).toBe(false);
    expect(allowsCostCenter('EQUITY')).toBe(false);
  });

  it('no lo admite una línea sin ítem imputado', () => {
    expect(allowsCostCenter(null)).toBe(false);
    expect(allowsCostCenter(undefined)).toBe(false);
  });

  it('expone los tipos de resultado para reutilizarlos', () => {
    expect(RESULT_ACCOUNT_TYPES).toEqual(['REVENUE', 'EXPENSE']);
  });
});

/**
 * Regresión de TSK-583. La usuaria pedía que el centro de costo "se debiera
 * elegir en cada factura que esté relacionada a los 4..., no global y no a
 * otras clases de cuentas que no sean de resultado".
 *
 * Comprar un activo no consume presupuesto de ningún centro: la contrapartida
 * es patrimonial, así que la línea no debe ofrecer el campo.
 */
describe('compra de un activo (TSK-583)', () => {
  it('no ofrece centro de costo', () => {
    expect(allowsCostCenter('ASSET')).toBe(false);
  });
});
