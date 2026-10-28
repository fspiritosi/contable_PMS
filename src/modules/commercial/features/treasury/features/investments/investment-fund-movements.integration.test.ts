/**
 * Tests de integración de la compra y la venta de inversión como Movimientos de
 * Fondos (TSK-793, Tarea 4) contra la base real de desarrollo.
 *
 * Sigue el molde de
 * `../fund-movements/list/fund-movement-lines.integration.test.ts`: se llaman
 * las actions reales (`createFundMovement` con `confirm: true`, que confirma con
 * `confirmFundMovement`) y solo se aísla la frontera de sesión, permisos, empresa
 * activa y caché de Next con `vi.mock`.
 *
 * Las tenencias se siembran directo con Prisma: su ABM llega en la Tarea 6.
 *
 * Aislamiento: todo lo creado lleva el prefijo `TSK793-FM-` y el `afterAll`
 * borra la empresa de prueba con todo lo suyo.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', () => ({
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import type { Tx } from '@/modules/accounting/features/integrations/core';
import { cleanupAccountingCompany } from '@/modules/accounting/shared/test-utils/cleanup-accounting-company';
import { revertFundMovementEffectsTx } from '@/modules/commercial/shared/effects/fund-movement.server';
import { loadHoldingMovementsTx } from '@/modules/commercial/shared/effects/investment.server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

import { createFundMovement } from '../fund-movements/list/actions.server';
import {
  fundMovementSchema,
  type FundMovementFormInput,
} from '../fund-movements/shared/validators';
import { positionAt } from './shared/position';

// Toda la suite corre en paralelo con mucha carga: los asientos tardan.
vi.setConfig({ testTimeout: 30_000 });

const PREFIX = 'TSK793-FM-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

/** Señal para deshacer una transacción de prueba después de mirar adentro. */
class Rollback extends Error {}

interface LineRow {
  accountId: string;
  debit: number;
  credit: number;
}

const byAccount = (a: LineRow, b: LineRow) =>
  a.accountId.localeCompare(b.accountId) || a.debit - b.debit || a.credit - b.credit;

describe.skipIf(!dbAvailable)('integración: compra y venta de inversión (TSK-793)', () => {
  let companyId: string;
  let bankId: string;
  let bankLedgerId: string;
  let holdingLedgerId: string;
  let feesId: string;
  let gainId: string;
  let lossId: string;

  const bankBalance = async () =>
    Number(
      (
        await prisma.bankAccount.findUniqueOrThrow({
          where: { id: bankId },
          select: { balance: true },
        })
      ).balance
    );

  const entryLines = async (movementId: string): Promise<LineRow[]> => {
    const { journalEntryId } = await prisma.fundMovement.findUniqueOrThrow({
      where: { id: movementId },
      select: { journalEntryId: true },
    });
    if (!journalEntryId) throw new Error('El movimiento no tiene asiento');
    const rows = await prisma.journalEntryLine.findMany({
      where: { entryId: journalEntryId },
      select: { accountId: true, debit: true, credit: true },
    });
    return rows
      .map((r) => ({ accountId: r.accountId, debit: Number(r.debit), credit: Number(r.credit) }))
      .sort(byAccount);
  };

  const position = async (holdingId: string) =>
    positionAt(await loadHoldingMovementsTx(prisma as unknown as Tx, holdingId));

  const mkHolding = async (name: string) =>
    (
      await prisma.investmentHolding.create({
        data: {
          companyId,
          bankAccountId: bankId,
          instrumentType: 'BOND',
          name: `${PREFIX}${name}`,
          accountId: holdingLedgerId,
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
    description: `${PREFIX}Venta`,
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

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const mk = (code: string, type: 'ASSET' | 'EXPENSE' | 'REVENUE') =>
      prisma.account.create({
        data: {
          companyId,
          code: `T793F-${code}`,
          name: `${PREFIX}${code}`,
          type,
          nature: type === 'REVENUE' ? 'CREDIT' : 'DEBIT',
        },
        select: { id: true },
      });
    const [banco, tenencia, comisiones, ganancia, perdida] = await Promise.all([
      mk('BANCO', 'ASSET'),
      mk('TENENCIA', 'ASSET'),
      mk('COMISIONES', 'EXPENSE'),
      mk('GANANCIA', 'REVENUE'),
      mk('PERDIDA', 'EXPENSE'),
    ]);
    bankLedgerId = banco.id;
    holdingLedgerId = tenencia.id;
    feesId = comisiones.id;
    gainId = ganancia.id;
    lossId = perdida.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        lastEntryNumber: 0,
        holdingGainAccountId: gainId,
        holdingLossAccountId: lossId,
        investmentFeesAccountId: feesId,
      },
    });

    bankId = (
      await prisma.bankAccount.create({
        data: {
          companyId,
          bankName: `${PREFIX}Broker`,
          accountNumber: 'T793F-1',
          accountType: 'BROKER',
          balance: 10000,
          status: 'ACTIVE',
          accountId: bankLedgerId,
        },
        select: { id: true },
      })
    ).id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    // Guarda: sin id, Prisma omitiría el filtro y borraría tablas enteras.
    if (companyId) {
      await prisma.bankMovement.deleteMany({ where: { companyId } });
      // Cascadea los InvestmentMovement de compras y ventas.
      await prisma.fundMovement.deleteMany({ where: { companyId } });
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

  describe('ciclo de una tenencia: compra, venta parcial y venta total', () => {
    let holdingId: string;
    let fullSaleId: string;

    beforeAll(async () => {
      holdingId = await mkHolding('H1');
    });

    it('(a) compra con comisión: banco −1005, asiento y posición {1000, 100}', async () => {
      const before = await bankBalance();

      const id = await confirmed(compra(holdingId, '2026-03-10', { commission: '5' }));

      expect(await bankBalance()).toBe(before - 1005);
      expect(await entryLines(id)).toEqual(
        [
          { accountId: holdingLedgerId, debit: 1000, credit: 0 },
          { accountId: feesId, debit: 5, credit: 0 },
          { accountId: bankLedgerId, debit: 0, credit: 1005 },
        ].sort(byAccount)
      );
      expect(await position(holdingId)).toEqual({ bookValue: 1000, nominals: 100 });
      const movement = await prisma.investmentMovement.findFirstOrThrow({
        where: { fundMovementId: id },
        select: { kind: true, bookDelta: true, nominalsDelta: true },
      });
      expect(movement.kind).toBe('PURCHASE');
    });

    it('(b) venta parcial de 40 nominales por 500 con comisión 2: banco +498 y ganancia 100', async () => {
      const before = await bankBalance();

      const id = await confirmed(
        venta(holdingId, '2026-04-10', { nominals: '40', commission: '2' })
      );

      expect(await bankBalance()).toBe(before + 498);
      expect(await entryLines(id)).toEqual(
        [
          { accountId: bankLedgerId, debit: 498, credit: 0 },
          { accountId: feesId, debit: 2, credit: 0 },
          { accountId: holdingLedgerId, debit: 0, credit: 400 },
          { accountId: gainId, debit: 0, credit: 100 },
        ].sort(byAccount)
      );
      expect(await position(holdingId)).toEqual({ bookValue: 600, nominals: 60 });
      const sale = await prisma.investmentMovement.findFirstOrThrow({
        where: { fundMovementId: id },
        select: { kind: true, proceeds: true, result: true, closesHolding: true },
      });
      expect({ ...sale, proceeds: Number(sale.proceeds), result: Number(sale.result) }).toEqual({
        kind: 'SALE',
        proceeds: 500,
        result: 100,
        closesHolding: false,
      });
    });

    it('(c) venta total por 500 con libros 600: pérdida 100 y tenencia cerrada', async () => {
      const before = await bankBalance();

      fullSaleId = await confirmed(
        venta(holdingId, '2026-05-10', { nominals: '60', isFullSale: true })
      );

      expect(await bankBalance()).toBe(before + 500);
      expect(await entryLines(fullSaleId)).toEqual(
        [
          { accountId: bankLedgerId, debit: 500, credit: 0 },
          { accountId: lossId, debit: 100, credit: 0 },
          { accountId: holdingLedgerId, debit: 0, credit: 600 },
        ].sort(byAccount)
      );
      expect(await position(holdingId)).toEqual({ bookValue: 0, nominals: 0 });
      const holding = await prisma.investmentHolding.findUniqueOrThrow({
        where: { id: holdingId },
        select: { status: true },
      });
      expect(holding.status).toBe('CLOSED');
    });

    it('revert de la venta total: borra su movimiento, reabre la tenencia y devuelve el banco', async () => {
      const before = await bankBalance();

      await expect(
        prisma.$transaction(async (tx) => {
          await revertFundMovementEffectsTx(tx, { companyId, userId: 'test-user' }, fullSaleId);

          expect(await tx.investmentMovement.count({ where: { fundMovementId: fullSaleId } })).toBe(
            0
          );
          const holding = await tx.investmentHolding.findUniqueOrThrow({
            where: { id: holdingId },
            select: { status: true },
          });
          expect(holding.status).toBe('OPEN');
          expect(positionAt(await loadHoldingMovementsTx(tx, holdingId))).toEqual({
            bookValue: 600,
            nominals: 60,
          });
          const bank = await tx.bankAccount.findUniqueOrThrow({
            where: { id: bankId },
            select: { balance: true },
          });
          expect(Number(bank.balance)).toBe(before - 500);
          throw new Rollback();
        })
      ).rejects.toBeInstanceOf(Rollback);
    });

    it('una tenencia cerrada no admite movimientos nuevos', async () => {
      const result = await createFundMovement(compra(holdingId, '2026-06-10'), true);
      expect(result).toEqual({
        success: false,
        error: 'La tenencia seleccionada no es válida o está cerrada',
      });
    });
  });

  it('(d) venta con fecha anterior a la compra: saldo negativo y el banco no cambia', async () => {
    const holdingId = await mkHolding('H2');
    await confirmed(compra(holdingId, '2026-06-10'));
    const before = await bankBalance();

    const result = await createFundMovement(
      venta(holdingId, '2026-06-01', { nominals: '40' }),
      true
    );

    expect(result).toEqual({
      success: false,
      error: `La operación deja la tenencia «${PREFIX}H2» con saldo negativo al 01/06/2026`,
    });
    expect(await bankBalance()).toBe(before);
    expect(await position(holdingId)).toEqual({ bookValue: 1000, nominals: 100 });
  });

  it('venta retroactiva que deja negativa una venta posterior ya confirmada: se rechaza', async () => {
    const holdingId = await mkHolding('H3');
    await confirmed(compra(holdingId, '2026-06-10'));
    await confirmed(venta(holdingId, '2026-06-20', { nominals: '60', amount: '700' }));
    const before = await bankBalance();

    const result = await createFundMovement(
      venta(holdingId, '2026-06-15', { nominals: '60', amount: '650' }),
      true
    );

    expect(result).toEqual({
      success: false,
      error: `La operación deja la tenencia «${PREFIX}H3» con saldo negativo al 20/06/2026`,
    });
    expect(await bankBalance()).toBe(before);
    expect(await position(holdingId)).toEqual({ bookValue: 400, nominals: 40 });
  });

  it('(e) compra con comisión sin cuenta de comisiones configurada: mensaje exacto', async () => {
    const holdingId = await mkHolding('H4');
    await prisma.accountingSettings.update({
      where: { companyId },
      data: { investmentFeesAccountId: null },
    });
    try {
      const before = await bankBalance();
      const result = await createFundMovement(
        compra(holdingId, '2026-07-10', { commission: '5' }),
        true
      );
      expect(result).toEqual({
        success: false,
        error: 'Configurá la cuenta de comisiones de inversiones en Ajustes contables',
      });
      expect(await bankBalance()).toBe(before);
      expect(await prisma.investmentMovement.count({ where: { holdingId } })).toBe(0);
    } finally {
      await prisma.accountingSettings.update({
        where: { companyId },
        data: { investmentFeesAccountId: feesId },
      });
    }
  });

  it('(f) compra con fecha igual a una valuación existente: mensaje exacto', async () => {
    const holdingId = await mkHolding('H5');
    await prisma.investmentMovement.create({
      data: {
        companyId,
        holdingId,
        kind: 'VALUATION',
        date: new Date('2026-07-31'),
        bookDelta: 0,
        valuedAmount: 0,
      },
    });
    const before = await bankBalance();

    const result = await createFundMovement(compra(holdingId, '2026-07-31'), true);

    expect(result).toEqual({
      success: false,
      error: `La tenencia «${PREFIX}H5» ya tiene valuación al cierre del 31/07/2026. Deshacé esa valuación para registrar movimientos anteriores.`,
    });
    expect(await bankBalance()).toBe(before);
  });

  it('(g) venta con comisión mayor o igual al importe: la rechaza el schema', async () => {
    const holdingId = await mkHolding('H6');
    const input = venta(holdingId, '2026-08-10', { commission: '500' });

    const parsed = fundMovementSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.message)).toContain(
      'La comisión no puede ser mayor o igual al importe'
    );

    const result = await createFundMovement(input, true);
    expect(result.success).toBe(false);
    expect(await prisma.fundMovement.count({ where: { holdingId } })).toBe(0);
  });

  it('el borrador guarda los datos de inversión solo en los tipos de inversión', async () => {
    const holdingId = await mkHolding('H7');
    const draft = await createFundMovement(
      compra(holdingId, '2026-08-10', { commission: '5', isFullSale: true })
    );
    if (!draft.success) throw new Error(draft.error);
    const saved = await prisma.fundMovement.findUniqueOrThrow({
      where: { id: draft.id! },
      select: {
        holdingId: true,
        nominals: true,
        unitPrice: true,
        commission: true,
        isFullSale: true,
      },
    });
    expect({
      ...saved,
      nominals: Number(saved.nominals),
      unitPrice: Number(saved.unitPrice),
      commission: Number(saved.commission),
    }).toEqual({ holdingId, nominals: 100, unitPrice: 10, commission: 5, isFullSale: false });

    // Un tipo que no es de inversión ignora la tenencia aunque venga cargada.
    const otherBank = await prisma.bankAccount.create({
      data: {
        companyId,
        bankName: `${PREFIX}Banco 2`,
        accountNumber: 'T793F-2',
        accountType: 'CHECKING',
        balance: 0,
        status: 'ACTIVE',
        accountId: bankLedgerId,
      },
      select: { id: true },
    });
    const transfer = await createFundMovement({
      type: 'ACCOUNT_TRANSFER',
      date: '2026-08-10',
      amount: '10',
      description: `${PREFIX}Transferencia`,
      sourceFund: `BANK:${bankId}`,
      destinationFund: `BANK:${otherBank.id}`,
      partnerId: '',
      holdingId,
      nominals: '1',
      unitPrice: '10',
      commission: '1',
      isFullSale: true,
    });
    if (!transfer.success) throw new Error(transfer.error);
    expect(
      await prisma.fundMovement.findUniqueOrThrow({
        where: { id: transfer.id! },
        select: {
          holdingId: true,
          nominals: true,
          unitPrice: true,
          commission: true,
          isFullSale: true,
        },
      })
    ).toEqual({
      holdingId: null,
      nominals: null,
      unitPrice: null,
      commission: null,
      isFullSale: false,
    });
  });

  it('el borrador rechaza una tenencia de otra empresa', async () => {
    const other = await prisma.company.create({
      data: { name: `${PREFIX}Otra`, isActive: true },
      select: { id: true },
    });
    try {
      const otherAccount = await prisma.account.create({
        data: {
          companyId: other.id,
          code: 'T793F-AJENA',
          name: `${PREFIX}Ajena`,
          type: 'ASSET',
          nature: 'DEBIT',
        },
        select: { id: true },
      });
      const otherBank = await prisma.bankAccount.create({
        data: {
          companyId: other.id,
          bankName: `${PREFIX}Broker ajeno`,
          accountNumber: 'T793F-3',
          accountType: 'BROKER',
          balance: 0,
          status: 'ACTIVE',
          accountId: otherAccount.id,
        },
        select: { id: true },
      });
      const foreign = await prisma.investmentHolding.create({
        data: {
          companyId: other.id,
          bankAccountId: otherBank.id,
          instrumentType: 'BOND',
          name: `${PREFIX}Ajena`,
          accountId: otherAccount.id,
          createdBy: 'test',
        },
        select: { id: true },
      });

      const result = await createFundMovement(compra(foreign.id, '2026-08-10'));

      expect(result).toEqual({
        success: false,
        error: 'La tenencia seleccionada no es válida',
      });
    } finally {
      await prisma.investmentHolding.deleteMany({ where: { companyId: other.id } });
      await prisma.bankAccount.deleteMany({ where: { companyId: other.id } });
      await prisma.account.deleteMany({ where: { companyId: other.id } });
      await prisma.company.deleteMany({ where: { id: other.id } });
    }
  });
});
