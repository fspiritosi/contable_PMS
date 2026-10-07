/**
 * Tests de integración del cierre y la reapertura de meses (TSK-760, Fase 8: A1, B3, B5,
 * B22, D2) contra la base real (`contable-pms-db`).
 *
 * Código real: las Server Actions `closeAccountingPeriod`, `reopenAccountingPeriod` y
 * `getPeriodLockStatus`, más `createJournalEntry` para sembrar borradores y comprobar que
 * un mes cerrado rechaza el asiento manual (B3).
 *
 * Cada bloque usa su propia empresa (prefijo `TSK760-PLK-`). `afterAll` limpia con
 * `cleanupAccountingCompany` (los POSTED son inmutables por trigger).
 */
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// `revalidateAccountingRoutes` hace `require('next/cache')` (no lo intercepta vi.mock).
vi.mock('../../shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/utils')>()),
  revalidateAccountingRoutes: vi.fn(),
}));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { checkPermission } from '@/shared/lib/permissions';

import { cleanupAccountingCompany } from '../../shared/test-utils/cleanup-accounting-company';
import { assertPeriodOpen } from '../../shared/utils/period-lock';
import { createJournalEntry } from '../entries/actions.server';
import {
  closeAccountingPeriod,
  getPeriodLockStatus,
  reopenAccountingPeriod,
} from './actions.server';

const PREFIX = 'TSK760-PLK-';
const USER = 'test-user';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

interface TestCompany {
  companyId: string;
  cajaId: string;
  ventasId: string;
  rubroId: string;
}

const companyIds: string[] = [];

async function setupCompany(name: string): Promise<TestCompany> {
  const { id: companyId } = await prisma.company.create({
    data: { name: `${PREFIX}${name}`, isActive: true },
    select: { id: true },
  });
  companyIds.push(companyId);
  const account = (code: string, label: string, extra: object = {}) =>
    prisma.account.create({
      data: {
        companyId,
        code,
        name: `${PREFIX}${label}`,
        type: 'ASSET',
        nature: 'DEBIT',
        ...extra,
      },
      select: { id: true },
    });
  const [caja, ventas, rubro] = await Promise.all([
    account('T760-CAJA', 'Caja'),
    account('T760-VENTAS', 'Ventas', { type: 'REVENUE', nature: 'CREDIT' }),
    account('T760-RUBRO', 'Rubro', { isLeaf: false }),
  ]);
  // Ajustes como los guardaba el formulario viejo (03:00Z = medianoche AR).
  await prisma.accountingSettings.create({
    data: {
      companyId,
      fiscalYearStart: new Date('2026-01-01T03:00:00.000Z'),
      fiscalYearEnd: new Date('2026-12-31T03:00:00.000Z'),
    },
  });
  vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
  return { companyId, cajaId: caja.id, ventasId: ventas.id, rubroId: rubro.id };
}

const asCompany = (c: TestCompany) => vi.mocked(getActiveCompanyId).mockResolvedValue(c.companyId);

const draft = (c: TestCompany, date: Date, amount = '10.00') =>
  createJournalEntry({
    date,
    description: `${PREFIX}borrador`,
    lines: [
      { accountId: c.cajaId, debit: amount, credit: '0.00' },
      { accountId: c.ventasId, debit: '0.00', credit: amount },
    ],
  });

const close = (year: number, month: number, postDrafts = false) =>
  closeAccountingPeriod({ year, month, postDrafts });
const reopen = (year: number, month: number) => reopenAccountingPeriod({ year, month });

async function monthState(companyId: string, year: number, month: number) {
  return prisma.accountingPeriod.findFirstOrThrow({
    where: { fiscalYear: { companyId }, type: 'MONTHLY', year, month },
    select: { isClosed: true, closedBy: true, closedAt: true },
  });
}

async function lockedUntilIso(companyId: string): Promise<string | null> {
  const s = await prisma.accountingSettings.findUniqueOrThrow({
    where: { companyId },
    select: { lockedUntilDate: true },
  });
  return s.lockedUntilDate?.toISOString() ?? null;
}

async function closeUntil(month: number) {
  for (let m = 1; m <= month; m++) {
    const r = await close(2026, m);
    expect(r).toMatchObject({ success: true });
  }
}

describe.skipIf(!dbAvailable)('cierre y reapertura de meses (TSK-760, Fase 8)', () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(USER);
    vi.mocked(checkPermission).mockClear();
  });

  afterAll(async () => {
    for (const companyId of companyIds) {
      await cleanupAccountingCompany(companyId);
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    const [companies, fys] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.fiscalYear.count({ where: { companyId: { in: companyIds } } }),
    ]);
    expect(companies).toBe(0);
    expect(fys).toBe(0);
  });

  describe('orden, reapertura y lockedUntilDate (A1)', () => {
    let c: TestCompany;
    beforeAll(async () => {
      c = await setupCompany('Orden');
    });
    beforeEach(() => asCompany(c));

    it('sin ejercicios: el estado se arma desde Ajustes sin crear nada', async () => {
      const status = await getPeriodLockStatus();

      expect(status?.fiscalYears).toHaveLength(1);
      const fy = status!.fiscalYears[0]!;
      expect(fy).toMatchObject({
        id: null,
        number: 1,
        startDay: '2026-01-01',
        endDay: '2026-12-31',
      });
      expect(fy.months).toHaveLength(12);
      expect(fy.months[0]).toMatchObject({
        year: 2026,
        month: 1,
        label: 'ene 2026',
        action: 'close',
      });
      expect(fy.months.slice(1).every((m) => m.action === null && !m.isClosed)).toBe(true);
      expect(status?.lockedUntil).toBeNull();
      expect(await prisma.fiscalYear.count({ where: { companyId: c.companyId } })).toBe(0);
    });

    it('cierra el primer mes: crea el ejercicio, marca el período y deriva lockedUntilDate', async () => {
      const result = await close(2026, 1);

      expect(result).toEqual({ success: true, lockedUntil: '2026-01-31', postedDrafts: 0 });
      expect(checkPermission).toHaveBeenCalledWith('accounting.settings', 'update', {
        redirect: true,
      });
      expect(checkPermission).not.toHaveBeenCalledWith(
        'accounting.entries',
        'approve',
        expect.anything()
      );
      const jan = await monthState(c.companyId, 2026, 1);
      expect(jan.isClosed).toBe(true);
      expect(jan.closedBy).toBe(USER);
      expect(jan.closedAt).toBeInstanceOf(Date);
      expect(await lockedUntilIso(c.companyId)).toBe('2026-01-31T23:59:59.999Z');
    });

    it('fuera de orden → rechaza con el primer mes abierto y no cierra nada', async () => {
      expect(await close(2026, 3)).toEqual({
        success: false,
        error: 'Solo se puede cerrar el primer mes abierto: 02/2026.',
      });
      expect(await close(2026, 1)).toEqual({
        success: false,
        error: 'Solo se puede cerrar el primer mes abierto: 02/2026.',
      });
      expect((await monthState(c.companyId, 2026, 3)).isClosed).toBe(false);
      expect(await lockedUntilIso(c.companyId)).toBe('2026-01-31T23:59:59.999Z');
    });

    it('mes inexistente o inválido → mensaje legible', async () => {
      expect(await close(2031, 7)).toEqual({
        success: false,
        error: 'No existe el mes 07/2031 en los ejercicios de la empresa.',
      });
      expect(await close(2026, 13)).toEqual({ success: false, error: 'Mes inválido: 2026-13.' });
    });

    it('B3: con el mes cerrado, el asiento manual se rechaza', async () => {
      const result = await draft(c, new Date('2026-01-15T12:00:00.000Z'));
      expect(result).toEqual({
        success: false,
        error:
          'No se puede registrar con fecha 15/01/2026: el período está cerrado (mes 01/2026 cerrado). ' +
          'Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.',
      });
    });

    it('el estado marca el primer abierto para cerrar y el último cerrado para reabrir', async () => {
      expect((await close(2026, 2)).success).toBe(true);
      const months = (await getPeriodLockStatus())!.fiscalYears[0]!.months;

      expect(months.map((m) => m.action).slice(0, 4)).toEqual([null, 'reopen', 'close', null]);
      expect(months.map((m) => m.isClosed).slice(0, 3)).toEqual([true, true, false]);
    });

    it('reabre solo el último cerrado y recalcula lockedUntilDate (hasta NULL)', async () => {
      expect(await reopen(2026, 1)).toEqual({
        success: false,
        error: 'Solo se puede reabrir el último mes cerrado: 02/2026.',
      });
      expect(await reopen(2026, 3)).toEqual({
        success: false,
        error: 'Solo se puede reabrir el último mes cerrado: 02/2026.',
      });

      expect(await reopen(2026, 2)).toEqual({ success: true, lockedUntil: '2026-01-31' });
      expect(await monthState(c.companyId, 2026, 2)).toEqual({
        isClosed: false,
        closedBy: null,
        closedAt: null,
      });
      expect(await lockedUntilIso(c.companyId)).toBe('2026-01-31T23:59:59.999Z');

      expect(await reopen(2026, 1)).toEqual({ success: true, lockedUntil: null });
      expect(await lockedUntilIso(c.companyId)).toBeNull();
      expect(await reopen(2026, 1)).toEqual({
        success: false,
        error: 'No hay meses cerrados para reabrir.',
      });
    });

    it('sin Ajustes → mensaje de configuración', async () => {
      const { id } = await prisma.company.create({
        data: { name: `${PREFIX}SinAjustes` },
        select: { id: true },
      });
      companyIds.push(id);
      vi.mocked(getActiveCompanyId).mockResolvedValue(id);

      expect(await getPeriodLockStatus()).toBeNull();
      expect(await close(2026, 1)).toEqual({
        success: false,
        error:
          'No se encontró configuración contable para la empresa. Configurala en Contabilidad → Configuración.',
      });
    });
  });

  describe('borradores del mes (D2, todo o nada)', () => {
    let c: TestCompany;
    beforeAll(async () => {
      c = await setupCompany('Borradores');
    });
    beforeEach(() => asCompany(c));

    it('con borradores y sin postDrafts → rechaza con cantidad y números', async () => {
      expect(await draft(c, new Date('2026-01-10T12:00:00.000Z'))).toMatchObject({
        success: true,
        number: 1,
      });
      expect(await draft(c, new Date('2026-01-31T23:30:00.000Z'))).toMatchObject({
        success: true,
        number: 2,
      });

      const status = await getPeriodLockStatus();
      expect(status!.fiscalYears[0]!.months[0]).toMatchObject({
        month: 1,
        draftCount: 2,
        action: 'close',
      });

      expect(await close(2026, 1)).toEqual({
        success: false,
        error:
          'El mes 01/2026 tiene 2 borradores sin registrar (N° 1, 2). ' +
          'Registralos o elegí "Registrar los 2 borradores y cerrar".',
      });
      expect((await monthState(c.companyId, 2026, 1)).isClosed).toBe(false);
    });

    it('un borrador que no se puede registrar aborta todo: nada registrado, el mes sigue abierto', async () => {
      // Desbalanceado sembrado por SQL (el núcleo no deja crearlo), con número posterior.
      const bad = await prisma.journalEntry.create({
        data: {
          companyId: c.companyId,
          number: 3,
          date: new Date('2026-01-20T12:00:00.000Z'),
          description: `${PREFIX}desbalanceado`,
          status: 'DRAFT',
          createdBy: USER,
          lines: {
            create: [
              { accountId: c.cajaId, debit: 100, credit: 0 },
              { accountId: c.ventasId, debit: 0, credit: 90 },
            ],
          },
        },
        select: { id: true },
      });
      await prisma.accountingSettings.update({
        where: { companyId: c.companyId },
        data: { lastEntryNumber: 3 },
      });

      const result = await close(2026, 1, true);

      expect(result).toEqual({
        success: false,
        error:
          'No se cerró 01/2026: el borrador N° 3 no se puede registrar. ' +
          'El asiento no está balanceado. Debe: $100.00, Haber: $90.00, Diferencia: $10.00. ' +
          'Si es un asiento manual que ya no sirve, podés eliminarlo desde Asientos.',
      });
      expect(checkPermission).toHaveBeenCalledWith('accounting.entries', 'approve', {
        redirect: true,
      });
      const statuses = await prisma.journalEntry.findMany({
        where: { companyId: c.companyId },
        orderBy: { number: 'asc' },
        select: { number: true, status: true },
      });
      expect(statuses).toEqual([
        { number: 1, status: 'DRAFT' },
        { number: 2, status: 'DRAFT' },
        { number: 3, status: 'DRAFT' },
      ]);
      expect((await monthState(c.companyId, 2026, 1)).isClosed).toBe(false);
      expect(await lockedUntilIso(c.companyId)).toBeNull();

      await prisma.journalEntryLine.deleteMany({ where: { entryId: bad.id } });
      await prisma.journalEntry.delete({ where: { id: bad.id } });
    });

    it('una cuenta no imputable también aborta, nombrando el borrador', async () => {
      const bad = await prisma.journalEntry.create({
        data: {
          companyId: c.companyId,
          number: 4,
          date: new Date('2026-01-21T12:00:00.000Z'),
          description: `${PREFIX}cuenta no hoja`,
          status: 'DRAFT',
          createdBy: USER,
          lines: {
            create: [
              { accountId: c.rubroId, debit: 5, credit: 0 },
              { accountId: c.ventasId, debit: 0, credit: 5 },
            ],
          },
        },
        select: { id: true },
      });
      await prisma.accountingSettings.update({
        where: { companyId: c.companyId },
        data: { lastEntryNumber: 4 },
      });

      expect(await close(2026, 1, true)).toEqual({
        success: false,
        error:
          'No se cerró 01/2026: el borrador N° 4 no se puede registrar. ' +
          'La cuenta T760-RUBRO no es imputable (tiene subcuentas). ' +
          'Si es un asiento manual que ya no sirve, podés eliminarlo desde Asientos.',
      });
      expect(
        await prisma.journalEntry.count({ where: { companyId: c.companyId, status: 'POSTED' } })
      ).toBe(0);

      await prisma.journalEntryLine.deleteMany({ where: { entryId: bad.id } });
      await prisma.journalEntry.delete({ where: { id: bad.id } });
    });

    it('con postDrafts registra todos y cierra en la misma transacción', async () => {
      const result = await close(2026, 1, true);

      expect(result).toEqual({ success: true, lockedUntil: '2026-01-31', postedDrafts: 2 });
      const entries = await prisma.journalEntry.findMany({
        where: { companyId: c.companyId },
        orderBy: { number: 'asc' },
        select: {
          number: true,
          status: true,
          postDate: true,
          period: { select: { year: true, month: true } },
        },
      });
      expect(entries.map((e) => [e.number, e.status, e.period?.month])).toEqual([
        [1, 'POSTED', 1],
        [2, 'POSTED', 1],
      ]);
      expect(entries.every((e) => e.postDate instanceof Date)).toBe(true);
      expect((await monthState(c.companyId, 2026, 1)).isClosed).toBe(true);
    });

    it('lista hasta 5 números y agrega "…"', async () => {
      for (let i = 0; i < 6; i++) {
        expect((await draft(c, new Date(`2026-02-0${i + 1}T12:00:00.000Z`))).success).toBe(true);
      }
      expect(await close(2026, 2)).toEqual({
        success: false,
        error:
          'El mes 02/2026 tiene 6 borradores sin registrar (N° 5, 6, 7, 8, 9, …). ' +
          'Registralos o elegí "Registrar los 6 borradores y cerrar".',
      });
    });
  });

  describe('piso del ejercicio cerrado (B5)', () => {
    let c: TestCompany;
    beforeAll(async () => {
      c = await setupCompany('Piso');
      // FY 1 (2026) y FY 2 (2027) con el núcleo; FY 1 cerrado como lo deja el cierre anual,
      // pero con diciembre desincronizado (abierto) para probar que el FY manda.
      await prisma.$transaction((tx) =>
        assertPeriodOpen(tx, c.companyId, new Date('2027-03-10T12:00:00.000Z'))
      );
      const fy1 = await prisma.fiscalYear.findFirstOrThrow({
        where: { companyId: c.companyId, number: 1 },
      });
      await prisma.fiscalYear.update({
        where: { id: fy1.id },
        data: { isClosed: true, closedAt: new Date() },
      });
      await prisma.accountingPeriod.updateMany({
        where: { fiscalYearId: fy1.id, NOT: { type: 'MONTHLY', month: 12 } },
        data: { isClosed: true },
      });
    });
    beforeEach(() => asCompany(c));

    it('el estado muestra solo el ejercicio abierto y el piso', async () => {
      const status = await getPeriodLockStatus();

      expect(status?.fiscalYears.map((f) => f.number)).toEqual([2]);
      expect(status?.lastClosedFiscalYear).toEqual({ number: 1, endDay: '2026-12-31' });
      expect(status!.fiscalYears[0]!.months[0]).toMatchObject({
        year: 2027,
        month: 1,
        action: 'close',
      });
    });

    it('un mes del ejercicio cerrado no se cierra ni se reabre', async () => {
      expect(await close(2026, 12)).toEqual({
        success: false,
        error: 'Solo se puede cerrar el primer mes abierto: 01/2027.',
      });
      expect(await reopen(2026, 12)).toEqual({
        success: false,
        error: 'No se puede reabrir 12/2026: pertenece al ejercicio N° 1, que está cerrado.',
      });
    });

    it('reabrir el primer mes del ejercicio nuevo deja lockedUntilDate en el fin del cerrado', async () => {
      expect(await close(2027, 1)).toEqual({
        success: true,
        lockedUntil: '2027-01-31',
        postedDrafts: 0,
      });
      expect(await reopen(2027, 1)).toEqual({ success: true, lockedUntil: '2026-12-31' });
      expect(await lockedUntilIso(c.companyId)).toBe('2026-12-31T23:59:59.999Z');

      expect(await reopen(2027, 1)).toEqual({
        success: false,
        error: 'No hay meses cerrados para reabrir.',
      });
      expect(await reopen(2026, 11)).toEqual({
        success: false,
        error: 'No se puede reabrir 11/2026: pertenece al ejercicio N° 1, que está cerrado.',
      });
      const fy1 = await prisma.fiscalYear.findFirstOrThrow({
        where: { companyId: c.companyId, number: 1 },
        select: { isClosed: true },
      });
      expect(fy1.isClosed).toBe(true);
    });
  });

  // B22: las acciones reciben { year, month } y todo se calcula por mes UTC.
  const ORIGINAL_TZ = process.env.TZ;
  for (const tz of ['UTC', 'America/Argentina/Buenos_Aires']) {
    describe(`diciembre con TZ=${tz} (B22)`, () => {
      let c: TestCompany;
      beforeAll(async () => {
        process.env.TZ = tz;
        c = await setupCompany(`TZ-${tz}`);
      });
      afterAll(() => {
        if (ORIGINAL_TZ === undefined) delete process.env.TZ;
        else process.env.TZ = ORIGINAL_TZ;
      });
      beforeEach(() => asCompany(c));

      it('la zona horaria del proceso es la pedida', () => {
        expect(new Date('2026-12-01T01:00:00.000Z').getDate()).toBe(tz === 'UTC' ? 1 : 30);
      });

      it('un borrador del 01/12 01:00Z cuenta en diciembre y el cierre deja el fin UTC de diciembre', async () => {
        await closeUntil(11);
        expect((await draft(c, new Date('2026-12-01T01:00:00.000Z'))).success).toBe(true);

        const months = (await getPeriodLockStatus())!.fiscalYears[0]!.months;
        expect(months[10]).toMatchObject({
          month: 11,
          isClosed: true,
          draftCount: 0,
          action: 'reopen',
        });
        expect(months[11]).toMatchObject({
          month: 12,
          isClosed: false,
          draftCount: 1,
          action: 'close',
        });

        expect(await close(2026, 12, true)).toEqual({
          success: true,
          lockedUntil: '2026-12-31',
          postedDrafts: 1,
        });
        expect(await lockedUntilIso(c.companyId)).toBe('2026-12-31T23:59:59.999Z');

        const late = await draft(c, new Date('2026-12-31T23:30:00.000Z'));
        expect(late).toMatchObject({
          success: false,
          error: expect.stringContaining('(mes 12/2026 cerrado)'),
        });
      });
    });
  }
});
