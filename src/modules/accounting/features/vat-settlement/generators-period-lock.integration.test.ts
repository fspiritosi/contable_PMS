/**
 * Test mínimo de los generadores contables sin UI (TSK-760, Fase 7, R1) contra la
 * base real (`contable-pms-db`): liquidación de IVA, diferencia de cambio y ajuste
 * por inflación.
 *
 * Código real: `generateVatSettlementEntry`, `generateExchangeDifferenceEntry` y
 * `generateInflationAdjustmentEntry`, que crean el asiento con el núcleo
 * (`createJournalEntryTx`). Por cada uno: mes cerrado → error legible sin consumir
 * número; mes abierto → asiento POSTED con `fiscalYearId`/`periodId` y número atómico.
 *
 * Cada generador usa su propia empresa (prefijo `TSK760-GEN-`).
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

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

import { generateExchangeDifferenceEntry } from '../exchange-rates/actions.server';
import { generateInflationAdjustmentEntry } from '../inflation-adjustment/actions.server';
import { cleanupAccountingCompany } from '../../shared/test-utils/cleanup-accounting-company';
import {
  closeMonthForTest,
  readEntryPeriod,
  readLastEntryNumber,
} from '../../shared/test-utils/period-test-helpers';
import { createJournalEntryTx } from '../../shared/utils/journal-entry-tx';
import type { JournalEntryLineDraft } from '../../shared/utils/journal-entry-lines';
import { generateVatSettlementEntry } from './actions.server';

const PREFIX = 'TSK760-GEN-';
const USER = 'test-user';
const FEB_10 = new Date('2026-02-10T00:00:00.000Z');
const MAR_10 = new Date('2026-03-10T00:00:00.000Z');
const MAR_31 = new Date('2026-03-31T00:00:00.000Z');
const MAR_END_UTC = new Date('2026-03-31T23:59:59.999Z');
const MARCH_CLOSED_MSG =
  'No se puede registrar con fecha 31/03/2026: el período está cerrado (mes 03/2026 cerrado). ' +
  'Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type AccountSeed = { code: string; type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'; extra?: object };

describe.skipIf(!dbAvailable)('IVA, diferencia de cambio e inflación respetan el período cerrado (TSK-760, Fase 7)', () => {
  const companyIds: string[] = [];

  async function setupCompany(name: string, accounts: Record<string, AccountSeed>) {
    const { id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX}${name}`, isActive: true },
      select: { id: true },
    });
    companyIds.push(companyId);
    const ids: Record<string, string> = {};
    for (const [key, seed] of Object.entries(accounts)) {
      const nature = seed.type === 'ASSET' || seed.type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
      const account = await prisma.account.create({
        data: { companyId, code: seed.code, name: `${PREFIX}${key}`, type: seed.type, nature, ...seed.extra },
        select: { id: true },
      });
      ids[key] = account.id;
    }
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    return { companyId, ids };
  }

  /** Asiento POSTED sembrado con el núcleo (los generadores leen solo POSTED). */
  const seedPosted = (companyId: string, date: Date, lines: JournalEntryLineDraft[]) =>
    prisma.$transaction((tx) =>
      createJournalEntryTx(tx, {
        companyId,
        date,
        description: `${PREFIX}sembrado`,
        lines,
        status: 'POSTED',
        createdBy: USER,
      })
    );

  /** Verifica el rechazo en marzo cerrado y devuelve el contador previo (marzo reabierto). */
  async function expectRejectedInClosedMarch(companyId: string, run: () => Promise<unknown>) {
    const before = await readLastEntryNumber(companyId);
    const reopen = await closeMonthForTest(companyId, MAR_10);
    const result = await run();
    expect(result).toEqual({ success: false, error: MARCH_CLOSED_MSG });
    expect(await readLastEntryNumber(companyId)).toBe(before);
    await reopen();
    return before;
  }

  async function expectPostedInMarch(entryId: string, number: number, createdBy: string) {
    const entry = await readEntryPeriod(entryId);
    expect(entry).toMatchObject({
      number,
      status: 'POSTED',
      createdBy,
      period: { type: 'MONTHLY', year: 2026, month: 3 },
    });
    expect(entry.fiscalYearId).toBe(entry.period?.fiscalYearId);
  }

  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(USER);
  });

  afterAll(async () => {
    for (const companyId of companyIds) {
      await cleanupAccountingCompany(companyId);
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.exchangeRate.deleteMany({ where: { companyId } });
      await prisma.inflationIndex.deleteMany({ where: { companyId } });
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

  const settingsData = (companyId: string, extra: object) => ({
    companyId,
    fiscalYearStart: new Date('2026-01-01T03:00:00.000Z'),
    fiscalYearEnd: new Date('2026-12-31T03:00:00.000Z'),
    ...extra,
  });

  it('liquidación de IVA: marzo cerrado → rechazo; abierto → POSTED al 31/03 (UTC) en el período de marzo', async () => {
    const { companyId, ids } = await setupCompany('IVA', {
      caja: { code: 'T760-CAJA', type: 'ASSET' },
      ventas: { code: 'T760-VEN', type: 'REVENUE' },
      gastos: { code: 'T760-GAS', type: 'EXPENSE' },
      ivaDf: { code: 'T760-IVADF', type: 'LIABILITY' },
      ivaCf: { code: 'T760-IVACF', type: 'ASSET' },
      ivaPagar: { code: 'T760-IVAPAG', type: 'LIABILITY' },
    });
    await prisma.accountingSettings.create({
      data: settingsData(companyId, {
        vatDebitAccountId: ids.ivaDf,
        vatCreditAccountId: ids.ivaCf,
        vatPayableAccountId: ids.ivaPagar,
      }),
    });
    await seedPosted(companyId, MAR_10, [
      { accountId: ids.caja!, debit: 121, credit: 0 },
      { accountId: ids.ventas!, debit: 0, credit: 100 },
      { accountId: ids.ivaDf!, debit: 0, credit: 21 },
    ]);
    await seedPosted(companyId, MAR_10, [
      { accountId: ids.gastos!, debit: 100, credit: 0 },
      { accountId: ids.ivaCf!, debit: 10.5, credit: 0 },
      { accountId: ids.caja!, debit: 0, credit: 110.5 },
    ]);

    const before = await expectRejectedInClosedMarch(companyId, () => generateVatSettlementEntry(2026, 3));

    const result = await generateVatSettlementEntry(2026, 3);
    expect(result).toMatchObject({ success: true, number: before + 1, preview: { balance: 10.5 } });
    if (!result.success) return;
    await expectPostedInMarch(result.id, before + 1, 'system');
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: result.id },
      select: { date: true, lines: { select: { accountId: true, debit: true, credit: true } } },
    });
    expect(entry.date).toEqual(MAR_END_UTC);
    const byAccount = Object.fromEntries(
      entry.lines.map((l) => [l.accountId, [Number(l.debit), Number(l.credit)]])
    );
    expect(byAccount).toEqual({
      [ids.ivaDf!]: [21, 0],
      [ids.ivaCf!]: [0, 10.5],
      [ids.ivaPagar!]: [0, 10.5],
    });
  });

  it('diferencia de cambio: marzo cerrado → rechazo; abierto → POSTED con ejercicio y período (antes sin)', async () => {
    const { companyId, ids } = await setupCompany('Cambio', {
      bancoUsd: { code: 'T760-USD', type: 'ASSET', extra: { currency: 'USD' } },
      capital: { code: 'T760-CAP', type: 'EQUITY' },
      difCambio: { code: 'T760-DIF', type: 'REVENUE', extra: { name: `${PREFIX}Diferencia de cambio` } },
      resultado: { code: 'T760-RES', type: 'EQUITY' },
    });
    await prisma.accountingSettings.create({ data: settingsData(companyId, { resultAccountId: ids.resultado }) });
    await seedPosted(companyId, FEB_10, [
      { accountId: ids.bancoUsd!, debit: 100000, credit: 0, currency: 'USD', originalAmount: 100, exchangeRate: 1000 },
      { accountId: ids.capital!, debit: 0, credit: 100000 },
    ]);
    await prisma.exchangeRate.create({
      data: { companyId, currency: 'USD', date: MAR_31, buyRate: 1090, sellRate: 1100, source: 'MANUAL' },
    });

    const before = await expectRejectedInClosedMarch(companyId, () => generateExchangeDifferenceEntry(MAR_31));

    const result = await generateExchangeDifferenceEntry(MAR_31);
    expect(result).toMatchObject({ success: true, number: before + 1 });
    if (!result.success) return;
    await expectPostedInMarch(result.id, before + 1, USER);
    const lines = await prisma.journalEntryLine.findMany({
      where: { entryId: result.id },
      select: { accountId: true, debit: true, credit: true },
    });
    const byAccount = Object.fromEntries(lines.map((l) => [l.accountId, [Number(l.debit), Number(l.credit)]]));
    expect(byAccount).toEqual({ [ids.bancoUsd!]: [10000, 0], [ids.difCambio!]: [0, 10000] });
  });

  it('ajuste por inflación: marzo cerrado → rechazo; abierto → POSTED al 31/03 (UTC) en el período de marzo', async () => {
    const { companyId, ids } = await setupCompany('Inflación', {
      rodados: { code: 'T760-ROD', type: 'ASSET', extra: { adjustableByInflation: true } },
      capital: { code: 'T760-CAP', type: 'EQUITY' },
      recpam: { code: 'T760-RECPAM', type: 'REVENUE' },
    });
    await prisma.accountingSettings.create({ data: settingsData(companyId, { recpamAccountId: ids.recpam }) });
    await prisma.inflationIndex.createMany({
      data: [
        { companyId, year: 2026, month: 2, index: 100 },
        { companyId, year: 2026, month: 3, index: 110 },
      ],
    });
    await seedPosted(companyId, FEB_10, [
      { accountId: ids.rodados!, debit: 1000, credit: 0 },
      { accountId: ids.capital!, debit: 0, credit: 1000 },
    ]);

    const before = await expectRejectedInClosedMarch(companyId, () => generateInflationAdjustmentEntry(2026, 3));

    const result = await generateInflationAdjustmentEntry(2026, 3);
    expect(result).toMatchObject({ success: true, number: before + 1 });
    if (!result.success) return;
    await expectPostedInMarch(result.id, before + 1, 'system');
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: result.id },
      select: { date: true, lines: { select: { accountId: true, debit: true, credit: true } } },
    });
    expect(entry.date).toEqual(MAR_END_UTC);
    const byAccount = Object.fromEntries(
      entry.lines.map((l) => [l.accountId, [Number(l.debit), Number(l.credit)]])
    );
    expect(byAccount).toEqual({ [ids.rodados!]: [100, 0], [ids.recpam!]: [0, 100] });
  });
});
