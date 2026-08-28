import { describe, expect, it } from 'vitest';

import {
  RESULT_ACCOUNT_TYPES,
  allowsCostCenter,
  buildMissingCostCenterMessage,
  expandByCostCenter,
  findLinesMissingCostCenter,
  prorateAmount,
  replicateAllocations,
  totalPercentage,
  validateAllocations,
  type CostCenterAllocation,
  type CostCenterLineCheck,
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


/**
 * Regresión de revisión de TSK-583 (Tarea 5). "Aplicar a todas las líneas"
 * copiaba el array de `form.getValues(...)` por referencia a otras líneas:
 * los objetos `{costCenterId, percentage}` de adentro quedaban compartidos,
 * así que editar el porcentaje de una sola línea (vía `register(...
 * percentage)`) mutaba en silencio el reparto de todas las líneas que habían
 * recibido la "copia". `replicateAllocations` existe para que ese clonado se
 * pueda probar sin montar el formulario entero.
 */
describe('replicateAllocations: independencia entre líneas al "Aplicar a todas"', () => {
  it('devuelve un array distinto por referencia del original', () => {
    const original: CostCenterAllocation[] = [{ costCenterId: LOGISTICA, percentage: 100 }];
    expect(replicateAllocations(original)).not.toBe(original);
  });

  it('devuelve objetos internos independientes: mutar la copia no afecta al original', () => {
    const original: CostCenterAllocation[] = [
      { costCenterId: LOGISTICA, percentage: 60 },
      { costCenterId: MANTENIMIENTO, percentage: 40 },
    ];
    const copia = replicateAllocations(original);

    // Simula lo que hace el usuario al editar el porcentaje de una línea
    // que recibió la "copia" del reparto de otra.
    copia[0].percentage = 999;

    expect(original[0].percentage).toBe(60);
    expect(copia[0].percentage).toBe(999);
  });

  it('preserva los valores del reparto original', () => {
    const original: CostCenterAllocation[] = [
      { costCenterId: LOGISTICA, percentage: 60 },
      { costCenterId: MANTENIMIENTO, percentage: 40 },
    ];
    expect(replicateAllocations(original)).toEqual(original);
  });

  it('un reparto vacío da una copia vacía', () => {
    expect(replicateAllocations([])).toEqual([]);
  });
});

const LINEAS: CostCenterLineCheck[] = [
  { description: 'Combustible', accountType: 'EXPENSE', allocations: [] },
  {
    description: 'Peajes',
    accountType: 'EXPENSE',
    allocations: [{ costCenterId: LOGISTICA, percentage: 100 }],
  },
  { description: 'Camioneta', accountType: 'ASSET', allocations: [] },
  { description: 'Gasto suelto', accountType: null, allocations: [] },
];

describe('líneas que quedan sin imputar con la obligatoriedad activa', () => {
  it('marca la línea de resultado sin reparto', () => {
    expect(findLinesMissingCostCenter(LINEAS).map((l) => l.description)).toEqual([
      'Combustible',
    ]);
  });

  it('no marca la que ya tiene reparto completo', () => {
    const conReparto = LINEAS.filter((l) => l.description === 'Peajes');
    expect(findLinesMissingCostCenter(conReparto)).toEqual([]);
  });

  it('no exige nada a una compra de activo', () => {
    const activo = LINEAS.filter((l) => l.description === 'Camioneta');
    expect(findLinesMissingCostCenter(activo)).toEqual([]);
  });

  it('no exige nada a una línea sin cuenta conocida', () => {
    const suelta = LINEAS.filter((l) => l.description === 'Gasto suelto');
    expect(findLinesMissingCostCenter(suelta)).toEqual([]);
  });

  it('arma un mensaje que nombra las líneas incompletas', () => {
    const mensaje = buildMissingCostCenterMessage(findLinesMissingCostCenter(LINEAS));
    expect(mensaje).toBe('Falta el centro de costo en 1 línea: Combustible');
  });

  it('usa el plural con varias líneas', () => {
    const mensaje = buildMissingCostCenterMessage([
      { description: 'Combustible', accountType: 'EXPENSE', allocations: [] },
      { description: 'Peajes', accountType: 'EXPENSE', allocations: [] },
    ]);
    expect(mensaje).toBe('Falta el centro de costo en 2 líneas: Combustible, Peajes');
  });
});

const CUENTA_COMBUSTIBLE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CUENTA_SERVICIOS = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('expansión de líneas para el asiento', () => {
  it('parte una línea repartida en una imputación por centro', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_COMBUSTIBLE,
        subtotal: 1000,
        allocations: [
          { costCenterId: LOGISTICA, percentage: 60 },
          { costCenterId: MANTENIMIENTO, percentage: 40 },
        ],
      },
    ]);

    expect(resultado).toEqual([
      { accountId: CUENTA_COMBUSTIBLE, costCenterId: LOGISTICA, total: 600 },
      { accountId: CUENTA_COMBUSTIBLE, costCenterId: MANTENIMIENTO, total: 400 },
    ]);
  });

  it('sin reparto cae en el centro predeterminado del ítem', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_COMBUSTIBLE,
        subtotal: 1000,
        allocations: [],
        defaultCostCenterId: LOGISTICA,
      },
    ]);

    expect(resultado).toEqual([
      { accountId: CUENTA_COMBUSTIBLE, costCenterId: LOGISTICA, total: 1000 },
    ]);
  });

  it('sin reparto ni predeterminado, la imputación queda sin centro', () => {
    const resultado = expandByCostCenter([
      { accountId: CUENTA_COMBUSTIBLE, subtotal: 1000, allocations: [] },
    ]);

    expect(resultado).toEqual([
      { accountId: CUENTA_COMBUSTIBLE, costCenterId: undefined, total: 1000 },
    ]);
  });

  it('acumula lo que cae en la misma cuenta y el mismo centro', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_COMBUSTIBLE,
        subtotal: 1000,
        allocations: [{ costCenterId: LOGISTICA, percentage: 100 }],
      },
      {
        accountId: CUENTA_COMBUSTIBLE,
        subtotal: 500,
        allocations: [{ costCenterId: LOGISTICA, percentage: 100 }],
      },
    ]);

    expect(resultado).toEqual([
      { accountId: CUENTA_COMBUSTIBLE, costCenterId: LOGISTICA, total: 1500 },
    ]);
  });

  it('no mezcla centros distintos de la misma cuenta', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_SERVICIOS,
        subtotal: 1000,
        allocations: [{ costCenterId: LOGISTICA, percentage: 100 }],
      },
      {
        accountId: CUENTA_SERVICIOS,
        subtotal: 500,
        allocations: [{ costCenterId: MANTENIMIENTO, percentage: 100 }],
      },
    ]);

    expect(resultado).toHaveLength(2);
  });

  it('ignora las líneas sin importe', () => {
    expect(expandByCostCenter([{ accountId: CUENTA_SERVICIOS, subtotal: 0, allocations: [] }])).toEqual(
      []
    );
  });

  it('lo repartido suma exactamente el neto de la línea', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_SERVICIOS,
        subtotal: 10,
        allocations: [
          { costCenterId: LOGISTICA, percentage: 33.33 },
          { costCenterId: MANTENIMIENTO, percentage: 33.33 },
          { costCenterId: ADMIN, percentage: 33.34 },
        ],
      },
    ]);

    expect(resultado.reduce((acc, r) => acc + r.total, 0)).toBe(10);
  });
});

/**
 * Regresión: el asiento de ventas agrupaba solo por cuenta y conservaba el
 * primer centro de costo que encontraba, así que una venta con ítems de centros
 * distintos imputaba todo a uno solo (TSK-583).
 */
describe('venta con ítems de distintos centros (regresión)', () => {
  it('mantiene separada la imputación de cada centro', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_SERVICIOS,
        subtotal: 1000,
        allocations: [],
        defaultCostCenterId: LOGISTICA,
      },
      {
        accountId: CUENTA_SERVICIOS,
        subtotal: 500,
        allocations: [],
        defaultCostCenterId: MANTENIMIENTO,
      },
    ]);

    expect(resultado).toEqual([
      { accountId: CUENTA_SERVICIOS, costCenterId: LOGISTICA, total: 1000 },
      { accountId: CUENTA_SERVICIOS, costCenterId: MANTENIMIENTO, total: 500 },
    ]);
  });
});
