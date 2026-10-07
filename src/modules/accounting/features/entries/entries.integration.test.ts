/**
 * Tests de integración del asiento manual y del "Registrar" (TSK-760, Fase 4)
 * contra la base real (`contable-pms-db`).
 *
 * Código real: las Server Actions `createJournalEntry` y `postJournalEntry`, que
 * pasan por el núcleo (`createJournalEntryTx` / `postJournalEntryTx`) y devuelven
 * `ActionResult` con el texto legible (en producción Next redacta los `throw`).
 *
 * Cada escenario usa empresas propias (prefijo `TSK760-EN-`). `afterAll` limpia con
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
// `revalidateAccountingRoutes` hace `require('next/cache')` (no lo intercepta vi.mock) y
// fuera de un request Next lanza "static generation store missing".
vi.mock('../../shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/utils')>()),
  revalidateAccountingRoutes: vi.fn(),
}));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

import { cleanupAccountingCompany } from '../../shared/test-utils/cleanup-accounting-company';
import type { CreateJournalEntryInput } from '../../shared/types';
import { createJournalEntry, postJournalEntry } from './actions.server';

const PREFIX = 'TSK760-EN-';
const USER = 'test-user';
const MARCH_10 = new Date('2026-03-10T00:00:00.000Z');
const MARCH_CLOSED_MSG =
  'No se puede registrar con fecha 10/03/2026: el período está cerrado (mes 03/2026 cerrado). ' +
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
  cajaId: string;
  ventasId: string;
  gastosCcId: string;
  rubroId: string;
}

describe.skipIf(!dbAvailable)('asiento manual y registrar (TSK-760, Fase 4)', () => {
  const companyIds: string[] = [];
  let main: TestCompany;
  let other: TestCompany;
  let costCenterId: string;

  async function setupCompany(name: string): Promise<TestCompany> {
    const { id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX}${name}`, isActive: true },
      select: { id: true },
    });
    companyIds.push(companyId);
    const account = (code: string, label: string, extra: object = {}) =>
      prisma.account.create({
        data: { companyId, code, name: `${PREFIX}${label}`, type: 'ASSET', nature: 'DEBIT', ...extra },
        select: { id: true },
      });
    const [caja, ventas, gastosCc, rubro] = await Promise.all([
      account('T760-CAJA', 'Caja'),
      account('T760-VENTAS', 'Ventas', { type: 'REVENUE', nature: 'CREDIT' }),
      account('T760-GASTOS', 'Gastos con centro', { type: 'EXPENSE', requiresAuxiliary: 'COST_CENTER' }),
      account('T760-RUBRO', 'Rubro', { isLeaf: false }),
    ]);
    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01T03:00:00.000Z'),
        fiscalYearEnd: new Date('2026-12-31T03:00:00.000Z'),
      },
    });
    return { companyId, cajaId: caja.id, ventasId: ventas.id, gastosCcId: gastosCc.id, rubroId: rubro.id };
  }

  const input = (c: TestCompany, overrides: Partial<CreateJournalEntryInput> = {}): CreateJournalEntryInput => ({
    date: MARCH_10,
    description: `${PREFIX}manual`,
    lines: [
      { accountId: c.cajaId, debit: '100.50', credit: '0.00' },
      { accountId: c.ventasId, debit: '0.00', credit: '100.50' },
    ],
    ...overrides,
  });

  const counter = async (companyId: string) =>
    (await prisma.accountingSettings.findUniqueOrThrow({ where: { companyId }, select: { lastEntryNumber: true } }))
      .lastEntryNumber;

  const closeMarch = (companyId: string) =>
    prisma.accountingPeriod.updateMany({
      where: { fiscalYear: { companyId }, type: 'MONTHLY', year: 2026, month: 3 },
      data: { isClosed: true },
    });

  const asCompany = (c: TestCompany) => vi.mocked(getActiveCompanyId).mockResolvedValue(c.companyId);

  beforeAll(async () => {
    main = await setupCompany('Principal');
    other = await setupCompany('Otra');
    const cc = await prisma.costCenter.create({
      data: { companyId: main.companyId, name: `${PREFIX}Logística` },
      select: { id: true },
    });
    costCenterId = cc.id;
  });

  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(USER);
    asCompany(main);
  });

  afterAll(async () => {
    for (const companyId of companyIds) {
      await cleanupAccountingCompany(companyId);
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.costCenter.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    const [companies, entries, fys] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.journalEntry.count({ where: { description: { startsWith: PREFIX } } }),
      prisma.fiscalYear.count({ where: { companyId: { in: companyIds } } }),
    ]);
    expect(companies).toBe(0);
    expect(entries).toBe(0);
    expect(fys).toBe(0);
  });

  describe('createJournalEntry', () => {
    it('crea un DRAFT con número, ejercicio y período (crea el FY 1 si falta)', async () => {
      const c = await setupCompany('Crear');
      asCompany(c);

      const result = await createJournalEntry(input(c));

      expect(result).toEqual({ success: true, id: expect.any(String), number: 1 });
      if (!result.success) return;
      const entry = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: result.id },
        select: {
          companyId: true,
          status: true,
          createdBy: true,
          fiscalYear: { select: { number: true } },
          period: { select: { type: true, year: true, month: true } },
        },
      });
      expect(entry).toEqual({
        companyId: c.companyId,
        status: 'DRAFT',
        createdBy: USER,
        fiscalYear: { number: 1 },
        period: { type: 'MONTHLY', year: 2026, month: 3 },
      });
      expect(await counter(c.companyId)).toBe(1);
    });

    it('conserva el centro de costo y la descripción de cada línea (TSK-583/719)', async () => {
      const result = await createJournalEntry(
        input(main, {
          lines: [
            { accountId: main.gastosCcId, debit: '40.00', credit: '0.00', costCenterId, description: 'línea con centro' },
            { accountId: main.cajaId, debit: '0.00', credit: '40.00' },
          ],
        })
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      const lines = await prisma.journalEntryLine.findMany({
        where: { entryId: result.id, accountId: main.gastosCcId },
        select: { costCenterId: true, description: true, debit: true },
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]?.costCenterId).toBe(costCenterId);
      expect(lines[0]?.description).toBe('línea con centro');
      expect(Number(lines[0]?.debit)).toBe(40);
    });

    it('mes cerrado → { success: false } con el texto del diseño y sin consumir número', async () => {
      const c = await setupCompany('MesCerrado');
      asCompany(c);
      expect((await createJournalEntry(input(c))).success).toBe(true);
      await closeMarch(c.companyId);

      const result = await createJournalEntry(input(c, { description: `${PREFIX}en mes cerrado` }));

      expect(result).toEqual({ success: false, error: MARCH_CLOSED_MSG });
      expect(await counter(c.companyId)).toBe(1);
      expect(await prisma.journalEntry.count({ where: { companyId: c.companyId } })).toBe(1);
    });

    it('los validadores devuelven mensajes legibles (BusinessError), no el genérico', async () => {
      const sinCentro = await createJournalEntry(
        input(main, {
          lines: [
            { accountId: main.gastosCcId, debit: '10.00', credit: '0.00' },
            { accountId: main.cajaId, debit: '0.00', credit: '10.00' },
          ],
        })
      );
      expect(sinCentro).toEqual({
        success: false,
        error: 'La cuenta T760-GASTOS requiere un centro de costo como auxiliar',
      });

      const noHoja = await createJournalEntry(
        input(main, {
          lines: [
            { accountId: main.rubroId, debit: '10.00', credit: '0.00' },
            { accountId: main.cajaId, debit: '0.00', credit: '10.00' },
          ],
        })
      );
      expect(noHoja).toEqual({
        success: false,
        error: 'Las siguientes cuentas no son imputables (tienen subcuentas): T760-RUBRO',
      });
    });

    it('valida el input en el servidor (Zod): desbalanceado → { success: false }', async () => {
      const result = await createJournalEntry(
        input(main, {
          lines: [
            { accountId: main.cajaId, debit: '10.00', credit: '0.00' },
            { accountId: main.ventasId, debit: '0.00', credit: '9.00' },
          ],
        })
      );
      expect(result).toEqual({ success: false, error: 'El asiento debe estar balanceado (Debe = Haber)' });
    });

    it('usa la empresa activa: cuentas de otra empresa → rechazo legible', async () => {
      const result = await createJournalEntry(input(other));
      expect(result).toEqual({
        success: false,
        error: 'Una o más cuentas no existen o no pertenecen a la empresa',
      });
      expect(await prisma.journalEntry.count({ where: { companyId: other.companyId } })).toBe(0);
    });
  });

  describe('postJournalEntry', () => {
    async function draft(c: TestCompany, description = `${PREFIX}borrador`) {
      asCompany(c);
      const created = await createJournalEntry(input(c, { description }));
      if (!created.success) throw new Error(created.error);
      return created;
    }

    it('registra un DRAFT: POSTED con postDate, ejercicio y período', async () => {
      const c = await setupCompany('Registrar');
      const created = await draft(c);

      const result = await postJournalEntry(created.id);

      expect(result).toEqual({ success: true, number: created.number });
      const entry = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: created.id },
        select: { status: true, postDate: true, fiscalYearId: true, periodId: true },
      });
      expect(entry.status).toBe('POSTED');
      expect(entry.postDate).not.toBeNull();
      expect(entry.fiscalYearId).not.toBeNull();
      expect(entry.periodId).not.toBeNull();
    });

    it('DRAFT en mes cerrado → texto del diseño y sigue en borrador', async () => {
      const c = await setupCompany('RegistrarMesCerrado');
      const created = await draft(c);
      await closeMarch(c.companyId);

      const result = await postJournalEntry(created.id);

      expect(result).toEqual({ success: false, error: MARCH_CLOSED_MSG });
      const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: created.id }, select: { status: true } });
      expect(entry.status).toBe('DRAFT');
    });

    it('B4: DRAFT de un ejercicio cerrado → rechazo aunque el mes figure abierto', async () => {
      const c = await setupCompany('RegistrarFyCerrado');
      const created = await draft(c);
      await prisma.fiscalYear.updateMany({ where: { companyId: c.companyId }, data: { isClosed: true } });

      const result = await postJournalEntry(created.id);

      expect(result).toEqual({
        success: false,
        error: 'No se puede registrar con fecha 10/03/2026: el período está cerrado (ejercicio N° 1 cerrado).',
      });
    });

    it('DRAFT desbalanceado (sembrado) → rechazo con el texto actual', async () => {
      const c = await setupCompany('RegistrarDesbalanceado');
      const created = await draft(c);
      // Dato viejo: un borrador desbalanceado (los DRAFT admiten UPDATE).
      await prisma.journalEntryLine.updateMany({
        where: { entryId: created.id, accountId: c.ventasId },
        data: { credit: 99.5 },
      });

      const result = await postJournalEntry(created.id);

      expect(result).toEqual({
        success: false,
        error: 'El asiento no está balanceado. Debe: $100.50, Haber: $99.50, Diferencia: $1.00',
      });
    });

    it('asiento de otra empresa → "Asiento no encontrado." (no usa el companyId del asiento)', async () => {
      const created = await draft(other, `${PREFIX}ajeno`);
      asCompany(main);

      const result = await postJournalEntry(created.id);

      expect(result).toEqual({ success: false, error: 'Asiento no encontrado.' });
      const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: created.id }, select: { status: true } });
      expect(entry.status).toBe('DRAFT');
    });

    it('registrar dos veces → "ya no está en borrador"', async () => {
      const c = await setupCompany('RegistrarDosVeces');
      const created = await draft(c);
      expect((await postJournalEntry(created.id)).success).toBe(true);

      const result = await postJournalEntry(created.id);

      expect(result).toEqual({ success: false, error: `El asiento N° ${created.number} ya no está en borrador.` });
    });
  });
});
