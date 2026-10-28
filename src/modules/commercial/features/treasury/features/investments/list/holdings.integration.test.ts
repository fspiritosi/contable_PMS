/**
 * Tests de integración del ABM de tenencias de inversión (TSK-793, Tarea 6)
 * contra la base real de desarrollo. Se llaman las actions reales y solo se aísla
 * la frontera de sesión, permisos, empresa activa y caché de Next con `vi.mock`.
 *
 * Aislamiento: todo lo creado lleva el prefijo `TSK793-HO-` y el `afterAll`
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

import { cleanupAccountingCompany } from '@/modules/accounting/shared/test-utils/cleanup-accounting-company';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

import { createFundMovement } from '../../fund-movements/list/actions.server';
import type { FundMovementFormInput } from '../../fund-movements/shared/validators';
import {
  createInvestmentHolding,
  deleteInvestmentHolding,
  getInvestmentHoldingById,
  getInvestmentHoldings,
  updateInvestmentHolding,
} from './actions.server';

vi.setConfig({ testTimeout: 30_000 });

const PREFIX = 'TSK793-HO-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('integración: tenencias de inversión (TSK-793)', () => {
  let companyId: string;
  let bankId: string;
  let otherBankId: string;
  let bankLedgerId: string;
  let holdingLedgerId: string;
  let otherLedgerId: string;
  let expenseLedgerId: string;

  const input = (name: string, accountId = holdingLedgerId) => ({
    bankAccountId: bankId,
    instrumentType: 'BOND' as const,
    name: `${PREFIX}${name}`,
    maturityDate: '',
    accountId,
  });

  const create = async (name: string): Promise<string> => {
    const result = await createInvestmentHolding(input(name));
    if (!result.success) throw new Error(result.error);
    return result.id;
  };

  const buy = async (holdingId: string): Promise<void> => {
    const form: FundMovementFormInput = {
      type: 'INVESTMENT_PURCHASE',
      date: '2026-03-10',
      amount: '1000',
      nominals: '100',
      unitPrice: '10',
      description: `${PREFIX}Compra`,
      sourceFund: `BANK:${bankId}`,
      destinationFund: '',
      partnerId: '',
      holdingId,
    };
    const result = await createFundMovement(form, true);
    if (!result.success) throw new Error(result.error);
  };

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const mk = (code: string, type: 'ASSET' | 'EXPENSE') =>
      prisma.account.create({
        data: {
          companyId,
          code: `T793H-${code}`,
          name: `${PREFIX}${code}`,
          type,
          nature: 'DEBIT',
        },
        select: { id: true },
      });
    const [banco, tenencia, otra, gasto] = await Promise.all([
      mk('BANCO', 'ASSET'),
      mk('TENENCIA', 'ASSET'),
      mk('OTRA', 'ASSET'),
      mk('GASTO', 'EXPENSE'),
    ]);
    bankLedgerId = banco.id;
    holdingLedgerId = tenencia.id;
    otherLedgerId = otra.id;
    expenseLedgerId = gasto.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        lastEntryNumber: 0,
      },
    });

    const mkBank = async (accountNumber: string) =>
      (
        await prisma.bankAccount.create({
          data: {
            companyId,
            bankName: `${PREFIX}Broker`,
            accountNumber,
            accountType: 'BROKER',
            balance: 10000,
            status: 'ACTIVE',
            accountId: bankLedgerId,
          },
          select: { id: true },
        })
      ).id;
    bankId = await mkBank('T793H-1');
    otherBankId = await mkBank('T793H-2');

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    // Guarda: sin id, Prisma omitiría el filtro y borraría tablas enteras.
    if (companyId) {
      await prisma.bankMovement.deleteMany({ where: { companyId } });
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

  it('crea una tenencia válida, abierta y en cero', async () => {
    const id = await create('Alta');

    const row = await getInvestmentHoldingById(id);

    expect(row).toMatchObject({
      name: `${PREFIX}Alta`,
      status: 'OPEN',
      bankAccountId: bankId,
      bookValue: 0,
      nominals: null,
      averagePrice: null,
      movements: [],
    });
    expect(row?.account.code).toBe('T793H-TENENCIA');
  });

  it('rechaza una cuenta contable que no es de activo', async () => {
    const result = await createInvestmentHolding(input('Gasto', expenseLedgerId));

    expect(result).toEqual({
      success: false,
      error: 'La cuenta contable debe ser imputable y de tipo Activo',
    });
  });

  it('rechaza un vencimiento en un tipo que no lo tiene', async () => {
    const result = await createInvestmentHolding({
      ...input('Acción'),
      instrumentType: 'STOCK',
      maturityDate: '2027-01-01',
    });

    expect(result.success).toBe(false);
  });

  it('con movimientos: devuelve valor en libros y precio promedio, y no deja cambiar la cuenta', async () => {
    const id = await create('Con movimientos');
    await buy(id);

    const rows = await getInvestmentHoldings({ bankAccountId: bankId });
    const row = rows.find((r) => r.id === id);
    expect(row).toMatchObject({ bookValue: 1000, nominals: 100, averagePrice: 10 });

    const detail = await getInvestmentHoldingById(id);
    expect(detail?.movements).toHaveLength(1);
    expect(detail?.movements[0]).toMatchObject({
      kind: 'PURCHASE',
      amount: 1000,
      nominals: 100,
      result: null,
    });

    const changeAccount = await updateInvestmentHolding(
      id,
      input('Con movimientos', otherLedgerId)
    );
    expect(changeAccount).toEqual({
      success: false,
      error: 'La tenencia ya tiene movimientos: no se puede cambiar su cuenta',
    });
    const changeBank = await updateInvestmentHolding(id, {
      ...input('Con movimientos'),
      bankAccountId: otherBankId,
    });
    expect(changeBank.success).toBe(false);

    // El nombre sí se puede cambiar.
    const rename = await updateInvestmentHolding(id, input('Renombrada'));
    expect(rename.success).toBe(true);
  });

  it('rechaza el borrado de una tenencia con movimientos y borra una sin ellos', async () => {
    const withMovements = await create('Borrado con movimientos');
    await buy(withMovements);

    expect(await deleteInvestmentHolding(withMovements)).toEqual({
      success: false,
      error: 'La tenencia tiene movimientos y no se puede eliminar',
    });

    const empty = await create('Borrado vacía');
    expect(await deleteInvestmentHolding(empty)).toEqual({ success: true });
    expect(await prisma.investmentHolding.count({ where: { id: empty } })).toBe(0);
  });
});
