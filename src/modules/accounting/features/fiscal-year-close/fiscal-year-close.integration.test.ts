/**
 * Tests de integración del cierre anual (TSK-760, Fase 9: B1, B4, B18–B21, B24, C4, C7, D12)
 * contra la base real (`contable-pms-db`).
 *
 * Código real: las Server Actions `getFiscalYearStatus`, `previewFiscalYearClose` y
 * `closeFiscalYear`; los meses se cierran con `closeMonthTx` (Fase 8) y los asientos se
 * crean con `createJournalEntryTx` (núcleo). Después del cierre se leen los reportes
 * reales (Balance, Sumas y Saldos, Mayor, Estado de Resultados, presupuesto, centros de
 * costo, IVA, diferencia de cambio e inflación) para verificar que la apertura generada
 * no duplica saldos (B18) y que la refundición no anula el resultado (B19).
 *
 * Cada bloque usa su propia empresa (prefijo `TSK760-FYC-`). `afterAll` limpia con
 * `cleanupAccountingCompany` (los POSTED son inmutables por trigger).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
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
import { readLastEntryNumber } from '../../shared/test-utils/period-test-helpers';
import { calculateAccountBalance } from '../../shared/utils/balances';
import { createJournalEntryTx } from '../../shared/utils/journal-entry-tx';
import type { JournalEntryLineDraft } from '../../shared/utils/journal-entry-lines';
import { getBudgetDetail } from '../budgets/actions.server';
import { previewExchangeDifference } from '../exchange-rates/actions.server';
import { calculateRECPAM } from '../inflation-adjustment/actions.server';
import {
  getBalanceSheet,
  getBudgetVarianceReport,
  getCostCenterMovements,
  getGeneralLedger,
  getIncomeStatement,
  getTrialBalance,
} from '../reports/actions.server';
import { closeMonthTx, reopenMonthTx } from '../settings/period-closing';
import { previewVatSettlement } from '../vat-settlement/actions.server';
import { closeFiscalYear, getFiscalYearStatus, previewFiscalYearClose } from './actions.server';

const PREFIX = 'TSK760-FYC-';
const USER = 'test-user';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type AccountKey =
  | 'caja'
  | 'cajaUsd'
  | 'ivaCf'
  | 'capital'
  | 'resultado'
  | 'ventas'
  | 'gastos'
  | 'gastoViejo';

interface TestCompany {
  companyId: string;
  acc: Record<AccountKey, string>;
}

const companyIds: string[] = [];

const ACCOUNTS: Record<AccountKey, { code: string; type: string; nature: string; extra?: object }> = {
  caja: { code: '1.1.01', type: 'ASSET', nature: 'DEBIT', extra: { adjustableByInflation: true } },
  cajaUsd: { code: '1.1.02', type: 'ASSET', nature: 'DEBIT', extra: { currency: 'USD' } },
  ivaCf: { code: '1.1.03', type: 'ASSET', nature: 'DEBIT' },
  capital: { code: '3.1.01', type: 'EQUITY', nature: 'CREDIT' },
  resultado: { code: '3.2.01', type: 'EQUITY', nature: 'CREDIT' },
  ventas: { code: '4.1.01', type: 'REVENUE', nature: 'CREDIT' },
  gastos: { code: '5.1.01', type: 'EXPENSE', nature: 'DEBIT' },
  gastoViejo: { code: '5.1.02', type: 'EXPENSE', nature: 'DEBIT' },
};

async function setupCompany(name: string): Promise<TestCompany> {
  const { id: companyId } = await prisma.company.create({
    data: { name: `${PREFIX}${name}`, isActive: true },
    select: { id: true },
  });
  companyIds.push(companyId);
  const acc = {} as Record<AccountKey, string>;
  for (const [key, def] of Object.entries(ACCOUNTS) as [AccountKey, (typeof ACCOUNTS)[AccountKey]][]) {
    const { id } = await prisma.account.create({
      data: {
        companyId,
        code: `T760-${def.code}`,
        name: `${PREFIX}${key}`,
        type: def.type as 'ASSET',
        nature: def.nature as 'DEBIT',
        ...def.extra,
      },
      select: { id: true },
    });
    acc[key] = id;
  }
  // Ajustes como los guardaba el formulario viejo (03:00Z = medianoche AR).
  await prisma.accountingSettings.create({
    data: {
      companyId,
      fiscalYearStart: new Date('2026-01-01T03:00:00.000Z'),
      fiscalYearEnd: new Date('2026-12-31T03:00:00.000Z'),
      resultAccountId: acc.resultado,
      vatCreditAccountId: acc.ivaCf,
    },
  });
  vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
  return { companyId, acc };
}

const asCompany = (c: TestCompany) => vi.mocked(getActiveCompanyId).mockResolvedValue(c.companyId);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const D = (accountId: string, amount: number, extra: Partial<JournalEntryLineDraft> = {}) => ({
  accountId,
  debit: amount,
  credit: 0,
  ...extra,
});
const H = (accountId: string, amount: number) => ({ accountId, debit: 0, credit: amount });

function post(c: TestCompany, iso: string, lines: JournalEntryLineDraft[]) {
  return prisma.$transaction((tx) =>
    createJournalEntryTx(tx, {
      companyId: c.companyId,
      date: day(iso),
      description: `${PREFIX}asiento`,
      lines,
      status: 'POSTED',
      createdBy: USER,
    })
  );
}

async function closeMonths(c: TestCompany, year: number, from: number, to: number) {
  for (let month = from; month <= to; month++) {
    await prisma.$transaction((tx) =>
      closeMonthTx(tx, { companyId: c.companyId, userId: USER, year, month, postDrafts: false })
    );
  }
}

async function fiscalYearOf(companyId: string, number: number) {
  return prisma.fiscalYear.findFirstOrThrow({
    where: { companyId, number },
    select: {
      id: true,
      number: true,
      startDate: true,
      endDate: true,
      isClosed: true,
      closedBy: true,
      closingEntryId: true,
      openingEntryId: true,
      periods: { select: { type: true, year: true, month: true, isClosed: true } },
    },
  });
}

async function entryWithLines(id: string) {
  const entry = await prisma.journalEntry.findUniqueOrThrow({
    where: { id },
    select: {
      number: true,
      status: true,
      date: true,
      fiscalYearId: true,
      period: { select: { type: true, fiscalYearId: true } },
      lines: { select: { accountId: true, debit: true, credit: true } },
    },
  });
  const lines = entry.lines
    .map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) }))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  return { ...entry, lines, debit, credit };
}

const sorted = (lines: { accountId: string; debit: number; credit: number }[]) =>
  [...lines].sort((a, b) => a.accountId.localeCompare(b.accountId));

describe.skipIf(!dbAvailable)('cierre anual (TSK-760, Fase 9)', () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(USER);
    vi.mocked(checkPermission).mockClear();
  });

  afterAll(async () => {
    for (const companyId of companyIds) {
      await prisma.budget.deleteMany({ where: { companyId } });
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

  describe('validaciones previas (B1, A5/B4, B20)', () => {
    let c: TestCompany;
    let fy1Id: string;
    beforeAll(async () => {
      c = await setupCompany('Validaciones');
      await post(c, '2026-01-15', [D(c.acc.caja, 1000), H(c.acc.capital, 1000)]);
      fy1Id = (await fiscalYearOf(c.companyId, 1)).id;
    });
    beforeEach(() => asCompany(c));

    it('con meses abiertos: el estado los lista y el cierre los nombra (B1)', async () => {
      await closeMonths(c, 2026, 1, 10);

      const status = await getFiscalYearStatus();
      expect(status?.fiscalYear).toMatchObject({
        id: fy1Id,
        number: 1,
        startDay: '2026-01-01',
        endDay: '2026-12-31',
      });
      expect(status?.openMonths).toEqual(['11/2026', '12/2026']);
      expect(status?.canClose).toBe(false);

      const result = await closeFiscalYear({ fiscalYearId: fy1Id });
      expect(result).toEqual({
        success: false,
        error:
          'No se puede cerrar el ejercicio N° 1: faltan cerrar los meses 11/2026, 12/2026. ' +
          'Cerralos en orden desde Contabilidad → Configuración → Bloqueo de Períodos.',
      });
      expect(checkPermission).toHaveBeenCalledWith('accounting.fiscal-year-close', 'approve', {
        redirect: true,
      });
    });

    it('con borradores en el ejercicio: el estado y el cierre los listan por mes (A5/B4)', async () => {
      await closeMonths(c, 2026, 11, 12);
      // Borrador viejo (anterior a TSK-760) en un mes que quedó cerrado.
      await prisma.journalEntry.create({
        data: {
          companyId: c.companyId,
          number: 500,
          date: day('2026-03-10'),
          description: `${PREFIX}borrador viejo`,
          status: 'DRAFT',
          createdBy: USER,
          lines: {
            create: [
              { accountId: c.acc.caja, debit: 5, credit: 0 },
              { accountId: c.acc.ventas, debit: 0, credit: 5 },
            ],
          },
        },
      });

      const status = await getFiscalYearStatus();
      expect(status?.openMonths).toEqual([]);
      expect(status?.pendingDrafts).toEqual([{ month: '03/2026', count: 1, numbers: [500] }]);
      expect(status?.canClose).toBe(false);

      const result = await closeFiscalYear({ fiscalYearId: fy1Id });
      expect(result).toEqual({
        success: false,
        error:
          'No se puede cerrar el ejercicio N° 1: hay 1 borrador sin registrar (03/2026: N° 500). ' +
          'Reabrí esos meses y registralos antes de cerrar.',
      });

      await prisma.journalEntry.deleteMany({ where: { companyId: c.companyId, number: 500 } });
    });

    it('sin resultados registrados: vista previa y cierre rechazan sin crear nada (B20)', async () => {
      const before = await readLastEntryNumber(c.companyId);
      const expected =
        'No hay asientos registrados con resultado en el ejercicio N° 1: registrá los borradores antes de cerrar.';

      expect(await previewFiscalYearClose(fy1Id)).toEqual({ success: false, error: expected });
      expect(await closeFiscalYear({ fiscalYearId: fy1Id })).toEqual({ success: false, error: expected });

      expect(await readLastEntryNumber(c.companyId)).toBe(before);
      const fy1 = await fiscalYearOf(c.companyId, 1);
      expect(fy1.isClosed).toBe(false);
      expect(fy1.closingEntryId).toBeNull();
      expect(await prisma.fiscalYear.count({ where: { companyId: c.companyId } })).toBe(1);
    });

    it('sin cuenta de Resultado configurada: rechaza con la indicación', async () => {
      await prisma.accountingSettings.update({
        where: { companyId: c.companyId },
        data: { resultAccountId: null },
      });
      try {
        expect(await closeFiscalYear({ fiscalYearId: fy1Id })).toEqual({
          success: false,
          error:
            'Configurá la cuenta de Resultado del Ejercicio en Contabilidad → Configuración antes de cerrar.',
        });
        expect((await getFiscalYearStatus())?.canClose).toBe(false);
      } finally {
        await prisma.accountingSettings.update({
          where: { companyId: c.companyId },
          data: { resultAccountId: c.acc.resultado },
        });
      }
    });

    it('solo se cierra el ejercicio abierto más antiguo; uno inexistente se rechaza', async () => {
      await post(c, '2027-02-10', [D(c.acc.caja, 1), H(c.acc.capital, 1)]);
      const fy2 = await fiscalYearOf(c.companyId, 2);

      expect(await closeFiscalYear({ fiscalYearId: fy2.id })).toEqual({
        success: false,
        error: 'Solo se puede cerrar el ejercicio abierto más antiguo (N° 1).',
      });
      expect(await closeFiscalYear({ fiscalYearId: randomUUID() })).toEqual({
        success: false,
        error: 'Ejercicio no encontrado.',
      });
    });
  });

  describe('cierre feliz y reportes después del cierre (B18, B19, B21, C7, H4)', () => {
    let c: TestCompany;
    let fy1Id: string;
    let budgetId: string;
    let closing: Awaited<ReturnType<typeof entryWithLines>>;
    let opening: Awaited<ReturnType<typeof entryWithLines>>;

    beforeAll(async () => {
      c = await setupCompany('Feliz');
      await post(c, '2026-01-15', [D(c.acc.caja, 1000), H(c.acc.capital, 1000)]);
      await post(c, '2026-01-16', [
        D(c.acc.cajaUsd, 1000, { currency: 'USD', originalAmount: 10, exchangeRate: 100 }),
        H(c.acc.capital, 1000),
      ]);
      await post(c, '2026-03-10', [D(c.acc.caja, 1000), H(c.acc.ventas, 1000)]);
      await post(c, '2026-05-20', [D(c.acc.gastos, 400), H(c.acc.caja, 400)]);
      await post(c, '2026-07-10', [D(c.acc.ivaCf, 21), H(c.acc.caja, 21)]);
      fy1Id = (await fiscalYearOf(c.companyId, 1)).id;
      ({ id: budgetId } = await prisma.budget.create({
        data: {
          companyId: c.companyId,
          accountId: c.acc.gastos,
          fiscalYear: 2026,
          status: 'ACTIVE',
          monthlyAmounts: Array(12).fill(100),
          totalAmount: 1200,
          createdBy: USER,
        },
        select: { id: true },
      }));
      await prisma.inflationIndex.createMany({
        data: [
          { companyId: c.companyId, year: 2026, month: 12, index: 100 },
          { companyId: c.companyId, year: 2027, month: 1, index: 110 },
        ],
      });
      await prisma.exchangeRate.create({
        data: {
          companyId: c.companyId,
          currency: 'USD',
          date: day('2027-01-31'),
          buyRate: 120,
          sellRate: 120,
        },
      });
      await closeMonths(c, 2026, 1, 12);
    });
    beforeEach(() => asCompany(c));

    it('estado: listo para cerrar, sin meses abiertos ni borradores', async () => {
      const status = await getFiscalYearStatus();
      expect(status).toMatchObject({
        fiscalYear: { id: fy1Id, number: 1, startDay: '2026-01-01', endDay: '2026-12-31' },
        resultAccountName: `${PREFIX}resultado`,
        openMonths: [],
        pendingDrafts: [],
        canClose: true,
        lastClosed: null,
      });
    });

    it('vista previa: refundición y apertura balanceadas con el resultado incluido (B21)', async () => {
      const result = await previewFiscalYearClose(fy1Id);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result).toMatchObject({ totalRevenue: 1000, totalExpense: 400, netResult: 600 });
      expect(sorted(result.closingLines)).toEqual(
        sorted([
          { accountId: c.acc.ventas, debit: 1000, credit: 0 },
          { accountId: c.acc.gastos, debit: 0, credit: 400 },
          { accountId: c.acc.resultado, debit: 0, credit: 600 },
        ]).map((l) => expect.objectContaining(l))
      );
      expect(sorted(result.openingLines)).toEqual(
        sorted([
          { accountId: c.acc.caja, debit: 1579, credit: 0 },
          { accountId: c.acc.cajaUsd, debit: 1000, credit: 0 },
          { accountId: c.acc.ivaCf, debit: 21, credit: 0 },
          { accountId: c.acc.capital, debit: 0, credit: 2000 },
          { accountId: c.acc.resultado, debit: 0, credit: 600 },
        ]).map((l) => expect.objectContaining(l))
      );
    });

    it('cierra: refundición en CLOSING, apertura en OPENING cerrado, FY 2 con 12 meses (C7, D12)', async () => {
      const result = await closeFiscalYear({ fiscalYearId: fy1Id });
      expect(result).toMatchObject({ success: true, nextFiscalYearNumber: 2 });
      if (!result.success) return;

      const fy1 = await fiscalYearOf(c.companyId, 1);
      const fy2 = await fiscalYearOf(c.companyId, 2);
      expect(fy1).toMatchObject({ isClosed: true, closedBy: USER });
      expect(fy1.periods).toHaveLength(14);
      expect(fy1.periods.every((p) => p.isClosed)).toBe(true);

      closing = await entryWithLines(fy1.closingEntryId!);
      expect(closing).toMatchObject({
        number: result.closingEntryNumber,
        status: 'POSTED',
        fiscalYearId: fy1.id,
        period: { type: 'CLOSING', fiscalYearId: fy1.id },
      });
      expect(closing.date.toISOString().slice(0, 10)).toBe('2026-12-31');
      expect(closing.debit).toBe(1000);
      expect(closing.credit).toBe(1000);

      opening = await entryWithLines(fy2.openingEntryId!);
      expect(opening).toMatchObject({
        number: result.openingEntryNumber,
        status: 'POSTED',
        fiscalYearId: fy2.id,
        period: { type: 'OPENING', fiscalYearId: fy2.id },
      });
      expect(opening.date.toISOString()).toBe('2027-01-01T00:00:00.000Z');
      expect(opening.debit).toBe(2600);
      expect(opening.credit).toBe(2600);
      expect(opening.lines).toEqual(
        sorted([
          { accountId: c.acc.caja, debit: 1579, credit: 0 },
          { accountId: c.acc.cajaUsd, debit: 1000, credit: 0 },
          { accountId: c.acc.ivaCf, debit: 21, credit: 0 },
          { accountId: c.acc.capital, debit: 0, credit: 2000 },
          { accountId: c.acc.resultado, debit: 0, credit: 600 },
        ])
      );

      expect(fy2.startDate.toISOString()).toBe('2027-01-01T00:00:00.000Z');
      expect(fy2.endDate.toISOString()).toBe('2027-12-31T23:59:59.999Z');
      const monthly = fy2.periods.filter((p) => p.type === 'MONTHLY');
      expect(monthly).toHaveLength(12);
      expect(monthly.every((p) => !p.isClosed)).toBe(true);
      expect(fy2.periods.find((p) => p.type === 'OPENING')?.isClosed).toBe(true);
      expect(fy2.periods.find((p) => p.type === 'CLOSING')?.isClosed).toBe(false);

      const settings = await prisma.accountingSettings.findUniqueOrThrow({
        where: { companyId: c.companyId },
        select: { fiscalYearStart: true, fiscalYearEnd: true, lockedUntilDate: true },
      });
      expect(settings.fiscalYearStart.toISOString()).toBe('2027-01-01T00:00:00.000Z');
      expect(settings.fiscalYearEnd.toISOString()).toBe('2027-12-31T23:59:59.999Z');
      expect(settings.lockedUntilDate?.toISOString()).toBe('2026-12-31T23:59:59.999Z');
    });

    it('estado después del cierre: FY 2 abierto y el último cerrado con sus asientos', async () => {
      const status = await getFiscalYearStatus();
      expect(status?.fiscalYear).toMatchObject({ number: 2, startDay: '2027-01-01', endDay: '2027-12-31' });
      expect(status?.openMonths).toHaveLength(12);
      expect(status?.lastClosed).toMatchObject({
        number: 1,
        closingEntryNumber: closing.number,
        openingEntryNumber: opening.number,
      });
      expect(await closeFiscalYear({ fiscalYearId: fy1Id })).toEqual({
        success: false,
        error: 'El ejercicio N° 1 ya está cerrado.',
      });
    });

    it('B18: Balance, Sumas y Saldos y saldos acumulados del FY 2 = saldos del cerrado (no el doble)', async () => {
      const sheet = await getBalanceSheet(c.companyId, day('2027-01-31'));
      // `isBalanced` del Balance compara con signos opuestos (preexistente): se mira cada total.
      expect(sheet.totalAssets).toBe(2600);
      expect(sheet.equity.total).toBe(-2600); // Capital 2000 + Resultado 600 (saldo acreedor)
      expect(sheet.liabilities.total).toBe(0);
      expect(sheet.periodResult).toBe(0);

      const atClose = await getTrialBalance(c.companyId, day('2026-01-01'), day('2026-12-31'));
      const january = await getTrialBalance(c.companyId, day('2027-01-01'), day('2027-01-31'));
      const byAccount = (tb: typeof january) =>
        Object.fromEntries(tb.accounts.map((a) => [a.accountId, a.balance]));
      expect(byAccount(january)).toEqual(byAccount(atClose));
      expect(byAccount(january)[c.acc.caja]).toBe(1579);
      expect(january.totalDebit).toBe(atClose.totalDebit);

      const caja = await calculateAccountBalance(c.acc.caja, c.companyId, day('2027-01-31'));
      expect(caja.balance).toBe(1579);
    });

    it('B18: el Mayor de enero arranca con el saldo del cierre y no repite la apertura', async () => {
      const ledger = await getGeneralLedger(c.companyId, day('2027-01-01'), day('2027-01-31'));
      const caja = ledger.find((a) => a.id === c.acc.caja)!;
      expect(caja.openingBalance).toBe(1579);
      expect(caja.entries).toHaveLength(0);
      expect(caja.balance).toBe(1579);
    });

    it('B19: el Estado de Resultados del ejercicio cerrado conserva sus valores', async () => {
      const income = await getIncomeStatement(c.companyId, day('2026-01-01'), day('2026-12-31'));
      expect(income.revenue.total).toBe(1000);
      expect(income.expenses.total).toBe(400);
      expect(income.netIncome).toBe(600);
    });

    it('B19: presupuesto y centros de costo no cuentan la refundición de diciembre', async () => {
      const variance = await getBudgetVarianceReport(c.companyId, 2026);
      expect(variance.expenses.totalExecuted).toBe(400);

      const detail = await getBudgetDetail(budgetId);
      expect(detail?.totalExecuted).toBe(400);
      expect(detail?.monthlyExecuted[11]).toBe(0);

      const movements = await getCostCenterMovements(c.companyId, {
        costCenterId: 'none',
        fromDate: day('2026-12-01'),
        toDate: day('2026-12-31'),
        includeDrafts: false,
      });
      expect(movements.groups).toHaveLength(0);
    });

    it('H4: IVA de enero, diferencia de cambio e inflación no suman la apertura', async () => {
      const vat = await previewVatSettlement(2027, 1);
      expect(vat.totalCredit).toBe(0);

      const exchange = await previewExchangeDifference(day('2027-01-31'));
      expect(exchange).toEqual([
        expect.objectContaining({ accountId: c.acc.cajaUsd, originalBalance: 10, previousArsBalance: 1000 }),
      ]);

      const recpam = await calculateRECPAM(2027, 1);
      expect(recpam).toEqual([
        expect.objectContaining({ accountId: c.acc.caja, openingBalance: 1579, closingBalance: 1579 }),
      ]);
    });

    it('no se reabre un mes del ejercicio cerrado', async () => {
      await expect(
        prisma.$transaction((tx) => reopenMonthTx(tx, { companyId: c.companyId, year: 2026, month: 12 }))
      ).rejects.toThrow('No se puede reabrir 12/2026: pertenece al ejercicio N° 1, que está cerrado.');
    });

    it('segundo cierre (FY 2): la apertura de FY 3 no duplica la de FY 2', async () => {
      await post(c, '2027-02-10', [D(c.acc.caja, 300), H(c.acc.ventas, 300)]);
      await closeMonths(c, 2027, 1, 12);
      const fy2 = await fiscalYearOf(c.companyId, 2);

      const result = await closeFiscalYear({ fiscalYearId: fy2.id });
      expect(result).toMatchObject({ success: true, nextFiscalYearNumber: 3 });

      const fy3 = await fiscalYearOf(c.companyId, 3);
      const opening3 = await entryWithLines(fy3.openingEntryId!);
      expect(opening3.lines).toEqual(
        sorted([
          { accountId: c.acc.caja, debit: 1879, credit: 0 },
          { accountId: c.acc.cajaUsd, debit: 1000, credit: 0 },
          { accountId: c.acc.ivaCf, debit: 21, credit: 0 },
          { accountId: c.acc.capital, debit: 0, credit: 2000 },
          { accountId: c.acc.resultado, debit: 0, credit: 900 },
        ])
      );
      const sheet = await getBalanceSheet(c.companyId, day('2028-01-31'));
      expect(sheet.totalAssets).toBe(2900);
      expect(sheet.equity.total).toBe(-2900);
      const income = await getIncomeStatement(c.companyId, day('2027-01-01'), day('2027-12-31'));
      expect(income.netIncome).toBe(300);
    });
  });

  describe('FY siguiente existente, resultados acumulados e inactivos, resultado 0 (B24, C4, H5)', () => {
    let c: TestCompany;
    let fy2Id: string;

    beforeAll(async () => {
      c = await setupCompany('Reutiliza');
      // Resultado previo al primer ejercicio, sin refundir (C4): cargado antes de TSK-760.
      await prisma.journalEntry.create({
        data: {
          companyId: c.companyId,
          number: 900,
          date: day('2025-12-20'),
          description: `${PREFIX}previo`,
          status: 'POSTED',
          postDate: new Date(),
          createdBy: USER,
          lines: {
            create: [
              { accountId: c.acc.caja, debit: 50, credit: 0 },
              { accountId: c.acc.ventas, debit: 0, credit: 50 },
            ],
          },
        },
      });
      await post(c, '2026-01-15', [D(c.acc.caja, 1000), H(c.acc.capital, 1000)]);
      await post(c, '2026-03-10', [D(c.acc.caja, 500), H(c.acc.ventas, 500)]);
      await post(c, '2026-04-20', [D(c.acc.gastos, 450), H(c.acc.caja, 450)]);
      await post(c, '2026-04-25', [D(c.acc.gastoViejo, 100), H(c.acc.caja, 100)]);
      await prisma.account.update({ where: { id: c.acc.gastoViejo }, data: { isActive: false } });
      // El FY 2 ya existe (se operó en enero antes de cerrar el anterior, D1).
      await post(c, '2027-01-10', [D(c.acc.caja, 10), H(c.acc.capital, 10)]);
      fy2Id = (await fiscalYearOf(c.companyId, 2)).id;
      await closeMonths(c, 2026, 1, 12);
    });
    beforeEach(() => asCompany(c));

    it('reutiliza el FY 2, incluye la cuenta inactiva y omite la línea de Resultado en 0', async () => {
      const fy1 = await fiscalYearOf(c.companyId, 1);
      const result = await closeFiscalYear({ fiscalYearId: fy1.id });
      expect(result).toMatchObject({ success: true, nextFiscalYearNumber: 2 });

      expect(await prisma.fiscalYear.count({ where: { companyId: c.companyId } })).toBe(2);
      const fy2 = await fiscalYearOf(c.companyId, 2);
      expect(fy2.id).toBe(fy2Id);
      expect(fy2.periods.filter((p) => p.type === 'MONTHLY')).toHaveLength(12);
      expect(fy2.periods.find((p) => p.type === 'OPENING')?.isClosed).toBe(true);

      const closingEntry = await entryWithLines((await fiscalYearOf(c.companyId, 1)).closingEntryId!);
      expect(closingEntry.lines).toEqual(
        sorted([
          { accountId: c.acc.ventas, debit: 550, credit: 0 },
          { accountId: c.acc.gastos, debit: 0, credit: 450 },
          { accountId: c.acc.gastoViejo, debit: 0, credit: 100 },
        ])
      );

      const openingEntry = await entryWithLines(fy2.openingEntryId!);
      expect(openingEntry.lines).toEqual(
        sorted([
          { accountId: c.acc.caja, debit: 1000, credit: 0 },
          { accountId: c.acc.capital, debit: 0, credit: 1000 },
        ])
      );

      const sheet = await getBalanceSheet(c.companyId, day('2027-01-31'));
      expect(sheet.totalAssets).toBe(1010);
      expect(sheet.equity.total).toBe(-1010);
    });
  });
});
