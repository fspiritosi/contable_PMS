/**
 * Tests de integración de los asientos recurrentes (TSK-760, Fase 7) contra la base
 * real (`contable-pms-db`).
 *
 * Código real: las Server Actions `generateRecurringEntry` y
 * `generateAllPendingRecurringEntries`, que crean el asiento con el núcleo
 * (`createJournalEntryTx`: período, `fiscalYearId`/`periodId`, número atómico) y
 * devuelven `ActionResult` con el texto legible.
 *
 * Cada escenario que toca el contador usa su propia empresa (prefijo `TSK760-REC-`).
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

import { cleanupAccountingCompany } from '../../shared/test-utils/cleanup-accounting-company';
import {
  closeMonthForTest,
  readEntryPeriod,
  readLastEntryNumber,
} from '../../shared/test-utils/period-test-helpers';
import { generateAllPendingRecurringEntries, generateRecurringEntry } from './actions.server';

const PREFIX = 'TSK760-REC-';
const USER = 'test-user';
const FEB_10 = new Date('2026-02-10T00:00:00.000Z');
const MAR_10 = new Date('2026-03-10T00:00:00.000Z');
const FEB_CLOSED_MSG =
  'No se puede registrar con fecha 10/02/2026: el período está cerrado (mes 02/2026 cerrado). ' +
  'Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

interface TestCompany {
  companyId: string;
  alquilerId: string;
  cajaId: string;
}

describe.skipIf(!dbAvailable)('asientos recurrentes respetan el período cerrado (TSK-760, Fase 7)', () => {
  const companyIds: string[] = [];
  let other: TestCompany;

  async function setupCompany(name: string): Promise<TestCompany> {
    const { id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX}${name}`, isActive: true },
      select: { id: true },
    });
    companyIds.push(companyId);
    const [alquiler, caja] = await Promise.all([
      prisma.account.create({
        data: { companyId, code: 'T760-ALQ', name: `${PREFIX}Alquileres`, type: 'EXPENSE', nature: 'DEBIT' },
        select: { id: true },
      }),
      prisma.account.create({
        data: { companyId, code: 'T760-CAJA', name: `${PREFIX}Caja`, type: 'ASSET', nature: 'DEBIT' },
        select: { id: true },
      }),
    ]);
    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01T03:00:00.000Z'),
        fiscalYearEnd: new Date('2026-12-31T03:00:00.000Z'),
      },
    });
    return { companyId, alquilerId: alquiler.id, cajaId: caja.id };
  }

  const createTemplate = (c: TestCompany, name: string, nextDueDate: Date) =>
    prisma.recurringEntry.create({
      data: {
        companyId: c.companyId,
        name: `${PREFIX}${name}`,
        description: `${PREFIX}${name}`,
        frequency: 'MONTHLY',
        startDate: nextDueDate,
        nextDueDate,
        createdBy: USER,
        lines: {
          create: [
            { accountId: c.alquilerId, debit: 500, credit: 0, description: 'Alquiler' },
            { accountId: c.cajaId, debit: 0, credit: 500 },
          ],
        },
      },
      select: { id: true },
    });

  const readTemplate = (id: string) =>
    prisma.recurringEntry.findUniqueOrThrow({
      where: { id },
      select: { nextDueDate: true, lastGenerated: true },
    });

  const asCompany = (c: TestCompany) => vi.mocked(getActiveCompanyId).mockResolvedValue(c.companyId);

  beforeAll(async () => {
    other = await setupCompany('Otra');
  });

  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(USER);
  });

  afterAll(async () => {
    for (const companyId of companyIds) {
      await cleanupAccountingCompany(companyId);
      await prisma.recurringEntry.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    const [companies, entries, fys] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.recurringEntry.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.fiscalYear.count({ where: { companyId: { in: companyIds } } }),
    ]);
    expect(companies).toBe(0);
    expect(entries).toBe(0);
    expect(fys).toBe(0);
  });

  describe('generateRecurringEntry', () => {
    it('mes abierto → DRAFT con número, ejercicio y período del vencimiento; avanza la plantilla', async () => {
      const c = await setupCompany('Abierto');
      asCompany(c);
      const template = await createTemplate(c, 'Alquiler', MAR_10);

      const result = await generateRecurringEntry(template.id);

      expect(result).toEqual({ success: true, id: expect.any(String), number: 1 });
      if (!result.success) return;
      const entry = await readEntryPeriod(result.id);
      expect(entry).toMatchObject({
        number: 1,
        status: 'DRAFT',
        createdBy: USER,
        period: { type: 'MONTHLY', year: 2026, month: 3 },
      });
      expect(entry.fiscalYearId).toBe(entry.period?.fiscalYearId);
      const row = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: result.id },
        select: { date: true, description: true },
      });
      expect(row).toEqual({ date: MAR_10, description: `${PREFIX}Alquiler - 03/2026` });
      expect(await readLastEntryNumber(c.companyId)).toBe(1);
      expect(await readTemplate(template.id)).toEqual({
        lastGenerated: MAR_10,
        nextDueDate: new Date('2026-04-10T00:00:00.000Z'),
      });
    });

    it('mes cerrado → error legible sin consumir número ni avanzar la plantilla', async () => {
      const c = await setupCompany('Cerrado');
      asCompany(c);
      const template = await createTemplate(c, 'Alquiler', FEB_10);
      const reopen = await closeMonthForTest(c.companyId, FEB_10);

      const result = await generateRecurringEntry(template.id);

      expect(result).toEqual({ success: false, error: FEB_CLOSED_MSG });
      expect(await readLastEntryNumber(c.companyId)).toBe(0);
      expect(await prisma.journalEntry.count({ where: { companyId: c.companyId } })).toBe(0);
      expect(await readTemplate(template.id)).toEqual({ lastGenerated: null, nextDueDate: FEB_10 });

      await reopen();
      const retry = await generateRecurringEntry(template.id);
      expect(retry).toMatchObject({ success: true, number: 1 });
    });

    it('fin de mes: el vencimiento siguiente se calcula en UTC (31/01 → 28/02)', async () => {
      const c = await setupCompany('Fin de mes');
      asCompany(c);
      const jan31 = new Date('2026-01-31T00:00:00.000Z');
      const template = await createTemplate(c, 'Fin de mes', jan31);

      const result = await generateRecurringEntry(template.id);

      expect(result.success).toBe(true);
      const row = result.success
        ? await prisma.journalEntry.findUniqueOrThrow({ where: { id: result.id }, select: { description: true } })
        : null;
      expect(row?.description).toBe(`${PREFIX}Fin de mes - 01/2026`);
      expect((await readTemplate(template.id)).nextDueDate).toEqual(new Date('2026-02-28T00:00:00.000Z'));
    });

    it('dos generaciones en paralelo → números consecutivos sin choque (numeración atómica)', async () => {
      const c = await setupCompany('Paralelo');
      asCompany(c);
      const [a, b] = await Promise.all([
        createTemplate(c, 'Paralelo A', MAR_10),
        createTemplate(c, 'Paralelo B', MAR_10),
      ]);

      const results = await Promise.all([generateRecurringEntry(a.id), generateRecurringEntry(b.id)]);

      const numbers = results.map((r) => (r.success ? r.number : null)).sort();
      expect(numbers).toEqual([1, 2]);
      expect(await readLastEntryNumber(c.companyId)).toBe(2);
    });

    it('plantilla de otra empresa → "Asiento recurrente no encontrado"', async () => {
      const c = await setupCompany('Ajena');
      const template = await createTemplate(other, 'De otra', MAR_10);
      asCompany(c);

      const result = await generateRecurringEntry(template.id);

      expect(result).toEqual({ success: false, error: 'Asiento recurrente no encontrado' });
      expect(await readTemplate(template.id)).toEqual({ lastGenerated: null, nextDueDate: MAR_10 });
    });
  });

  describe('generateAllPendingRecurringEntries', () => {
    it('con un mes cerrado: genera las demás y lista la cerrada en errors[] con el mes; queda pendiente', async () => {
      const c = await setupCompany('Masiva');
      asCompany(c);
      const closed = await createTemplate(c, 'Febrero', FEB_10);
      const open = await createTemplate(c, 'Marzo', MAR_10);
      await closeMonthForTest(c.companyId, FEB_10);

      const result = await generateAllPendingRecurringEntries();

      expect(result).toEqual({
        success: true,
        generated: 1,
        errors: [`${PREFIX}Febrero: ${FEB_CLOSED_MSG}`],
      });
      expect(await readTemplate(closed.id)).toEqual({ lastGenerated: null, nextDueDate: FEB_10 });
      expect((await readTemplate(open.id)).lastGenerated).toEqual(MAR_10);
      const entries = await prisma.journalEntry.findMany({
        where: { companyId: c.companyId },
        select: { number: true, period: { select: { month: true } } },
      });
      expect(entries).toEqual([{ number: 1, period: { month: 3 } }]);
      expect(await readLastEntryNumber(c.companyId)).toBe(1);
    });

    it('"hoy" es el día de Argentina: vence hoy aunque sea a mediodía, y mañana no vence a las 22:40 AR', async () => {
      const c = await setupCompany('Hoy AR');
      asCompany(c);
      // Mediodía local (como guarda el formulario) del 06/10 y 00:00Z del 07/10.
      const today = await createTemplate(c, 'Hoy', new Date('2026-10-06T15:00:00.000Z'));
      const tomorrow = await createTemplate(c, 'Mañana', new Date('2026-10-07T00:00:00.000Z'));
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        // 10:00 AR del 06/10: la de hoy ya vence (antes esperaba al mediodía).
        vi.setSystemTime(new Date('2026-10-06T13:00:00.000Z'));
        expect(await generateAllPendingRecurringEntries()).toEqual({ success: true, generated: 1, errors: [] });
        expect((await readTemplate(today.id)).lastGenerated).toEqual(new Date('2026-10-06T15:00:00.000Z'));

        // 22:40 AR del 06/10 = 01:40Z del 07/10: la de mañana todavía no vence.
        vi.setSystemTime(new Date('2026-10-07T01:40:00.000Z'));
        expect(await generateAllPendingRecurringEntries()).toEqual({ success: true, generated: 0, errors: [] });
        expect((await readTemplate(tomorrow.id)).lastGenerated).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
