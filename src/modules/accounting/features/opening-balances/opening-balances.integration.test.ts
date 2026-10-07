/**
 * Tests de integración del asiento de saldos de apertura (TSK-760, Fase 7) contra
 * la base real (`contable-pms-db`).
 *
 * Código real: `saveOpeningBalanceEntry` y `getOpeningBalancesPageData`.
 * - El asiento nace POSTED en el período OPENING del ejercicio abierto más antiguo,
 *   con número atómico (`createJournalEntryTx`).
 * - B25/C2: "editar" = revertir el vigente (`reverseJournalEntryTx`, misma fecha y
 *   período OPENING) + crear uno nuevo. Antes borraba líneas de un POSTED y el
 *   trigger lo rechazaba siempre.
 * - H3: el vigente se busca por ejercicio (y, para los cargados antes de TSK-760, sin
 *   ejercicio, por día UTC del inicio): no se duplica aunque las fechas difieran en hora.
 *
 * Cada escenario usa su propia empresa (prefijo `TSK760-OB-`).
 */
import 'dotenv/config';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/utils')>()),
  revalidateAccountingRoutes: vi.fn(),
}));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

import { cleanupAccountingCompany } from '../../shared/test-utils/cleanup-accounting-company';
import { readLastEntryNumber } from '../../shared/test-utils/period-test-helpers';
import { assertPeriodOpen } from '../../shared/utils/period-lock';
import { getOpeningBalancesPageData, saveOpeningBalanceEntry } from './actions.server';

const PREFIX = 'TSK760-OB-';
const USER = 'test-user';
const DESCRIPTION = 'Asiento de Apertura';
const JAN_1 = new Date('2026-01-01T00:00:00.000Z');

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
  proveedoresId: string;
}

describe.skipIf(!dbAvailable)('saldos de apertura (TSK-760, Fase 7, B25)', () => {
  const companyIds: string[] = [];

  async function setupCompany(name: string, withSettings = true): Promise<TestCompany> {
    const { id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX}${name}`, isActive: true },
      select: { id: true },
    });
    companyIds.push(companyId);
    const [caja, proveedores] = await Promise.all([
      prisma.account.create({
        data: { companyId, code: 'T760-CAJA', name: `${PREFIX}Caja`, type: 'ASSET', nature: 'DEBIT' },
        select: { id: true },
      }),
      prisma.account.create({
        data: { companyId, code: 'T760-PROV', name: `${PREFIX}Proveedores`, type: 'LIABILITY', nature: 'CREDIT' },
        select: { id: true },
      }),
    ]);
    if (withSettings) {
      // Ajustes guardados por el formulario viejo: medianoche AR (03:00 UTC).
      await prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01T03:00:00.000Z'),
          fiscalYearEnd: new Date('2026-12-31T03:00:00.000Z'),
        },
      });
    }
    return { companyId, cajaId: caja.id, proveedoresId: proveedores.id };
  }

  const balances = (c: TestCompany, caja: number, proveedores: number) => ({
    balances: [
      { accountId: c.cajaId, debit: caja, credit: 0 },
      { accountId: c.proveedoresId, debit: 0, credit: proveedores },
    ],
  });

  const readEntry = (id: string) =>
    prisma.journalEntry.findUniqueOrThrow({
      where: { id },
      select: {
        number: true,
        status: true,
        date: true,
        description: true,
        createdBy: true,
        originalEntryId: true,
        reversalEntryId: true,
        fiscalYear: { select: { number: true } },
        period: { select: { type: true } },
        lines: { select: { accountId: true, debit: true, credit: true } },
      },
    });

  const amounts = (lines: { accountId: string; debit: unknown; credit: unknown }[], accountId: string) => {
    const line = lines.find((l) => l.accountId === accountId);
    return line ? { debit: Number(line.debit), credit: Number(line.credit) } : null;
  };

  const asCompany = (c: TestCompany) => vi.mocked(getActiveCompanyId).mockResolvedValue(c.companyId);

  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(USER);
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

  it('crea el asiento POSTED en el período OPENING del ejercicio, balanceado con la cuenta Apertura', async () => {
    const c = await setupCompany('Crear');
    asCompany(c);

    const result = await saveOpeningBalanceEntry(balances(c, 1000, 400), false);

    expect(result).toEqual({ success: true, entryId: expect.any(String), entryNumber: 1 });
    if (!result.success) return;
    const entry = await readEntry(result.entryId);
    expect(entry).toMatchObject({
      number: 1,
      status: 'POSTED',
      date: JAN_1,
      description: DESCRIPTION,
      createdBy: USER,
      fiscalYear: { number: 1 },
      period: { type: 'OPENING' },
    });
    const apertura = await prisma.account.findFirstOrThrow({
      where: { companyId: c.companyId, name: 'Apertura' },
      select: { id: true },
    });
    expect(amounts(entry.lines, c.cajaId)).toEqual({ debit: 1000, credit: 0 });
    expect(amounts(entry.lines, c.proveedoresId)).toEqual({ debit: 0, credit: 400 });
    expect(amounts(entry.lines, apertura.id)).toEqual({ debit: 0, credit: 600 });
    expect(await readLastEntryNumber(c.companyId)).toBe(1);

    const page = await getOpeningBalancesPageData();
    expect(page.existingOpeningEntry?.id).toBe(result.entryId);
  });

  it('crear de nuevo sin "editar" → rechazo legible, no duplica', async () => {
    const c = await setupCompany('Duplicar');
    asCompany(c);
    await saveOpeningBalanceEntry(balances(c, 1000, 400), false);

    const result = await saveOpeningBalanceEntry(balances(c, 10, 10), false);

    expect(result).toEqual({
      success: false,
      error: 'Ya existe un asiento de apertura. Usá la opción de editar.',
    });
    expect(await prisma.journalEntry.count({ where: { companyId: c.companyId } })).toBe(1);
    expect(await readLastEntryNumber(c.companyId)).toBe(1);
  });

  it('B25: editar revierte el vigente con su misma fecha y crea uno nuevo, ambos en OPENING', async () => {
    const c = await setupCompany('Editar');
    asCompany(c);
    const first = await saveOpeningBalanceEntry(balances(c, 1000, 400), false);
    if (!first.success) throw new Error(first.error);

    const edited = await saveOpeningBalanceEntry(balances(c, 1500, 400), true);

    expect(edited).toEqual({ success: true, entryId: expect.any(String), entryNumber: 3 });
    if (!edited.success) return;

    const original = await readEntry(first.entryId);
    expect(original.status).toBe('REVERSED');
    const reversal = await readEntry(original.reversalEntryId ?? '');
    expect(reversal).toMatchObject({
      number: 2,
      status: 'POSTED',
      date: JAN_1,
      originalEntryId: first.entryId,
      description: `Anulación del asiento N° 1 - ${DESCRIPTION}`,
      period: { type: 'OPENING' },
    });
    expect(amounts(reversal.lines, c.cajaId)).toEqual({ debit: 0, credit: 1000 });

    const replacement = await readEntry(edited.entryId);
    expect(replacement).toMatchObject({
      status: 'POSTED',
      date: JAN_1,
      description: DESCRIPTION,
      period: { type: 'OPENING' },
    });
    expect(amounts(replacement.lines, c.cajaId)).toEqual({ debit: 1500, credit: 0 });

    // Un solo asiento de apertura vigente; la página muestra el nuevo.
    const vigentes = await prisma.journalEntry.count({
      where: { companyId: c.companyId, description: DESCRIPTION, status: 'POSTED' },
    });
    expect(vigentes).toBe(1);
    const page = await getOpeningBalancesPageData();
    expect(page.existingOpeningEntry?.id).toBe(edited.entryId);

    // Editar otra vez revierte el último (no el ya revertido).
    const again = await saveOpeningBalanceEntry(balances(c, 2000, 400), true);
    expect(again).toMatchObject({ success: true, entryNumber: 5 });
    expect((await readEntry(edited.entryId)).status).toBe('REVERSED');
    expect(await readLastEntryNumber(c.companyId)).toBe(5);
  });

  it('H3: un asiento de apertura cargado antes de TSK-760 (sin ejercicio, 03:00 UTC) se detecta y se reemplaza', async () => {
    const c = await setupCompany('Legado');
    asCompany(c);
    const legacy = await prisma.journalEntry.create({
      data: {
        companyId: c.companyId,
        number: 1,
        date: new Date('2026-01-01T03:00:00.000Z'),
        description: DESCRIPTION,
        status: 'POSTED',
        postDate: new Date(),
        createdBy: USER,
        lines: {
          create: [
            { accountId: c.cajaId, debit: 300, credit: 0 },
            { accountId: c.proveedoresId, debit: 0, credit: 300 },
          ],
        },
      },
      select: { id: true },
    });
    await prisma.accountingSettings.update({ where: { companyId: c.companyId }, data: { lastEntryNumber: 1 } });

    const page = await getOpeningBalancesPageData();
    expect(page.existingOpeningEntry?.id).toBe(legacy.id);

    const duplicate = await saveOpeningBalanceEntry(balances(c, 10, 10), false);
    expect(duplicate).toEqual({
      success: false,
      error: 'Ya existe un asiento de apertura. Usá la opción de editar.',
    });

    const edited = await saveOpeningBalanceEntry(balances(c, 800, 300), true);
    expect(edited).toMatchObject({ success: true, entryNumber: 3 });
    const original = await readEntry(legacy.id);
    expect(original.status).toBe('REVERSED');
    expect((await readEntry(original.reversalEntryId ?? '')).number).toBe(2);
  });

  it('período de apertura cerrado → error legible sin consumir número', async () => {
    const c = await setupCompany('Apertura cerrada');
    asCompany(c);
    // Crea el FY 1 y sus períodos con el núcleo; después se cierra su OPENING (C7).
    await prisma.$transaction((tx) => assertPeriodOpen(tx, c.companyId, JAN_1, { periodType: 'OPENING' }));
    await prisma.accountingPeriod.updateMany({
      where: { fiscalYear: { companyId: c.companyId }, type: 'OPENING' },
      data: { isClosed: true },
    });

    const result = await saveOpeningBalanceEntry(balances(c, 1000, 400), false);

    expect(result).toEqual({
      success: false,
      error:
        'No se puede registrar con fecha 01/01/2026: el período está cerrado (apertura del ejercicio N° 1 cerrada).',
    });
    expect(await readLastEntryNumber(c.companyId)).toBe(0);
  });

  it('editar sin asiento vigente → rechazo legible', async () => {
    const c = await setupCompany('Editar sin vigente');
    asCompany(c);

    const result = await saveOpeningBalanceEntry(balances(c, 1000, 400), true);

    expect(result).toEqual({ success: false, error: 'No se encontró el asiento de apertura existente' });
    expect(await readLastEntryNumber(c.companyId)).toBe(0);
  });

  it('empresa sin Ajustes → rechazo legible', async () => {
    const c = await setupCompany('Sin ajustes', false);
    asCompany(c);

    const result = await saveOpeningBalanceEntry(balances(c, 1000, 400), false);

    expect(result).toEqual({ success: false, error: 'La empresa no tiene configuración contable' });
  });
});
