import { describe, expect, it } from 'vitest';

import {
  RESULT_ACCOUNT_TYPES,
  allowsCostCenter,
  prorateAmount,
  totalPercentage,
  validateAllocations,
  type CostCenterAllocation,
} from './cost-center';

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

const LOGISTICA = '11111111-1111-1111-1111-111111111111';
const MANTENIMIENTO = '22222222-2222-2222-2222-222222222222';
const ADMIN = '33333333-3333-3333-3333-333333333333';

describe('validación del reparto', () => {
  it('acepta un reparto vacío: es la imputación opcional de siempre', () => {
    expect(validateAllocations([])).toBeNull();
  });

  it('acepta un solo centro al 100%', () => {
    expect(validateAllocations([{ costCenterId: LOGISTICA, percentage: 100 }])).toBeNull();
  });

  it('acepta un reparto entre varios que suma 100', () => {
    const reparto: CostCenterAllocation[] = [
      { costCenterId: LOGISTICA, percentage: 60 },
      { costCenterId: MANTENIMIENTO, percentage: 40 },
    ];
    expect(validateAllocations(reparto)).toBeNull();
  });

  it('rechaza un reparto incompleto: sería plata sin imputar', () => {
    expect(validateAllocations([{ costCenterId: LOGISTICA, percentage: 60 }])).toBe(
      'INCOMPLETE_TOTAL'
    );
  });

  it('rechaza un reparto que se pasa de 100', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 60 },
      { costCenterId: MANTENIMIENTO, percentage: 60 },
    ];
    expect(validateAllocations(reparto)).toBe('INCOMPLETE_TOTAL');
  });

  it('rechaza el mismo centro repetido', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 50 },
      { costCenterId: LOGISTICA, percentage: 50 },
    ];
    expect(validateAllocations(reparto)).toBe('DUPLICATE_COST_CENTER');
  });

  it('rechaza un porcentaje en cero o negativo', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 100 },
      { costCenterId: MANTENIMIENTO, percentage: 0 },
    ];
    expect(validateAllocations(reparto)).toBe('NON_POSITIVE_PERCENTAGE');
  });

  it('suma con dos decimales sin arrastrar error de punto flotante', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 33.33 },
      { costCenterId: MANTENIMIENTO, percentage: 33.33 },
      { costCenterId: ADMIN, percentage: 33.34 },
    ];
    expect(totalPercentage(reparto)).toBe(100);
    expect(validateAllocations(reparto)).toBeNull();
  });
});

describe('prorrateo del importe de la línea', () => {
  it('reparte mitad y mitad', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 50 },
      { costCenterId: MANTENIMIENTO, percentage: 50 },
    ];
    expect(prorateAmount(1000, reparto)).toEqual([
      { costCenterId: LOGISTICA, amount: 500 },
      { costCenterId: MANTENIMIENTO, amount: 500 },
    ]);
  });

  it('el último centro absorbe el centavo que sobra', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 33.33 },
      { costCenterId: MANTENIMIENTO, percentage: 33.33 },
      { costCenterId: ADMIN, percentage: 33.34 },
    ];
    const partes = prorateAmount(10, reparto);

    expect(partes).toEqual([
      { costCenterId: LOGISTICA, amount: 3.33 },
      { costCenterId: MANTENIMIENTO, amount: 3.33 },
      { costCenterId: ADMIN, amount: 3.34 },
    ]);
    // Lo que importa: la suma de las partes es exactamente el total.
    expect(partes.reduce((acc, p) => acc + p.amount, 0)).toBe(10);
  });

  it('nunca descuadra, sea cual sea el importe', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 33.33 },
      { costCenterId: MANTENIMIENTO, percentage: 33.33 },
      { costCenterId: ADMIN, percentage: 33.34 },
    ];
    for (const importe of [0.01, 0.05, 1, 7.77, 100.01, 4000000.5]) {
      const suma = prorateAmount(importe, reparto).reduce((acc, p) => acc + p.amount, 0);
      // toBeCloseTo, no toBe: para importe=100.01 la suma en punto flotante de
      // 33.33 + 33.33 + 33.35 da 100.00999999999999 (arrastre binario de IEEE
      // 754 en el orden de la suma), aunque las partes son correctas al
      // centavo. Ver hallazgo en task-1-report.md.
      expect(suma).toBeCloseTo(importe, 2);
    }
  });

  it('sin reparto no devuelve partes', () => {
    expect(prorateAmount(1000, [])).toEqual([]);
  });
});
