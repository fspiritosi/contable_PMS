/**
 * Tests de integración del control de período (TSK-760, A2/D1/D8/D12, diseño §3.3.3)
 * contra la base real (`contable-pms-db`).
 *
 * Código real: `lockAccountingSettingsTx`, `ensureFiscalYearTx`, `assertPeriodOpen`,
 * `ensurePeriodsTx` y `syncLockedUntilDateTx`, siempre dentro de un
 * `prisma.$transaction` como los usarán las actions. Cada caso usa su propia
 * empresa (prefijo `TSK760-PL-`) y `afterAll` borra todo lo creado, incluidos los
 * ejercicios y períodos que crea el núcleo de forma perezosa (R7).
 */
import 'dotenv/config';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// `period-lock.ts` abre con `import 'server-only'` (marcador de Next).
vi.mock('server-only', () => ({}));

import { cleanupAccountingCompany } from '../test-utils/cleanup-accounting-company';
import type { Tx } from './journal-entry-types';
import {
  assertPeriodOpen,
  ensureFiscalYearTx,
  lockAccountingSettingsTx,
  syncLockedUntilDateTx,
} from './period-lock';

const PREFIX = 'TSK760-PL-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const d = (isoString: string) => new Date(isoString);
const inTx = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn);

describe.skipIf(!dbAvailable)('núcleo de período cerrado (TSK-760)', () => {
  const companyIds: string[] = [];

  /** Empresa con Ajustes 2026 guardados a las 03:00Z (como los guarda hoy la UI desde UTC-3). */
  async function setupCompany(
    name: string,
    settings: { lockedUntilDate?: Date | null; withSettings?: boolean } = {}
  ): Promise<string> {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}${name}`, isActive: true },
      select: { id: true },
    });
    companyIds.push(company.id);
    if (settings.withSettings !== false) {
      await prisma.accountingSettings.create({
        data: {
          companyId: company.id,
          fiscalYearStart: d('2026-01-01T03:00:00.000Z'),
          fiscalYearEnd: d('2026-12-31T03:00:00.000Z'),
          lockedUntilDate: settings.lockedUntilDate ?? null,
        },
      });
    }
    return company.id;
  }

  const fiscalYears = (companyId: string) =>
    prisma.fiscalYear.findMany({
      where: { companyId },
      orderBy: { number: 'asc' },
      select: {
        id: true,
        number: true,
        startDate: true,
        endDate: true,
        isClosed: true,
        periods: { select: { id: true, year: true, month: true, type: true, isClosed: true } },
      },
    });

  async function closeMonthly(companyId: string, year: number, month: number) {
    await prisma.accountingPeriod.updateMany({
      where: { fiscalYear: { companyId }, year, month, type: 'MONTHLY' },
      data: { isClosed: true },
    });
  }

  async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
      await promise;
    } catch (error) {
      return error as Error;
    }
    throw new Error('Se esperaba un rechazo');
  }

  afterAll(async () => {
    for (const companyId of companyIds) {
      await cleanupAccountingCompany(companyId);
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }

    const [companies, fys, periods] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.fiscalYear.count({ where: { companyId: { in: companyIds } } }),
      prisma.accountingPeriod.count({ where: { fiscalYear: { companyId: { in: companyIds } } } }),
    ]);
    expect(companies).toBe(0);
    expect(fys).toBe(0);
    expect(periods).toBe(0);
  });

  describe('lockAccountingSettingsTx', () => {
    it('devuelve los Ajustes de la empresa', async () => {
      const companyId = await setupCompany('Lock');
      const settings = await inTx((tx) => lockAccountingSettingsTx(tx, companyId));
      expect(settings.companyId).toBe(companyId);
      expect(settings.fiscalYearStart.toISOString()).toBe('2026-01-01T03:00:00.000Z');
      expect(settings.fiscalYearEnd.toISOString()).toBe('2026-12-31T03:00:00.000Z');
      expect(settings.lockedUntilDate).toBeNull();
    });

    it('empresa sin Ajustes → NO_SETTINGS', async () => {
      const companyId = await setupCompany('Sin Ajustes', { withSettings: false });
      const error = await rejection(inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-03-10'))));
      expect(error.name).toBe('BusinessError');
      expect(error.message).toBe(
        'No se encontró configuración contable para la empresa. Configurala en Contabilidad → Configuración.'
      );
    });
  });

  describe('ensureFiscalYearTx / assertPeriodOpen crean el ejercicio (D1)', () => {
    it('sin FY → crea FY 1 desde Ajustes (03:00Z normalizado) con OPENING + 12 MONTHLY + CLOSING', async () => {
      const companyId = await setupCompany('FY1');

      const ref = await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-03-10T15:00:00.000Z')));

      const [fy] = await fiscalYears(companyId);
      expect(fy.number).toBe(1);
      expect(fy.startDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(fy.endDate.toISOString()).toBe('2026-12-31T23:59:59.999Z');
      expect(fy.periods.filter((p) => p.type === 'MONTHLY')).toHaveLength(12);
      expect(fy.periods.filter((p) => p.type === 'OPENING')).toEqual([
        expect.objectContaining({ year: 2026, month: 1 }),
      ]);
      expect(fy.periods.filter((p) => p.type === 'CLOSING')).toEqual([
        expect.objectContaining({ year: 2026, month: 12 }),
      ]);

      const march = fy.periods.find((p) => p.type === 'MONTHLY' && p.month === 3);
      expect(ref).toEqual({ fiscalYearId: fy.id, fiscalYearNumber: 1, periodId: march?.id });
    });

    it('fecha dentro de un FY existente → no crea nada', async () => {
      const companyId = await setupCompany('FY existente');
      await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-02-01')));
      const ref = await inTx(async (tx) => {
        const settings = await lockAccountingSettingsTx(tx, companyId);
        return ensureFiscalYearTx(tx, settings, d('2026-11-30T23:00:00.000Z'));
      });
      expect(ref.number).toBe(1);
      expect(await fiscalYears(companyId)).toHaveLength(1);
    });

    it('fecha del FY siguiente → lo crea contiguo, 12 meses, con sus 14 períodos', async () => {
      const companyId = await setupCompany('FY2');
      await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-06-15')));

      const ref = await inTx((tx) => assertPeriodOpen(tx, companyId, d('2027-05-10T12:00:00.000Z')));

      const fys = await fiscalYears(companyId);
      expect(fys.map((fy) => fy.number)).toEqual([1, 2]);
      const fy2 = fys[1];
      expect(fy2.startDate.toISOString()).toBe('2027-01-01T00:00:00.000Z');
      expect(fy2.endDate.toISOString()).toBe('2027-12-31T23:59:59.999Z');
      expect(fy2.periods.filter((p) => p.type === 'MONTHLY')).toHaveLength(12);
      expect(fy2.periods.filter((p) => p.type === 'OPENING')).toHaveLength(1);
      expect(fy2.periods.filter((p) => p.type === 'CLOSING')).toHaveLength(1);
      expect(ref.fiscalYearNumber).toBe(2);
      const may = fy2.periods.find((p) => p.type === 'MONTHLY' && p.year === 2027 && p.month === 5);
      expect(ref.periodId).toBe(may?.id);
    });

    it('sin FY y fecha del ejercicio siguiente a Ajustes → crea FY 1 y FY 2', async () => {
      const companyId = await setupCompany('FY1 y FY2');
      const ref = await inTx((tx) => assertPeriodOpen(tx, companyId, d('2027-01-15')));
      expect(ref.fiscalYearNumber).toBe(2);
      expect((await fiscalYears(companyId)).map((fy) => fy.number)).toEqual([1, 2]);
    });

    it('dos ejercicios adelante → TOO_FAR_AHEAD', async () => {
      const companyId = await setupCompany('Lejos');
      await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-06-15')));

      const error = await rejection(inTx((tx) => assertPeriodOpen(tx, companyId, d('2028-03-05T10:00:00.000Z'))));
      expect(error.name).toBe('BusinessError');
      expect(error.message).toBe(
        'La fecha 05/03/2028 está más de un ejercicio por delante del último ejercicio (N° 1, hasta 31/12/2026).'
      );
      expect((await fiscalYears(companyId)).map((fy) => fy.number)).toEqual([1]);
    });

    it('anterior al primer ejercicio → BEFORE_FIRST_FY', async () => {
      const companyId = await setupCompany('Antes');
      await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-06-15')));

      const error = await rejection(inTx((tx) => assertPeriodOpen(tx, companyId, d('2025-12-15T12:00:00.000Z'))));
      expect(error.name).toBe('BusinessError');
      expect(error.message).toBe(
        'La fecha 15/12/2025 es anterior al inicio del primer ejercicio (01/01/2026); cargala como saldo de apertura.'
      );
    });

    it('día 31/12 a las 23:59Z cae en el FY 1 y el 01/01 a las 00:30Z en el FY 2 (D8)', async () => {
      const companyId = await setupCompany('Borde');
      const dec = await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-12-31T23:59:00.000Z')));
      const jan = await inTx((tx) => assertPeriodOpen(tx, companyId, d('2027-01-01T00:30:00.000Z')));
      expect(dec.fiscalYearNumber).toBe(1);
      expect(jan.fiscalYearNumber).toBe(2);
    });
  });

  describe('assertPeriodOpen: las tres condiciones (A2)', () => {
    it('mes cerrado → texto exacto', async () => {
      const companyId = await setupCompany('Mes cerrado');
      await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-01-10')));
      await closeMonthly(companyId, 2026, 3);

      const error = await rejection(inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-03-10T12:00:00.000Z'))));
      expect(error.name).toBe('BusinessError');
      expect(error.message).toBe(
        'No se puede registrar con fecha 10/03/2026: el período está cerrado (mes 03/2026 cerrado). ' +
          'Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.'
      );
      // Los demás meses siguen abiertos.
      await expect(inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-04-01')))).resolves.toBeTruthy();
    });

    it('FY cerrado → texto exacto (aunque el mes figure abierto)', async () => {
      const companyId = await setupCompany('FY cerrado');
      await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-01-10')));
      await prisma.fiscalYear.updateMany({ where: { companyId }, data: { isClosed: true } });

      const error = await rejection(inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-03-10T12:00:00.000Z'))));
      expect(error.message).toBe(
        'No se puede registrar con fecha 10/03/2026: el período está cerrado (ejercicio N° 1 cerrado).'
      );
    });

    it('lockedUntilDate cubre la fecha (mes abierto) → texto exacto', async () => {
      const companyId = await setupCompany('Bloqueado');
      await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-01-10')));
      await prisma.accountingSettings.update({
        where: { companyId },
        data: { lockedUntilDate: d('2026-03-31T23:59:59.999Z') },
      });

      const error = await rejection(inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-03-10T12:00:00.000Z'))));
      expect(error.message).toBe(
        'No se puede registrar con fecha 10/03/2026: el período está cerrado (bloqueado hasta 31/03/2026). ' +
          'Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.'
      );
      await expect(inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-04-01T00:00:00.000Z')))).resolves.toBeTruthy();
    });

    it('sin FY y fecha <= lockedUntilDate → LOCKED_UNTIL sin crear el ejercicio', async () => {
      const companyId = await setupCompany('Bloqueado sin FY', {
        lockedUntilDate: d('2026-02-28T23:59:59.999Z'),
      });

      const { message, fyCount } = await inTx(async (tx) => {
        let caught = '';
        try {
          await assertPeriodOpen(tx, companyId, d('2026-02-10T12:00:00.000Z'));
        } catch (error) {
          caught = (error as Error).message;
        }
        // Se cuenta dentro de la misma tx: el rechazo no debe haber creado nada.
        return { message: caught, fyCount: await tx.fiscalYear.count({ where: { companyId } }) };
      });

      expect(message).toBe(
        'No se puede registrar con fecha 10/02/2026: el período está cerrado (bloqueado hasta 28/02/2026). ' +
          'Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.'
      );
      expect(fyCount).toBe(0);
    });
  });

  describe('OPENING / CLOSING (D12)', () => {
    it('OPENING y CLOSING devuelven su período e ignoran lockedUntilDate', async () => {
      const companyId = await setupCompany('Apertura y cierre', {
        lockedUntilDate: d('2026-12-31T23:59:59.999Z'),
      });
      // MONTHLY rechaza por el bloqueo; OPENING/CLOSING crean el FY y pasan.
      await expect(inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-01-01')))).rejects.toThrow(
        /bloqueado hasta 31\/12\/2026/
      );

      const opening = await inTx((tx) =>
        assertPeriodOpen(tx, companyId, d('2026-01-01T00:00:00.000Z'), { periodType: 'OPENING' })
      );
      const closing = await inTx((tx) =>
        assertPeriodOpen(tx, companyId, d('2026-12-31T23:59:59.999Z'), { periodType: 'CLOSING' })
      );

      const [fy] = await fiscalYears(companyId);
      expect(opening.periodId).toBe(fy.periods.find((p) => p.type === 'OPENING')?.id);
      expect(closing.periodId).toBe(fy.periods.find((p) => p.type === 'CLOSING')?.id);
    });

    it('CLOSING cerrado → texto de cierre; OPENING cerrado → texto de apertura', async () => {
      const companyId = await setupCompany('Apertura y cierre cerrados');
      await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-01-10')));
      await prisma.accountingPeriod.updateMany({
        where: { fiscalYear: { companyId }, type: { in: ['OPENING', 'CLOSING'] } },
        data: { isClosed: true },
      });

      await expect(
        inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-12-31T23:59:59.999Z'), { periodType: 'CLOSING' }))
      ).rejects.toThrow(
        'No se puede registrar con fecha 31/12/2026: el período está cerrado (cierre del ejercicio N° 1 cerrado).'
      );
      await expect(
        inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-01-01T00:00:00.000Z'), { periodType: 'OPENING' }))
      ).rejects.toThrow(
        'No se puede registrar con fecha 01/01/2026: el período está cerrado (apertura del ejercicio N° 1 cerrada).'
      );
    });
  });

  describe('autorreparación de períodos (ensurePeriodsTx)', () => {
    it('si falta el MONTHLY del mes, lo crea y lo devuelve', async () => {
      const companyId = await setupCompany('Reparación');
      await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-01-10')));
      await prisma.accountingPeriod.deleteMany({
        where: { fiscalYear: { companyId }, type: 'MONTHLY', month: 5 },
      });

      const ref = await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-05-20')));

      const [fy] = await fiscalYears(companyId);
      const may = fy.periods.find((p) => p.type === 'MONTHLY' && p.month === 5);
      expect(may).toBeDefined();
      expect(ref.periodId).toBe(may?.id);
      expect(fy.periods).toHaveLength(14);
    });
  });

  describe('syncLockedUntilDateTx', () => {
    const lockedUntil = async (companyId: string) =>
      (
        await prisma.accountingSettings.findUniqueOrThrow({
          where: { companyId },
          select: { lockedUntilDate: true },
        })
      ).lockedUntilDate;

    it('racha contigua desde el primer mes; un hueco la corta', async () => {
      const companyId = await setupCompany('Racha');
      await inTx((tx) => assertPeriodOpen(tx, companyId, d('2026-01-10')));

      expect(await inTx((tx) => syncLockedUntilDateTx(tx, companyId))).toBeNull();
      expect(await lockedUntil(companyId)).toBeNull();

      await closeMonthly(companyId, 2026, 1);
      await closeMonthly(companyId, 2026, 2);
      await closeMonthly(companyId, 2026, 4); // hueco en marzo

      const result = await inTx((tx) => syncLockedUntilDateTx(tx, companyId));
      expect(result?.toISOString()).toBe('2026-02-28T23:59:59.999Z');
      expect((await lockedUntil(companyId))?.toISOString()).toBe('2026-02-28T23:59:59.999Z');
    });

    it('FY cerrado cuenta como todo cerrado y la racha sigue en el FY siguiente', async () => {
      const companyId = await setupCompany('Racha FY cerrado');
      await inTx((tx) => assertPeriodOpen(tx, companyId, d('2027-02-10')));
      await prisma.fiscalYear.updateMany({ where: { companyId, number: 1 }, data: { isClosed: true } });

      const onlyFy = await inTx((tx) => syncLockedUntilDateTx(tx, companyId));
      expect(onlyFy?.toISOString()).toBe('2026-12-31T23:59:59.999Z');

      await closeMonthly(companyId, 2027, 1);
      const withJanuary = await inTx((tx) => syncLockedUntilDateTx(tx, companyId));
      expect(withJanuary?.toISOString()).toBe('2027-01-31T23:59:59.999Z');
      expect((await lockedUntil(companyId))?.toISOString()).toBe('2027-01-31T23:59:59.999Z');
    });
  });
});
