import { describe, expect, it } from 'vitest';
import {
  NO_COST_CENTER_LABEL,
  buildExcelRows,
  buildMovementRows,
  groupByCostCenter,
  splitLineAmount,
  sumGroupTotals,
  summarizeDrafts,
  type CostCenterMovementLine,
} from './cost-center-movements';

/**
 * Escenario calcado del que genera el sistema hoy (TSK-719, análisis 1.2.2):
 * facturas de venta (cuenta REVENUE, naturaleza CREDIT) y de compra
 * (EXPENSE, DEBIT) imputadas a un centro, más la nota de crédito que invierte
 * Debe y Haber y por eso tiene que RESTAR, no sumar.
 */
function makeLine(overrides: Partial<CostCenterMovementLine> = {}): CostCenterMovementLine {
  return {
    lineId: 'l1',
    entryId: 'e1',
    entryNumber: 1,
    date: new Date('2026-09-01T00:00:00.000Z'),
    entryDescription: 'Asiento de prueba',
    lineDescription: null,
    status: 'POSTED',
    accountCode: '4.1.1',
    accountName: 'Ventas',
    accountNature: 'CREDIT',
    debit: 0,
    credit: 0,
    costCenterId: 'cc-log',
    costCenterName: 'Logística',
    ...overrides,
  };
}

const VENTA = makeLine({
  lineId: 'l-venta',
  entryId: 'e-venta',
  entryNumber: 1,
  date: new Date('2026-09-01T00:00:00.000Z'),
  credit: 100000,
  accountNature: 'CREDIT',
});

const GASTO = makeLine({
  lineId: 'l-gasto',
  entryId: 'e-gasto',
  entryNumber: 2,
  date: new Date('2026-09-05T00:00:00.000Z'),
  accountCode: '4.2.1',
  accountName: 'Combustible',
  accountNature: 'DEBIT',
  debit: 60000,
});

const NOTA_CREDITO = makeLine({
  lineId: 'l-nc',
  entryId: 'e-nc',
  entryNumber: 3,
  date: new Date('2026-09-10T00:00:00.000Z'),
  entryDescription: 'Nota de crédito de venta',
  accountNature: 'CREDIT',
  debit: 30000,
});

describe('splitLineAmount', () => {
  it('cuenta de naturaleza CREDIT con Haber: es entrada por el total del haber', () => {
    expect(splitLineAmount(makeLine({ accountNature: 'CREDIT', credit: 1000 }))).toEqual({
      entrada: 1000,
      salida: 0,
    });
  });

  it('cuenta de naturaleza CREDIT con Debe (nota de crédito de venta): entrada NEGATIVA', () => {
    // El bug silencioso del ticket: clasificar solo por tipo de cuenta haría
    // que la devolución sumara a las entradas en vez de restarlas.
    expect(splitLineAmount(makeLine({ accountNature: 'CREDIT', debit: 300 }))).toEqual({
      entrada: -300,
      salida: 0,
    });
  });

  it('cuenta de naturaleza DEBIT con Debe: es salida por el total del debe', () => {
    expect(splitLineAmount(makeLine({ accountNature: 'DEBIT', debit: 500 }))).toEqual({
      entrada: 0,
      salida: 500,
    });
  });

  it('cuenta de naturaleza DEBIT con Haber (nota de crédito de compra): salida NEGATIVA', () => {
    expect(splitLineAmount(makeLine({ accountNature: 'DEBIT', credit: 120 }))).toEqual({
      entrada: 0,
      salida: -120,
    });
  });

  it('una línea nunca produce entrada y salida a la vez', () => {
    // Garantizado por el constraint chk_jel_debit_or_credit (debe XOR haber),
    // pero la regla de signo también lo respeta: una de las dos es siempre 0.
    const casos = [
      makeLine({ accountNature: 'CREDIT', credit: 1000 }),
      makeLine({ accountNature: 'CREDIT', debit: 300 }),
      makeLine({ accountNature: 'DEBIT', debit: 500 }),
      makeLine({ accountNature: 'DEBIT', credit: 120 }),
    ];

    for (const caso of casos) {
      const { entrada, salida } = splitLineAmount(caso);
      expect(entrada === 0 || salida === 0).toBe(true);
    }
  });
});

describe('buildMovementRows', () => {
  it('ordena por fecha y acumula el saldo fila a fila', () => {
    const rows = buildMovementRows([NOTA_CREDITO, GASTO, VENTA]);

    expect(rows.map((r) => r.lineId)).toEqual(['l-venta', 'l-gasto', 'l-nc']);
    expect(rows.map((r) => r.entrada)).toEqual([100000, 0, -30000]);
    expect(rows.map((r) => r.salida)).toEqual([0, 60000, 0]);
    expect(rows.map((r) => r.saldo)).toEqual([100000, 40000, 10000]);
  });

  it('desempata por número de asiento y después por id de línea', () => {
    const mismaFecha = new Date('2026-09-01T00:00:00.000Z');
    const rows = buildMovementRows([
      makeLine({ lineId: 'b', entryNumber: 7, date: mismaFecha, credit: 10 }),
      makeLine({ lineId: 'a', entryNumber: 7, date: mismaFecha, credit: 20 }),
      makeLine({ lineId: 'z', entryNumber: 5, date: mismaFecha, credit: 30 }),
    ]);

    expect(rows.map((r) => r.lineId)).toEqual(['z', 'a', 'b']);
  });

  it('lista vacía devuelve []', () => {
    expect(buildMovementRows([])).toEqual([]);
  });
});

describe('groupByCostCenter', () => {
  const SIN_CENTRO = makeLine({
    lineId: 'l-sin',
    entryId: 'e-sin',
    entryNumber: 4,
    date: new Date('2026-09-12T00:00:00.000Z'),
    credit: 5000,
    costCenterId: null,
    costCenterName: null,
  });

  const MANTENIMIENTO = makeLine({
    lineId: 'l-mant',
    entryId: 'e-gasto',
    entryNumber: 2,
    date: new Date('2026-09-05T00:00:00.000Z'),
    accountNature: 'DEBIT',
    accountCode: '4.2.1',
    accountName: 'Combustible',
    debit: 40000,
    costCenterId: 'cc-mant',
    costCenterName: 'Mantenimiento',
  });

  it('arma un grupo por centro, con el de sin centro último y con etiqueta propia', () => {
    const groups = groupByCostCenter([SIN_CENTRO, MANTENIMIENTO, VENTA, GASTO, NOTA_CREDITO]);

    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.costCenterName)).toEqual([
      'Logística',
      'Mantenimiento',
      NO_COST_CENTER_LABEL,
    ]);
    expect(groups[2].costCenterId).toBeNull();
  });

  it('cada grupo trae sus totales y su saldo acumulado propio, no el global', () => {
    const groups = groupByCostCenter([SIN_CENTRO, MANTENIMIENTO, VENTA, GASTO, NOTA_CREDITO]);
    const [logistica, mantenimiento, sinCentro] = groups;

    expect(logistica.totalEntradas).toBe(70000); // 100.000 de venta − 30.000 de NC
    expect(logistica.totalSalidas).toBe(60000);
    expect(logistica.saldo).toBe(10000);
    expect(logistica.rows.map((r) => r.saldo)).toEqual([100000, 40000, 10000]);

    expect(mantenimiento.totalEntradas).toBe(0);
    expect(mantenimiento.totalSalidas).toBe(40000);
    expect(mantenimiento.saldo).toBe(-40000);
    expect(mantenimiento.rows.map((r) => r.saldo)).toEqual([-40000]);

    expect(sinCentro.totalEntradas).toBe(5000);
    expect(sinCentro.rows.map((r) => r.saldo)).toEqual([5000]);
  });

  it('los totales generales coinciden con la suma de los grupos, sin arrastrar error de punto flotante', () => {
    const groups = groupByCostCenter([
      makeLine({
        lineId: 'a',
        credit: 60000.55,
        costCenterId: 'cc-log',
        costCenterName: 'Logística',
      }),
      makeLine({
        lineId: 'b',
        credit: 39999.45,
        costCenterId: 'cc-mant',
        costCenterName: 'Mantenimiento',
      }),
      makeLine({
        lineId: 'c',
        accountNature: 'DEBIT',
        debit: 0.1,
        costCenterId: 'cc-mant',
        costCenterName: 'Mantenimiento',
      }),
      makeLine({
        lineId: 'd',
        accountNature: 'DEBIT',
        debit: 0.2,
        costCenterId: 'cc-mant',
        costCenterName: 'Mantenimiento',
      }),
    ]);

    const totals = sumGroupTotals(groups);

    expect(totals.entradas).toBe(100000);
    expect(totals.salidas).toBe(0.3); // 0.1 + 0.2 sin el 0.30000000000000004
    expect(totals.saldo).toBe(99999.7);
    expect(totals.entradas).toBe(groups[0].totalEntradas + groups[1].totalEntradas);
  });
});

describe('summarizeDrafts', () => {
  it('cuenta asientos distintos, no líneas, y calcula el saldo con la misma regla de signo', () => {
    const drafts = [
      makeLine({ lineId: 'd1', entryId: 'borr-1', accountNature: 'DEBIT', debit: 15000 }),
      makeLine({ lineId: 'd2', entryId: 'borr-1', accountNature: 'DEBIT', debit: 10000 }),
      makeLine({ lineId: 'd3', entryId: 'borr-2', accountNature: 'CREDIT', credit: 5000 }),
    ];

    expect(summarizeDrafts(drafts)).toEqual({ entryCount: 2, saldo: -20000 });
  });

  it('sin borradores devuelve el resumen en cero', () => {
    expect(summarizeDrafts([])).toEqual({ entryCount: 0, saldo: 0 });
  });
});

describe('buildExcelRows', () => {
  const groups = groupByCostCenter([VENTA, GASTO, NOTA_CREDITO]);

  it('aplana grupo por grupo con una fila TOTAL al final de cada uno', () => {
    const rows = buildExcelRows(groups, { includeStatus: false });

    expect(rows).toHaveLength(4); // 3 movimientos + TOTAL
    expect(rows[0]).toMatchObject({
      centro: 'Logística',
      asiento: 1,
      codigo: '4.1.1',
      cuenta: 'Ventas',
      debe: 0,
      haber: 100000,
      entrada: 100000,
      salida: 0,
      saldo: 100000,
    });
    expect(rows[3]).toMatchObject({
      centro: 'Logística',
      cuenta: 'TOTAL',
      entrada: 70000,
      salida: 60000,
      saldo: 10000,
    });
  });

  it('sin includeStatus las filas no traen la clave estado; con includeStatus sí', () => {
    const sinEstado = buildExcelRows(groups, { includeStatus: false });
    expect(sinEstado.every((row) => !('estado' in row))).toBe(true);

    const conEstado = buildExcelRows(groups, { includeStatus: true });
    expect(conEstado[0].estado).toBe('POSTED');
    expect(conEstado[conEstado.length - 1].estado).toBe('');
  });
});
