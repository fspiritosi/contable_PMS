/**
 * Tests de integración de la valuación de inversiones al cierre del ejercicio
 * (TSK-793, Tarea 8) contra la base real de desarrollo.
 *
 * Sigue el molde de `../investment-fund-movements.integration.test.ts`: las compras
 * y ventas se confirman con la action real (`createFundMovement` con `confirm:
 * true`), la venta se anula con el motor de corrección del TSK-792 y la valuación
 * se genera y deshace con sus actions públicas. Se aísla solo la frontera de
 * sesión, permisos, empresa activa y caché de Next con `vi.mock`.
 *
 * Los tests corren en orden sobre una sola empresa y un solo ejercicio (2025): la
 * valuación es una por ejercicio y abarca todas las tenencias con posición al
 * cierre, así que cada paso parte del estado que dejó el anterior.
 *
 * Aislamiento: todo lo creado lleva el prefijo `TSK793-VAL-` y el `afterAll` borra
 * la empresa de prueba con todo lo suyo.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import type { InvestmentInstrumentType } from '@/generated/prisma/enums';
import {
  postJournalEntryTx,
  revertJournalEntryToDraftTx,
  type Tx,
} from '@/modules/accounting/features/integrations/core';
import { cleanupAccountingCompany } from '@/modules/accounting/shared/test-utils/cleanup-accounting-company';
import { createFiscalYearWithPeriodsTx } from '@/modules/accounting/shared/utils/period-lock';
import {
  applyDocumentCorrection,
  previewDocumentCorrection,
} from '@/modules/commercial/shared/actions/document-correction.server';
import type { CorrectionRequest } from '@/modules/commercial/shared/correction/types';
import { loadHoldingMovementsTx } from '@/modules/commercial/shared/effects/investment.server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

import { createFundMovement } from '../../fund-movements/list/actions.server';
import type { FundMovementFormInput } from '../../fund-movements/shared/validators';
import { positionAt } from '../shared/position';
import {
  generateInvestmentValuation,
  getValuationCandidates,
  undoInvestmentValuation,
} from './actions.server';

// Toda la suite corre en paralelo con mucha carga: los asientos tardan.
vi.setConfig({ testTimeout: 30_000 });

const PREFIX = 'TSK793-VAL-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

interface LineRow {
  accountId: string;
  debit: number;
  credit: number;
}

const byAccount = (a: LineRow, b: LineRow) =>
  a.accountId.localeCompare(b.accountId) || a.debit - b.debit || a.credit - b.credit;

describe.skipIf(!dbAvailable)('integración: valuación de inversiones al cierre (TSK-793)', () => {
  let companyId: string;
  let fiscalYearId: string;
  let bankId: string;
  const ledger: Record<'H1' | 'H2' | 'H3' | 'H4', string> = { H1: '', H2: '', H3: '', H4: '' };
  let gainId: string;
  let lossId: string;
  const holding: Record<'H1' | 'H2' | 'H3' | 'H4', string> = { H1: '', H2: '', H3: '', H4: '' };
  let laterSaleId: string;
  let valuationId: string;
  let entryNumber: number | null;

  /** Posición de la tenencia al cierre del día `asOf` (o con todos sus movimientos). */
  const position = async (holdingId: string, asOf?: string) =>
    positionAt(
      await loadHoldingMovementsTx(prisma as unknown as Tx, holdingId),
      asOf ? new Date(`${asOf}T12:00:00Z`) : undefined
    );

  const mkHolding = async (key: keyof typeof holding, instrumentType: InvestmentInstrumentType) =>
    (
      await prisma.investmentHolding.create({
        data: {
          companyId,
          bankAccountId: bankId,
          instrumentType,
          name: `${PREFIX}${key}`,
          accountId: ledger[key],
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;

  const compra = (
    holdingId: string,
    date: string,
    extra: Partial<FundMovementFormInput> = {}
  ): FundMovementFormInput => ({
    type: 'INVESTMENT_PURCHASE',
    date,
    amount: '1000',
    nominals: '100',
    unitPrice: '10',
    description: `${PREFIX}Compra`,
    sourceFund: `BANK:${bankId}`,
    destinationFund: '',
    partnerId: '',
    holdingId,
    ...extra,
  });

  const venta = (
    holdingId: string,
    date: string,
    extra: Partial<FundMovementFormInput> = {}
  ): FundMovementFormInput => ({
    type: 'INVESTMENT_SALE',
    date,
    amount: '500',
    nominals: '40',
    description: `${PREFIX}Venta H4`,
    sourceFund: '',
    destinationFund: `BANK:${bankId}`,
    partnerId: '',
    holdingId,
    ...extra,
  });

  async function confirmed(input: FundMovementFormInput): Promise<string> {
    const result = await createFundMovement(input, true);
    if (!result.success || !result.id) {
      throw new Error(`No se pudo confirmar: ${result.success ? 'sin id' : result.error}`);
    }
    return result.id;
  }

  /** Anula un movimiento de fondos con el motor de corrección (sin impedimentos). */
  async function cancel(id: string) {
    const request: CorrectionRequest = { mode: 'CANCEL', ref: { kind: 'FUND_MOVEMENT', id } };
    const preview = await previewDocumentCorrection(request);
    if (!preview.success) throw new Error(`Vista previa fallida: ${preview.error}`);
    expect(preview.proposal.impediments).toEqual([]);
    expect(await applyDocumentCorrection(request, preview.proposal.fingerprint)).toEqual({
      success: true,
      applied: true,
    });
  }

  /** Todas las líneas de las cuatro tenencias, la H2 con precio por nominal. */
  const allLines = () => [
    { holdingId: holding.H1, valuedAmount: '1200' },
    { holdingId: holding.H2, unitPrice: '9' },
    { holdingId: holding.H3, valuedAmount: '500' },
    { holdingId: holding.H4, valuedAmount: '1000' },
  ];

  const laterSalesMessage = (labels: string) =>
    `No se puede valuar: «${PREFIX}H4» tiene ventas posteriores al cierre (${labels}). Anulalas, valuá y volvé a cargarlas.`;

  const entryOf = async (id: string) =>
    prisma.journalEntry.findFirst({
      where: { id },
      select: {
        status: true,
        process: true,
        description: true,
        date: true,
        lines: { select: { accountId: true, debit: true, credit: true } },
      },
    });

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const mk = (code: string, type: 'ASSET' | 'EXPENSE' | 'REVENUE') =>
      prisma.account.create({
        data: {
          companyId,
          code: `T793V-${code}`,
          name: `${PREFIX}${code}`,
          type,
          nature: type === 'REVENUE' ? 'CREDIT' : 'DEBIT',
        },
        select: { id: true },
      });
    const [banco, t1, t2, t3, t4, comisiones, ganancia, perdida] = await Promise.all([
      mk('BANCO', 'ASSET'),
      mk('TEN1', 'ASSET'),
      mk('TEN2', 'ASSET'),
      mk('TEN3', 'ASSET'),
      mk('TEN4', 'ASSET'),
      mk('COMISIONES', 'EXPENSE'),
      mk('GANANCIA', 'REVENUE'),
      mk('PERDIDA', 'EXPENSE'),
    ]);
    ledger.H1 = t1.id;
    ledger.H2 = t2.id;
    ledger.H3 = t3.id;
    ledger.H4 = t4.id;
    gainId = ganancia.id;
    lossId = perdida.id;

    // Sin `lockedUntilDate`: el mes de cierre queda abierto.
    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2025-01-01'),
        fiscalYearEnd: new Date('2025-12-31'),
        lastEntryNumber: 0,
        holdingGainAccountId: gainId,
        holdingLossAccountId: lossId,
        investmentFeesAccountId: comisiones.id,
      },
    });
    fiscalYearId = (
      await prisma.$transaction((tx) =>
        createFiscalYearWithPeriodsTx(tx, {
          companyId,
          number: 1,
          startDay: '2025-01-01',
          endDay: '2025-12-31',
        })
      )
    ).id;

    bankId = (
      await prisma.bankAccount.create({
        data: {
          companyId,
          bankName: `${PREFIX}Broker`,
          accountNumber: 'T793V-1',
          accountType: 'BROKER',
          balance: 100000,
          status: 'ACTIVE',
          accountId: banco.id,
        },
        select: { id: true },
      })
    ).id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');

    holding.H1 = await mkHolding('H1', 'BOND');
    holding.H2 = await mkHolding('H2', 'BOND');
    holding.H3 = await mkHolding('H3', 'MUTUAL_FUND');
    holding.H4 = await mkHolding('H4', 'BOND');

    await confirmed(compra(holding.H1, '2025-06-10'));
    await confirmed(compra(holding.H2, '2025-06-10'));
    await confirmed(
      compra(holding.H3, '2025-06-10', { amount: '500', nominals: '', unitPrice: '' })
    );
    // (g) Compra posterior al cierre: no entra en el valor en libros al cierre.
    await confirmed(
      compra(holding.H3, '2026-02-10', { amount: '300', nominals: '', unitPrice: '' })
    );
    await confirmed(compra(holding.H4, '2025-06-10'));
    // (c) Venta confirmada posterior al cierre.
    laterSaleId = await confirmed(venta(holding.H4, '2026-02-15'));
  });

  afterAll(async () => {
    // Guarda: sin id, Prisma omitiría el filtro y borraría tablas enteras.
    if (companyId) {
      await prisma.bankMovement.deleteMany({ where: { companyId } });
      // Cascadea los InvestmentMovement de compras y ventas.
      await prisma.fundMovement.deleteMany({ where: { companyId } });
      // Cascadea los InvestmentMovement de la valuación; va antes que los ejercicios.
      await prisma.investmentValuation.deleteMany({ where: { companyId } });
      await prisma.investmentMovement.deleteMany({ where: { companyId } });
      await prisma.investmentHolding.deleteMany({ where: { companyId } });
      await prisma.bankAccount.deleteMany({ where: { companyId } });
      await cleanupAccountingCompany(companyId);
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
  });

  it('candidatas: valor en libros al cierre y ventas posteriores de cada tenencia', async () => {
    const result = await getValuationCandidates(fiscalYearId);

    expect(result.fiscalYear).toMatchObject({ id: fiscalYearId, number: 1, isClosed: false });
    expect(result.existing).toBeNull();
    const byId = new Map(result.holdings.map((h) => [h.id, h]));
    expect(byId.get(holding.H1)).toMatchObject({
      name: `${PREFIX}H1`,
      instrumentType: 'BOND',
      custody: `${PREFIX}Broker`,
      accountCode: 'T793V-TEN1',
      bookValue: 1000,
      nominals: 100,
      laterSales: [],
    });
    // (g) La compra de 2026 no suma al valor en libros al cierre.
    expect(byId.get(holding.H3)).toMatchObject({ bookValue: 500, nominals: null, laterSales: [] });
    expect(byId.get(holding.H4)?.laterSales).toEqual([`«${PREFIX}Venta H4» del 15/02/2026`]);
    expect(result.holdings).toHaveLength(4);
  });

  it('rechaza si falta el valor de alguna tenencia', async () => {
    const result = await generateInvestmentValuation({
      fiscalYearId,
      lines: [{ holdingId: holding.H1, valuedAmount: '1200' }],
    });
    expect(result).toEqual({
      success: false,
      error: `Faltan valores para: ${PREFIX}H2, ${PREFIX}H3, ${PREFIX}H4`,
    });
  });

  it('(c) venta confirmada posterior al cierre: rechaza toda la valuación y nombra la venta', async () => {
    const result = await generateInvestmentValuation({ fiscalYearId, lines: allLines() });

    expect(result).toEqual({
      success: false,
      error: laterSalesMessage(`«${PREFIX}Venta H4» del 15/02/2026`),
    });
    expect(await prisma.investmentValuation.count({ where: { companyId } })).toBe(0);
    expect(await prisma.investmentMovement.count({ where: { companyId, kind: 'VALUATION' } })).toBe(
      0
    );
  });

  it('precio por nominal en una tenencia sin nominales: rechazo', async () => {
    await cancel(laterSaleId);
    const lines = allLines().map((line) =>
      line.holdingId === holding.H3 ? { holdingId: holding.H3, unitPrice: '5' } : line
    );

    const result = await generateInvestmentValuation({ fiscalYearId, lines });

    expect(result).toEqual({
      success: false,
      error: `La tenencia «${PREFIX}H3» no tiene nominales: cargá el valor al cierre`,
    });
  });

  it('(a)(b)(g) genera la valuación: asiento en borrador con resultado por tenencia', async () => {
    const result = await generateInvestmentValuation({ fiscalYearId, lines: allLines() });
    if (!result.success) throw new Error(result.error);
    valuationId = result.id;
    entryNumber = result.journalEntryNumber;
    expect(entryNumber).toEqual(expect.any(Number));

    const valuation = await prisma.investmentValuation.findUniqueOrThrow({
      where: { id: valuationId },
      select: { journalEntryId: true, journalEntryNumber: true, closingDate: true },
    });
    expect(valuation.journalEntryNumber).toBe(entryNumber);
    expect(valuation.closingDate.toISOString()).toBe('2025-12-31T00:00:00.000Z');

    const entry = await entryOf(valuation.journalEntryId ?? '');
    expect(entry).toMatchObject({
      status: 'DRAFT',
      process: 'INVESTMENT_VALUATION',
      description: 'Valuación de inversiones al 31/12/2025',
    });
    expect(entry?.date.toISOString().slice(0, 10)).toBe('2025-12-31');
    // (a) 1000 → 1200: Debe tenencia / Haber ganancia. (b) 100 × 9 = 900: Debe
    // pérdida / Haber tenencia. H3 y H4 sin diferencia: sin líneas.
    const lines = (entry?.lines ?? [])
      .map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) }))
      .sort(byAccount);
    expect(lines).toEqual(
      [
        { accountId: ledger.H1, debit: 200, credit: 0 },
        { accountId: gainId, debit: 0, credit: 200 },
        { accountId: lossId, debit: 100, credit: 0 },
        { accountId: ledger.H2, debit: 0, credit: 100 },
      ].sort(byAccount)
    );

    // Un movimiento VALUATION por tenencia, aunque la diferencia sea 0.
    const movements = await prisma.investmentMovement.findMany({
      where: { valuationId },
      select: { holdingId: true, bookDelta: true, valuedAmount: true, unitPrice: true },
    });
    expect(movements).toHaveLength(4);
    const h2 = movements.find((m) => m.holdingId === holding.H2);
    expect(Number(h2?.bookDelta)).toBe(-100);
    expect(Number(h2?.valuedAmount)).toBe(900);
    expect(Number(h2?.unitPrice)).toBe(9);

    expect(await position(holding.H1, '2026-01-01')).toEqual({ bookValue: 1200, nominals: 100 });
    expect(await position(holding.H2, '2026-01-01')).toEqual({ bookValue: 900, nominals: 100 });
    // (g) La compra posterior se suma después del valor al cierre.
    expect(await position(holding.H3, '2025-12-31')).toEqual({ bookValue: 500, nominals: null });
    expect(await position(holding.H3)).toEqual({ bookValue: 800, nominals: null });
  });

  it('(d) segunda valuación del mismo ejercicio: rechazo', async () => {
    const result = await generateInvestmentValuation({ fiscalYearId, lines: allLines() });
    expect(result).toEqual({
      success: false,
      error: 'Ya hay una valuación para este ejercicio. Deshacela para volver a generarla',
    });

    // Las candidatas muestran la valuación existente y el valor en libros previo.
    const candidates = await getValuationCandidates(fiscalYearId);
    expect(candidates.existing).toMatchObject({ id: valuationId, journalEntryNumber: entryNumber });
    expect(candidates.holdings.find((h) => h.id === holding.H1)?.bookValue).toBe(1000);
  });

  it('deshacer con una venta confirmada posterior al cierre: rechazo', async () => {
    const saleId = await confirmed(
      venta(holding.H4, '2026-03-01', { description: `${PREFIX}Venta H4 bis` })
    );

    const result = await undoInvestmentValuation(valuationId);
    expect(result).toEqual({
      success: false,
      error: laterSalesMessage(`«${PREFIX}Venta H4 bis» del 01/03/2026`),
    });

    await cancel(saleId);
  });

  it('(f) deshacer con el asiento Registrado: rechazo', async () => {
    const { journalEntryId } = await prisma.investmentValuation.findUniqueOrThrow({
      where: { id: valuationId },
      select: { journalEntryId: true },
    });
    const entryId = journalEntryId ?? '';
    await prisma.$transaction((tx) =>
      postJournalEntryTx(tx, { companyId, entryId, userId: 'test-user' })
    );

    const result = await undoInvestmentValuation(valuationId);
    expect(result).toEqual({
      success: false,
      error: `El asiento N° ${entryNumber} está Registrado. Volvelo a borrador desde Contabilidad › Asientos`,
    });
    expect(await prisma.investmentValuation.count({ where: { id: valuationId } })).toBe(1);

    await prisma.$transaction((tx) =>
      revertJournalEntryToDraftTx(tx, { companyId, entryId, userId: 'test-user' })
    );
  });

  it('(e) deshacer: borra el asiento y la posición vuelve a 1000', async () => {
    const { journalEntryId } = await prisma.investmentValuation.findUniqueOrThrow({
      where: { id: valuationId },
      select: { journalEntryId: true },
    });

    expect(await undoInvestmentValuation(valuationId)).toEqual({ success: true });

    expect(await prisma.journalEntry.count({ where: { id: journalEntryId ?? '' } })).toBe(0);
    expect(await prisma.investmentValuation.count({ where: { id: valuationId } })).toBe(0);
    expect(await prisma.investmentMovement.count({ where: { valuationId } })).toBe(0);
    expect(await position(holding.H1, '2026-01-01')).toEqual({ bookValue: 1000, nominals: 100 });
    expect(await position(holding.H2, '2026-01-01')).toEqual({ bookValue: 1000, nominals: 100 });
  });
});
