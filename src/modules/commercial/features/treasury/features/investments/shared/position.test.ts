import { describe, expect, it } from 'vitest';

import { BusinessError } from '@/shared/lib/action-result';

import { computeSaleCost, firstNegativePoint, positionAt, type PositionMovement } from './position';

const d = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

const mov = (
  kind: PositionMovement['kind'],
  date: string,
  bookDelta: number,
  nominalsDelta: number | null = null,
  createdAt = '2026-01-01T00:00:00.000Z'
): PositionMovement => ({
  kind,
  date: d(date),
  bookDelta,
  nominalsDelta,
  createdAt: new Date(createdAt),
});

describe('computeSaleCost', () => {
  it('venta parcial con nominales: costo proporcional al valor en libros', () => {
    const r = computeSaleCost({
      bookValue: 1000,
      nominals: 100,
      soldNominals: 40,
      proceeds: 500,
      isFullSale: false,
    });
    expect(r).toEqual({ cost: 400, nominalsDelta: -40, result: 100, closesHolding: false });
  });

  it('venta total: costo = valor en libros y cierra la tenencia', () => {
    const r = computeSaleCost({
      bookValue: 1000,
      nominals: 100,
      soldNominals: null,
      proceeds: 900,
      isFullSale: true,
    });
    expect(r).toEqual({ cost: 1000, nominalsDelta: -100, result: -100, closesHolding: true });
  });

  it('vender todos los nominales se trata como venta total', () => {
    const r = computeSaleCost({
      bookValue: 1000,
      nominals: 100,
      soldNominals: 100,
      proceeds: 1100,
      isFullSale: false,
    });
    expect(r.closesHolding).toBe(true);
    expect(r.cost).toBe(1000);
    expect(r.result).toBe(100);
  });

  it('ruling R8: venta parcial sin nominales vendidos de una tenencia con nominales: error', () => {
    expect(() =>
      computeSaleCost({
        bookValue: 1000,
        nominals: 100,
        soldNominals: null,
        proceeds: 500,
        isFullSale: false,
      })
    ).toThrow(new BusinessError('Indicá los nominales vendidos'));
  });

  it('rechaza vender más nominales de los que hay', () => {
    expect(() =>
      computeSaleCost({
        bookValue: 1000,
        nominals: 100,
        soldNominals: 101,
        proceeds: 500,
        isFullSale: false,
      })
    ).toThrow(new BusinessError('No podés vender más nominales de los que tiene la tenencia'));
  });

  it('sin nominales, cobrar más que el valor en libros sin venta total es un error', () => {
    expect(() =>
      computeSaleCost({
        bookValue: 1000,
        nominals: null,
        soldNominals: null,
        proceeds: 1200,
        isFullSale: false,
      })
    ).toThrow(
      new BusinessError(
        'El importe supera el valor en libros de la tenencia. Si vendés todo, marcá "Venta total".'
      )
    );
  });

  it('sin nominales, venta parcial: costo = cobrado y sin resultado', () => {
    const r = computeSaleCost({
      bookValue: 1000,
      nominals: null,
      soldNominals: null,
      proceeds: 300,
      isFullSale: false,
    });
    expect(r).toEqual({ cost: 300, nominalsDelta: null, result: 0, closesHolding: false });
  });
});

describe('positionAt', () => {
  const compra = mov('PURCHASE', '2026-03-01', 1000, 100);
  const venta = mov('SALE', '2026-03-10', -400, -40);

  it('suma compra y venta parcial', () => {
    expect(positionAt([compra, venta])).toEqual({ bookValue: 600, nominals: 60 });
  });

  it('ignora movimientos posteriores a la fecha de corte', () => {
    const posterior = mov('PURCHASE', '2027-01-02', 500, 50);
    expect(positionAt([compra, posterior], d('2026-12-31'))).toEqual({
      bookValue: 1000,
      nominals: 100,
    });
  });

  it('nominales null si ningún movimiento los tiene', () => {
    expect(positionAt([mov('PURCHASE', '2026-03-01', 1000)])).toEqual({
      bookValue: 1000,
      nominals: null,
    });
  });

  it('suma una valuación del mismo día que una venta', () => {
    const val = mov('VALUATION', '2026-12-31', 50);
    const vta = mov('SALE', '2026-12-31', -400, -40);
    expect(positionAt([compra, vta, val], d('2026-12-31'))).toEqual({
      bookValue: 650,
      nominals: 60,
    });
  });
});

describe('firstNegativePoint', () => {
  it('devuelve la venta anterior a la compra que la cubría', () => {
    const compra = mov('PURCHASE', '2026-03-10', 1000);
    const venta = mov('SALE', '2026-03-05', -800);
    expect(firstNegativePoint([compra, venta])).toBe(venta);
  });

  it('null si nunca queda negativa', () => {
    expect(
      firstNegativePoint([mov('PURCHASE', '2026-03-01', 1000), mov('SALE', '2026-03-05', -800)])
    ).toBeNull();
  });

  it('a igual fecha, la compra va antes que la venta', () => {
    const venta = mov('SALE', '2026-03-05', -800);
    const compra = mov('PURCHASE', '2026-03-05', 1000);
    expect(firstNegativePoint([venta, compra])).toBeNull();
  });

  it('detecta nominales negativos', () => {
    const compra = mov('PURCHASE', '2026-03-01', 1000, 10);
    const venta = mov('SALE', '2026-03-02', -100, -11);
    expect(firstNegativePoint([compra, venta])).toBe(venta);
  });
});

describe('correcciones de la ronda 1', () => {
  it('computeSaleCost rechaza nominales vendidos <= 0', () => {
    expect(() =>
      computeSaleCost({
        bookValue: 1000,
        nominals: 100,
        soldNominals: 0,
        proceeds: 500,
        isFullSale: false,
      })
    ).toThrow(new BusinessError('Los nominales vendidos deben ser mayores a 0'));
  });

  it('positionAt compara por día calendario UTC', () => {
    const medianoche = {
      ...mov('PURCHASE', '2026-12-31', 100),
      date: new Date('2026-12-31T00:00:00.000Z'),
    };
    const mediodia = mov('PURCHASE', '2026-12-31', 10);
    expect(positionAt([medianoche], new Date('2026-12-31T12:00:00.000Z')).bookValue).toBe(100);
    expect(positionAt([mediodia], new Date('2026-12-31T00:00:00.000Z')).bookValue).toBe(10);
  });
});
