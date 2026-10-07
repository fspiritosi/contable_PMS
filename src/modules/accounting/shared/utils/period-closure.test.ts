/**
 * Tests de la definición pura de "período cerrado" (TSK-760, A2/D12, diseño §3.3.2).
 *
 * Un asiento MONTHLY está cerrado si el ejercicio está cerrado, o su mes está
 * cerrado, o su fecha (por día UTC) es <= `lockedUntilDate`. OPENING/CLOSING solo
 * miran ejercicio y período de ese tipo.
 */
import { describe, expect, it } from 'vitest';

import { buildPeriodClosedMessage, evaluatePeriodClosure, type PeriodClosureInput } from './period-closure';

const MARCH_10 = new Date('2026-03-10T15:00:00.000Z');

function input(overrides: Partial<PeriodClosureInput> = {}): PeriodClosureInput {
  return {
    date: MARCH_10,
    periodType: 'MONTHLY',
    fiscalYear: { number: 1, isClosed: false },
    period: { isClosed: false },
    lockedUntilDate: null,
    ...overrides,
  };
}

describe('evaluatePeriodClosure', () => {
  it('todo abierto y sin bloqueo → abierto', () => {
    expect(evaluatePeriodClosure(input())).toEqual({ closed: false });
  });

  it('solo el ejercicio cerrado → FISCAL_YEAR', () => {
    expect(evaluatePeriodClosure(input({ fiscalYear: { number: 1, isClosed: true } }))).toEqual({
      closed: true,
      reason: 'FISCAL_YEAR',
    });
  });

  it('solo el mes cerrado → PERIOD', () => {
    expect(evaluatePeriodClosure(input({ period: { isClosed: true } }))).toEqual({
      closed: true,
      reason: 'PERIOD',
    });
  });

  it('solo lockedUntilDate cubre la fecha → LOCKED_UNTIL', () => {
    expect(
      evaluatePeriodClosure(input({ lockedUntilDate: new Date('2026-03-31T23:59:59.999Z') }))
    ).toEqual({ closed: true, reason: 'LOCKED_UNTIL' });
  });

  it('lockedUntilDate anterior a la fecha → abierto', () => {
    expect(
      evaluatePeriodClosure(input({ lockedUntilDate: new Date('2026-02-28T23:59:59.999Z') }))
    ).toEqual({ closed: false });
  });

  it('día exacto de lockedUntilDate con hora 02:59:59.999 → cerrado (comparación por día UTC)', () => {
    const result = evaluatePeriodClosure(
      input({
        date: new Date('2026-03-31T20:00:00.000Z'),
        lockedUntilDate: new Date('2026-03-31T02:59:59.999Z'),
      })
    );
    expect(result).toEqual({ closed: true, reason: 'LOCKED_UNTIL' });
  });

  it('escenario 1 (1.6.2): lockedUntilDate cubre y el mes figura abierto → cerrado igual', () => {
    const result = evaluatePeriodClosure(
      input({ period: { isClosed: false }, lockedUntilDate: new Date('2026-04-30T23:59:59.999Z') })
    );
    expect(result).toEqual({ closed: true, reason: 'LOCKED_UNTIL' });
  });

  it('escenario 2 (1.6.2): mes cerrado y lockedUntilDate nulo o menor → cerrado igual', () => {
    expect(evaluatePeriodClosure(input({ period: { isClosed: true }, lockedUntilDate: null }))).toEqual({
      closed: true,
      reason: 'PERIOD',
    });
    expect(
      evaluatePeriodClosure(
        input({ period: { isClosed: true }, lockedUntilDate: new Date('2026-01-31T23:59:59.999Z') })
      )
    ).toEqual({ closed: true, reason: 'PERIOD' });
  });

  it('precedencia: FY cerrado > período cerrado > lockedUntilDate', () => {
    const all = input({
      fiscalYear: { number: 1, isClosed: true },
      period: { isClosed: true },
      lockedUntilDate: new Date('2026-12-31T23:59:59.999Z'),
    });
    expect(evaluatePeriodClosure(all)).toEqual({ closed: true, reason: 'FISCAL_YEAR' });
    expect(evaluatePeriodClosure({ ...all, fiscalYear: { number: 1, isClosed: false } })).toEqual({
      closed: true,
      reason: 'PERIOD',
    });
  });

  it('OPENING y CLOSING ignoran lockedUntilDate (D12)', () => {
    const locked = new Date('2026-12-31T23:59:59.999Z');
    for (const periodType of ['OPENING', 'CLOSING'] as const) {
      expect(evaluatePeriodClosure(input({ periodType, lockedUntilDate: locked }))).toEqual({
        closed: false,
      });
      expect(
        evaluatePeriodClosure(input({ periodType, lockedUntilDate: locked, period: { isClosed: true } }))
      ).toEqual({ closed: true, reason: 'PERIOD' });
      expect(
        evaluatePeriodClosure(
          input({ periodType, lockedUntilDate: locked, fiscalYear: { number: 1, isClosed: true } })
        )
      ).toEqual({ closed: true, reason: 'FISCAL_YEAR' });
    }
  });
});

describe('buildPeriodClosedMessage (textos exactos de §3.3.2)', () => {
  it('PERIOD (MONTHLY)', () => {
    expect(
      buildPeriodClosedMessage({
        date: MARCH_10,
        reason: 'PERIOD',
        periodType: 'MONTHLY',
        fiscalYearNumber: 1,
        lockedUntilDate: null,
      })
    ).toBe(
      'No se puede registrar con fecha 10/03/2026: el período está cerrado (mes 03/2026 cerrado). ' +
        'Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.'
    );
  });

  it('FISCAL_YEAR', () => {
    expect(
      buildPeriodClosedMessage({
        date: MARCH_10,
        reason: 'FISCAL_YEAR',
        periodType: 'MONTHLY',
        fiscalYearNumber: 1,
        lockedUntilDate: null,
      })
    ).toBe('No se puede registrar con fecha 10/03/2026: el período está cerrado (ejercicio N° 1 cerrado).');
  });

  it('LOCKED_UNTIL', () => {
    expect(
      buildPeriodClosedMessage({
        date: MARCH_10,
        reason: 'LOCKED_UNTIL',
        periodType: 'MONTHLY',
        fiscalYearNumber: 1,
        lockedUntilDate: new Date('2026-03-31T23:59:59.999Z'),
      })
    ).toBe(
      'No se puede registrar con fecha 10/03/2026: el período está cerrado (bloqueado hasta 31/03/2026). ' +
        'Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.'
    );
  });

  it('PERIOD (OPENING)', () => {
    expect(
      buildPeriodClosedMessage({
        date: new Date('2027-01-01T00:00:00.000Z'),
        reason: 'PERIOD',
        periodType: 'OPENING',
        fiscalYearNumber: 2,
        lockedUntilDate: null,
      })
    ).toBe(
      'No se puede registrar con fecha 01/01/2027: el período está cerrado (apertura del ejercicio N° 2 cerrada).'
    );
  });

  it('PERIOD (CLOSING)', () => {
    expect(
      buildPeriodClosedMessage({
        date: new Date('2026-12-31T23:59:59.999Z'),
        reason: 'PERIOD',
        periodType: 'CLOSING',
        fiscalYearNumber: 1,
        lockedUntilDate: null,
      })
    ).toBe(
      'No se puede registrar con fecha 31/12/2026: el período está cerrado (cierre del ejercicio N° 1 cerrado).'
    );
  });

  it('con subject (reversión)', () => {
    expect(
      buildPeriodClosedMessage({
        date: MARCH_10,
        reason: 'PERIOD',
        periodType: 'MONTHLY',
        fiscalYearNumber: 1,
        lockedUntilDate: null,
        subject: 'No se puede anular el asiento N° 12 (fecha 10/03/2026)',
      })
    ).toBe(
      'No se puede anular el asiento N° 12 (fecha 10/03/2026): el período está cerrado (mes 03/2026 cerrado). ' +
        'Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.'
    );
  });

  it('la fecha y el mes salen del día UTC (día 1 a las 02:00Z es el día 1)', () => {
    const message = buildPeriodClosedMessage({
      date: new Date('2026-04-01T02:00:00.000Z'),
      reason: 'PERIOD',
      periodType: 'MONTHLY',
      fiscalYearNumber: 1,
      lockedUntilDate: null,
    });
    expect(message).toContain('fecha 01/04/2026');
    expect(message).toContain('(mes 04/2026 cerrado)');
  });

  it('todos los textos contienen "el período está cerrado" (tests existentes)', () => {
    for (const reason of ['PERIOD', 'FISCAL_YEAR', 'LOCKED_UNTIL'] as const) {
      expect(
        buildPeriodClosedMessage({
          date: MARCH_10,
          reason,
          periodType: 'MONTHLY',
          fiscalYearNumber: 1,
          lockedUntilDate: new Date('2026-03-31T23:59:59.999Z'),
        })
      ).toContain('el período está cerrado');
    }
  });
});
