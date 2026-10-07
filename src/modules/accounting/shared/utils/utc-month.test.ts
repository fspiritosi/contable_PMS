/**
 * Tests de `utc-month` (TSK-760, D8/B22): todo cálculo de mes y día se hace en
 * UTC y no depende de la zona horaria del servidor.
 *
 * Se corre la misma batería con `TZ=UTC` y con `TZ=America/Argentina/Buenos_Aires`
 * (UTC-3): la zona se fija antes de importar el módulo (y moment) con
 * `vi.resetModules`, en dos `describe`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type UtcMonthModule = typeof import('./utc-month');

const ORIGINAL_TZ = process.env.TZ;

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const iso = (d: Date) => d.toISOString();

for (const tz of ['UTC', 'America/Argentina/Buenos_Aires']) {
  describe(`utc-month con TZ=${tz}`, () => {
    let m: UtcMonthModule;

    beforeAll(async () => {
      process.env.TZ = tz;
      vi.resetModules();
      m = await import('./utc-month');
    });

    it('la zona horaria del proceso es la pedida (el test ejercita la diferencia)', () => {
      const localDay = new Date('2026-03-01T02:59:00.000Z').getDate();
      expect(localDay).toBe(tz === 'UTC' ? 1 : 28);
    });

    describe('monthKeyUtc / toUtcDay (B22)', () => {
      it('día 1 a las 00:00Z cae en el mes del día 1', () => {
        expect(m.monthKeyUtc(new Date('2026-03-01T00:00:00.000Z'))).toEqual({ year: 2026, month: 3 });
      });

      it('día 1 a las 02:59Z cae en el mes del día 1 (no en el anterior)', () => {
        expect(m.monthKeyUtc(new Date('2026-03-01T02:59:59.999Z'))).toEqual({ year: 2026, month: 3 });
        expect(m.toUtcDay(new Date('2026-03-01T02:59:59.999Z'))).toBe('2026-03-01');
      });

      it('último milisegundo de febrero cae en febrero', () => {
        expect(m.monthKeyUtc(new Date('2026-02-28T23:59:59.999Z'))).toEqual({ year: 2026, month: 2 });
      });

      it('1 de enero 00:30Z es enero (no diciembre del año anterior)', () => {
        expect(m.monthKeyUtc(new Date('2027-01-01T00:30:00.000Z'))).toEqual({ year: 2027, month: 1 });
      });
    });

    describe('inicio y fin de mes y de día', () => {
      it('endOfMonthUtc de febrero bisiesto 2028 = 29 23:59:59.999Z', () => {
        expect(iso(m.endOfMonthUtc({ year: 2028, month: 2 }))).toBe('2028-02-29T23:59:59.999Z');
      });

      it('endOfMonthUtc de febrero 2026 = 28 y de diciembre = 31', () => {
        expect(iso(m.endOfMonthUtc({ year: 2026, month: 2 }))).toBe('2026-02-28T23:59:59.999Z');
        expect(iso(m.endOfMonthUtc({ year: 2026, month: 12 }))).toBe('2026-12-31T23:59:59.999Z');
      });

      it('startOfMonthUtc = día 1 00:00:00.000Z', () => {
        expect(iso(m.startOfMonthUtc({ year: 2026, month: 3 }))).toBe('2026-03-01T00:00:00.000Z');
      });

      it('startOfDayUtc / endOfDayUtc aceptan Date e IsoDay', () => {
        expect(iso(m.startOfDayUtc(new Date('2026-03-10T22:15:00.000Z')))).toBe('2026-03-10T00:00:00.000Z');
        expect(iso(m.endOfDayUtc(new Date('2026-03-10T02:15:00.000Z')))).toBe('2026-03-10T23:59:59.999Z');
        expect(iso(m.startOfDayUtc('2026-12-31'))).toBe('2026-12-31T00:00:00.000Z');
        expect(iso(m.endOfDayUtc('2026-12-31'))).toBe('2026-12-31T23:59:59.999Z');
      });
    });

    describe('parseIsoDay', () => {
      it('día válido → 00:00:00.000Z', () => {
        expect(iso(m.parseIsoDay('2028-02-29'))).toBe('2028-02-29T00:00:00.000Z');
      });

      it('día inexistente o con formato inválido → BusinessError', () => {
        expect(() => m.parseIsoDay('2026-02-29')).toThrow(/Fecha inválida/);
        expect(() => m.parseIsoDay('10/03/2026')).toThrow(/Fecha inválida/);
        try {
          m.parseIsoDay('2026-13-01');
          expect.unreachable();
        } catch (error) {
          expect((error as Error).name).toBe('BusinessError');
        }
      });
    });

    describe('aritmética de meses', () => {
      it('addMonths cruza años en ambos sentidos', () => {
        expect(m.addMonths({ year: 2026, month: 11 }, 3)).toEqual({ year: 2027, month: 2 });
        expect(m.addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
        expect(m.addMonths({ year: 2026, month: 5 }, 0)).toEqual({ year: 2026, month: 5 });
      });

      it('compareYearMonth ordena por año y mes', () => {
        expect(m.compareYearMonth({ year: 2026, month: 3 }, { year: 2026, month: 4 })).toBeLessThan(0);
        expect(m.compareYearMonth({ year: 2027, month: 1 }, { year: 2026, month: 12 })).toBeGreaterThan(0);
        expect(m.compareYearMonth({ year: 2026, month: 3 }, { year: 2026, month: 3 })).toBe(0);
      });
    });

    describe('monthsBetweenUtc', () => {
      it('FY irregular de 18 meses → 18 meses, de ene 2026 a jun 2027', () => {
        const months = m.monthsBetweenUtc(
          new Date('2026-01-01T00:00:00.000Z'),
          new Date('2027-06-30T23:59:59.999Z')
        );
        expect(months).toHaveLength(18);
        expect(months[0]).toEqual({ year: 2026, month: 1 });
        expect(months[17]).toEqual({ year: 2027, month: 6 });
      });

      it('FY de 6 meses → 6 meses', () => {
        const months = m.monthsBetweenUtc(
          new Date('2026-07-01T00:00:00.000Z'),
          new Date('2026-12-31T23:59:59.999Z')
        );
        expect(months.map((ym) => ym.month)).toEqual([7, 8, 9, 10, 11, 12]);
      });

      it('rango de Ajustes guardado a las 03:00Z → 12 meses (no 13)', () => {
        const months = m.monthsBetweenUtc(
          new Date('2026-01-01T03:00:00.000Z'),
          new Date('2026-12-31T03:00:00.000Z')
        );
        expect(months).toHaveLength(12);
        expect(months[11]).toEqual({ year: 2026, month: 12 });
      });
    });

    describe('isOnOrBeforeDayUtc', () => {
      it('mismo día con distinta hora → true', () => {
        expect(
          m.isOnOrBeforeDayUtc(new Date('2026-03-31T23:00:00.000Z'), new Date('2026-03-31T00:00:00.000Z'))
        ).toBe(true);
      });

      it('día siguiente → false aunque la diferencia sea 1 ms', () => {
        expect(
          m.isOnOrBeforeDayUtc(new Date('2026-04-01T00:00:00.000Z'), new Date('2026-03-31T23:59:59.999Z'))
        ).toBe(false);
      });

      it('día anterior → true', () => {
        expect(
          m.isOnOrBeforeDayUtc(new Date('2026-03-30T12:00:00.000Z'), new Date('2026-03-31T00:00:00.000Z'))
        ).toBe(true);
      });
    });

    describe('formatos', () => {
      it('formatMonth → MM/YYYY', () => {
        expect(m.formatMonth({ year: 2026, month: 3 })).toBe('03/2026');
        expect(m.formatMonth({ year: 2026, month: 12 })).toBe('12/2026');
      });

      it('formatMonthLabel → "mar 2026"', () => {
        expect(m.formatMonthLabel({ year: 2026, month: 3 })).toBe('mar 2026');
        expect(m.formatMonthLabel({ year: 2027, month: 1 })).toBe('ene 2027');
      });

      it('formatDayUtc → DD/MM/YYYY del día UTC', () => {
        expect(m.formatDayUtc(new Date('2026-03-10T02:00:00.000Z'))).toBe('10/03/2026');
        expect(m.formatDayUtc('2026-03-10')).toBe('10/03/2026');
      });
    });

    describe('todayBusinessDayUtc (D5 revisado: "hoy" es el día calendario de Argentina)', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('la zona del negocio es una sola constante', () => {
        expect(m.BUSINESS_TIME_ZONE).toBe('America/Argentina/Buenos_Aires');
      });

      it('23:30 AR (02:30Z del día siguiente) → el día de Argentina a 00:00Z', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-07T02:30:00.000Z'));
        expect(iso(m.todayBusinessDayUtc())).toBe('2026-10-06T00:00:00.000Z');
        expect(m.todayBusinessDay()).toBe('2026-10-06');
      });

      it('22:40 AR (01:40Z) → el día de Argentina, no el de UTC', () => {
        expect(iso(m.todayBusinessDayUtc(new Date('2026-10-07T01:40:00.000Z')))).toBe(
          '2026-10-06T00:00:00.000Z'
        );
      });

      it('00:00 AR (03:00Z) ya es el día siguiente', () => {
        expect(iso(m.todayBusinessDayUtc(new Date('2026-10-07T03:00:00.000Z')))).toBe(
          '2026-10-07T00:00:00.000Z'
        );
      });

      it('23:59:59.999 AR (02:59:59.999Z) sigue siendo el día anterior', () => {
        expect(iso(m.todayBusinessDayUtc(new Date('2026-10-07T02:59:59.999Z')))).toBe(
          '2026-10-06T00:00:00.000Z'
        );
      });

      it('fin de mes y de año: 31/12 21:30 AR (01/01 00:30Z) → 31/12', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2027-01-01T00:30:00.000Z'));
        expect(iso(m.todayBusinessDayUtc())).toBe('2026-12-31T00:00:00.000Z');
        expect(m.monthKeyUtc(m.todayBusinessDayUtc())).toEqual({ year: 2026, month: 12 });
      });

      it('mediodía AR → el mismo día', () => {
        expect(m.todayBusinessDay(new Date('2026-03-01T15:00:00.000Z'))).toBe('2026-03-01');
      });
    });
  });
}
