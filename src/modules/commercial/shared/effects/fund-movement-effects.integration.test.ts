/**
 * Tests de integración de los efectos del movimiento de fondo (TSK-792, Tarea 11),
 * contra la base real: `applyFundMovementEffectsTx` (vía `confirmFundMovement` y
 * directo, con `rewriteEntryId`), su inversa `revertFundMovementEffectsTx`, los
 * impedimentos propios de los efectos (`fundMovementEffectImpedimentsTx`) y la
 * escritura de datos (`writeFundMovementDataTx`, también vía `updateFundMovement`).
 *
 * Los movimientos se crean con el server action real (`createFundMovement`) y se
 * confirman con él mismo (`confirm = true`), que llama a `confirmFundMovement`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/modules/accounting/features/integrations/core';
import { prisma } from '@/shared/lib/prisma';

import type { FundMovementFormInput } from '@/modules/commercial/features/treasury/features/fund-movements/shared/validators';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { cleanupAccountingCompany } from '@/modules/accounting/shared/test-utils/cleanup-accounting-company';
import { readLastEntryNumber } from '@/modules/accounting/shared/test-utils/period-test-helpers';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

import {
  confirmFundMovement,
  createFundMovement,
  updateFundMovement,
} from '@/modules/commercial/features/treasury/features/fund-movements/list/actions.server';
import { impediments } from '../correction/impediments';
import { writeFundMovementDataTx } from './fund-movement-data.server';
import {
  applyFundMovementEffectsTx,
  fundMovementEffectImpedimentsTx,
  revertFundMovementEffectsTx,
} from './fund-movement.server';
import type { EffectsCtx } from './types';

const PREFIX = 'TSK792-MFFX-';
const DATE = '2026-06-10';
const DOC_LABEL = 'el MF de prueba';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const inTx = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction((tx) => fn(tx));

describe.skipIf(!dbAvailable)('integración: efectos del movimiento de fondo (TSK-792)', () => {
  let companyId: string;
  let otherCompanyId: string;
  let ctx: EffectsCtx;

  let bankAId: string;
  let bankBId: string;
  let cashId: string;
  let sessionId: string;
  let cashClosableId: string;
  let sessionClosableId: string;
  let partnerId: string;
  let chargeConceptId: string;
  let expenseAccountId: string;

  let otherBankId: string;
  let otherCashId: string;
  let otherPartnerId: string;
  let otherChargeConceptId: string;
  let otherContributionConceptId: string;

  // --- Armado de movimientos ------------------------------------------------

  const aporte = (amount = '1500', destinationFund = `BANK:${bankAId}`): FundMovementFormInput => ({
    type: 'PARTNER_CONTRIBUTION',
    date: DATE,
    amount,
    description: `${PREFIX}Aporte`,
    sourceFund: '',
    destinationFund,
    partnerId,
  });
  const retiro = (amount = '300', sourceFund = `CASH:${cashId}`): FundMovementFormInput => ({
    type: 'PARTNER_WITHDRAWAL',
    date: DATE,
    amount,
    description: `${PREFIX}Retiro`,
    sourceFund,
    destinationFund: '',
    partnerId,
  });
  const gastos = (amounts: string[] = ['120.50', '25.30']): FundMovementFormInput => ({
    type: 'BANK_CHARGES',
    date: DATE,
    description: `${PREFIX}Gastos`,
    sourceFund: `BANK:${bankAId}`,
    destinationFund: '',
    partnerId: '',
    lines: amounts.map((amount, i) => ({
      conceptId: chargeConceptId,
      description: i === 0 ? '' : `Detalle ${i}`,
      amount,
    })),
  });
  const transferencia = (
    amount = '1000',
    sourceFund = `BANK:${bankAId}`,
    destinationFund = `CASH:${cashId}`
  ): FundMovementFormInput => ({
    type: 'ACCOUNT_TRANSFER',
    date: DATE,
    amount,
    description: `${PREFIX}Transferencia`,
    sourceFund,
    destinationFund,
    partnerId: '',
  });

  async function draft(input: FundMovementFormInput): Promise<string> {
    const result = await createFundMovement(input);
    if (!result.success || !result.id) {
      throw new Error(`No se pudo crear el MF: ${result.success ? 'sin id' : result.error}`);
    }
    return result.id;
  }
  async function confirmed(input: FundMovementFormInput): Promise<string> {
    const result = await createFundMovement(input, true);
    if (!result.success || !result.id) {
      throw new Error(`No se pudo confirmar el MF: ${result.success ? 'sin id' : result.error}`);
    }
    return result.id;
  }

  // --- Lecturas --------------------------------------------------------------

  const bankBalance = async (id: string) =>
    Number(
      (await prisma.bankAccount.findUniqueOrThrow({ where: { id }, select: { balance: true } }))
        .balance
    );
  const expectedBalance = async (id: string) =>
    Number(
      (
        await prisma.cashRegisterSession.findUniqueOrThrow({
          where: { id },
          select: { expectedBalance: true },
        })
      ).expectedBalance
    );
  const balances = async () => ({
    bankA: await bankBalance(bankAId),
    bankB: await bankBalance(bankBId),
    cash: await expectedBalance(sessionId),
  });
  const movementState = (id: string) =>
    prisma.fundMovement.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        journalEntryId: true,
        journalEntryNumber: true,
        confirmedAt: true,
        conceptName: true,
      },
    });
  /** Todo lo que `writeFundMovementDataTx` podría tocar del MF, para ver que quedó igual. */
  const movementSnapshot = (id: string) =>
    prisma.fundMovement.findUniqueOrThrow({
      where: { id },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
  const linkedMovements = async (id: string) => ({
    bank: await prisma.bankMovement.count({ where: { fundMovementId: id } }),
    cash: await prisma.cashMovement.count({ where: { fundMovementId: id } }),
  });
  const impedimentsOf = (id: string) =>
    inTx((tx) => fundMovementEffectImpedimentsTx(tx, id, DOC_LABEL));

  beforeAll(async () => {
    const [company, other] = await Promise.all([
      prisma.company.create({ data: { name: `${PREFIX}Empresa`, isActive: true } }),
      prisma.company.create({ data: { name: `${PREFIX}Otra`, isActive: true } }),
    ]);
    companyId = company.id;
    otherCompanyId = other.id;
    ctx = { companyId, userId: 'test-user' };

    const mk = (code: string, type: 'ASSET' | 'EXPENSE' | 'EQUITY', company = companyId) =>
      prisma.account.create({
        data: {
          companyId: company,
          code: `T792M-${code}`,
          name: `${PREFIX}${code}`,
          type,
          nature: type === 'EQUITY' ? 'CREDIT' : 'DEBIT',
        },
        select: { id: true },
      });
    const [banco, caja, capital, gasto, gastoAjeno] = await Promise.all([
      mk('BANCO', 'ASSET'),
      mk('CAJA', 'ASSET'),
      mk('CAPITAL', 'EQUITY'),
      mk('GASTO', 'EXPENSE'),
      mk('GASTO-AJENO', 'EXPENSE', otherCompanyId),
    ]);
    expenseAccountId = gasto.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        lastEntryNumber: 0,
      },
    });

    const mkBank = (accountNumber: string, balance: number, company = companyId) =>
      prisma.bankAccount.create({
        data: {
          companyId: company,
          bankName: `${PREFIX}Banco ${accountNumber}`,
          accountNumber,
          accountType: 'CHECKING',
          balance,
          status: 'ACTIVE',
          accountId: company === companyId ? banco.id : null,
        },
        select: { id: true },
      });
    const mkCash = async (code: string, company = companyId) => {
      const register = await prisma.cashRegister.create({
        data: {
          companyId: company,
          code,
          name: `${PREFIX}Caja ${code}`,
          accountId: company === companyId ? caja.id : null,
          createdBy: 'test',
        },
        select: { id: true },
      });
      const session = await prisma.cashRegisterSession.create({
        data: {
          companyId: company,
          cashRegisterId: register.id,
          sessionNumber: 1,
          status: 'OPEN',
          openingBalance: 5000,
          expectedBalance: 5000,
          openedBy: 'test',
        },
        select: { id: true },
      });
      return { registerId: register.id, sessionId: session.id };
    };

    bankAId = (await mkBank('T792M-A', 100000)).id;
    bankBId = (await mkBank('T792M-B', 50000)).id;
    ({ registerId: cashId, sessionId } = await mkCash('T792M-C1'));
    ({ registerId: cashClosableId, sessionId: sessionClosableId } = await mkCash('T792M-C2'));

    partnerId = (
      await prisma.partner.create({
        data: {
          companyId,
          name: `${PREFIX}Socio`,
          contributionsAccountId: capital.id,
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;
    chargeConceptId = (
      await prisma.movementConcept.create({
        data: {
          companyId,
          name: `${PREFIX}Comisión`,
          usages: ['FUND_BANK_CHARGES'],
          accountMode: 'OWN_ACCOUNT',
          accountId: gasto.id,
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;

    // Otra empresa: un banco, una caja, un socio y conceptos que no son de la nuestra.
    otherBankId = (await mkBank('T792M-OTRO', 1000, otherCompanyId)).id;
    ({ registerId: otherCashId } = await mkCash('T792M-OTRA', otherCompanyId));
    otherPartnerId = (
      await prisma.partner.create({
        data: { companyId: otherCompanyId, name: `${PREFIX}Socio ajeno`, createdBy: 'test' },
        select: { id: true },
      })
    ).id;
    otherChargeConceptId = (
      await prisma.movementConcept.create({
        data: {
          companyId: otherCompanyId,
          name: `${PREFIX}Comisión ajena`,
          usages: ['FUND_BANK_CHARGES'],
          accountMode: 'OWN_ACCOUNT',
          accountId: gastoAjeno.id,
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;
    otherContributionConceptId = (
      await prisma.movementConcept.create({
        data: {
          companyId: otherCompanyId,
          name: `${PREFIX}Aporte ajeno`,
          usages: ['FUND_PARTNER_CONTRIBUTION'],
          accountMode: 'PARTNER_ACCOUNT',
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    // Guarda: sin ids, Prisma omitiría el filtro y borraría tablas enteras.
    const companyIds = [companyId, otherCompanyId].filter(Boolean);
    if (companyIds.length > 0) {
      const inCompanies = { companyId: { in: companyIds } };
      await prisma.cashMovement.deleteMany({ where: inCompanies });
      await prisma.cashRegisterSession.deleteMany({ where: inCompanies });
      await prisma.cashRegister.deleteMany({ where: inCompanies });
      await prisma.bankMovement.deleteMany({ where: inCompanies });
      await prisma.bankAccount.deleteMany({ where: inCompanies });
      // Las líneas caen en cascada con el movimiento.
      await prisma.fundMovement.deleteMany({ where: inCompanies });
      for (const id of companyIds) await cleanupAccountingCompany(id);
      await prisma.partner.deleteMany({ where: inCompanies });
      await prisma.movementConcept.deleteMany({ where: inCompanies });
      await prisma.accountingSettings.deleteMany({ where: inCompanies });
      await prisma.account.deleteMany({ where: inCompanies });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    await prisma.$disconnect();
  });

  describe('revert(apply)', () => {
    it.each([
      ['aporte al banco', () => aporte()],
      ['retiro de la caja', () => retiro()],
      ['gastos bancarios con conceptos', () => gastos()],
      ['transferencia banco → caja', () => transferencia()],
      [
        'transferencia banco → banco',
        () => transferencia('700', `BANK:${bankAId}`, `BANK:${bankBId}`),
      ],
      ['aporte a la caja', () => aporte('250', `CASH:${cashId}`)],
      ['retiro del banco', () => retiro('400', `BANK:${bankBId}`)],
    ])('revert(apply) de %s deja saldos como antes', async (_name, build) => {
      const before = await balances();
      const id = await confirmed(build());

      // apply movió algo
      expect(await balances()).not.toEqual(before);
      const stateBefore = await movementState(id);
      expect(stateBefore.status).toBe('CONFIRMED');
      expect(stateBefore.journalEntryId).not.toBeNull();

      await inTx((tx) => revertFundMovementEffectsTx(tx, ctx, id));

      expect(await balances()).toEqual(before);
      expect(await linkedMovements(id)).toEqual({ bank: 0, cash: 0 });
      // No toca el estado del MF ni su asiento (lo decide el motor).
      expect(await movementState(id)).toEqual(stateBefore);
    });

    it('revert de un MF en borrador no hace nada', async () => {
      const id = await draft(transferencia('100'));
      const before = await balances();

      await inTx((tx) => revertFundMovementEffectsTx(tx, ctx, id));

      expect(await balances()).toEqual(before);
      expect((await movementState(id)).status).toBe('DRAFT');
    });

    it('revert de un MF de otra empresa → BusinessError', async () => {
      const id = await confirmed(aporte('10'));
      await expect(
        inTx((tx) => revertFundMovementEffectsTx(tx, { ...ctx, companyId: otherCompanyId }, id))
      ).rejects.toMatchObject({ name: 'BusinessError', message: 'Movimiento no encontrado' });
      expect(await linkedMovements(id)).toEqual({ bank: 1, cash: 0 });
    });
  });

  describe('apply con rewriteEntryId', () => {
    it('gastos bancarios: conserva el número de asiento y mueve el banco una sola vez', async () => {
      const id = await confirmed(gastos(['100', '50.25']));
      const stateBefore = await movementState(id);
      const entryBefore = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: stateBefore.journalEntryId! },
        select: { number: true },
      });
      const lastNumberBefore = await readLastEntryNumber(companyId);
      const balancesBefore = await balances();

      const result = await inTx(async (tx) => {
        await revertFundMovementEffectsTx(tx, ctx, id);
        return applyFundMovementEffectsTx(tx, ctx, id, {
          rewriteEntryId: stateBefore.journalEntryId!,
        });
      });

      expect(result).toEqual({ journalEntryId: stateBefore.journalEntryId });
      expect(
        await prisma.journalEntry.findUniqueOrThrow({
          where: { id: stateBefore.journalEntryId! },
          select: { number: true, status: true },
        })
      ).toEqual({ number: entryBefore.number, status: 'DRAFT' });
      expect(await readLastEntryNumber(companyId)).toBe(lastNumberBefore);
      // Un débito por concepto y el crédito del banco
      expect(
        await prisma.journalEntryLine.count({ where: { entryId: stateBefore.journalEntryId! } })
      ).toBe(3);
      expect(await balances()).toEqual(balancesBefore);
      expect(await linkedMovements(id)).toEqual({ bank: 1, cash: 0 });
      expect(await movementState(id)).toEqual(stateBefore);
    });

    it('revert + escribir datos nuevos + apply reescribe el asiento con el importe nuevo', async () => {
      const before = await balances();
      const id = await confirmed(transferencia('1000'));
      const stateBefore = await movementState(id);
      const lastNumberBefore = await readLastEntryNumber(companyId);

      await inTx(async (tx) => {
        await revertFundMovementEffectsTx(tx, ctx, id);
        await writeFundMovementDataTx(tx, companyId, id, {
          ...transferencia('700'),
          description: `${PREFIX}Transferencia corregida`,
        });
        await applyFundMovementEffectsTx(tx, ctx, id, {
          rewriteEntryId: stateBefore.journalEntryId!,
        });
      });

      expect(await balances()).toEqual({
        bankA: before.bankA - 700,
        bankB: before.bankB,
        cash: before.cash + 700,
      });
      expect(await linkedMovements(id)).toEqual({ bank: 1, cash: 1 });
      expect(await readLastEntryNumber(companyId)).toBe(lastNumberBefore);
      const entry = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: stateBefore.journalEntryId! },
        select: {
          number: true,
          description: true,
          lines: { select: { debit: true, credit: true } },
        },
      });
      expect(entry.number).toBe(stateBefore.journalEntryNumber);
      expect(entry.description).toBe(`${PREFIX}Transferencia corregida`);
      expect(entry.lines.map((l) => Number(l.debit) + Number(l.credit))).toEqual([700, 700]);
      expect(await movementState(id)).toEqual(stateBefore);
    });
  });

  describe('impedimentos', () => {
    it('MF confirmado sin efectos usados → ninguno', async () => {
      const id = await confirmed(transferencia('10'));
      expect(await impedimentsOf(id)).toEqual([]);
    });

    it('MF en borrador → ninguno', async () => {
      const id = await draft(transferencia('10'));
      expect(await impedimentsOf(id)).toEqual([]);
    });

    it('banco conciliado → impedimento MANUAL', async () => {
      const id = await confirmed(gastos(['10']));
      await prisma.bankMovement.updateMany({
        where: { fundMovementId: id },
        data: { reconciled: true, reconciledAt: new Date(), reconciledBy: 'test' },
      });

      const found = await impedimentsOf(id);
      expect(found).toEqual([impediments.fundBankMovementReconciled(DOC_LABEL)]);
      expect(found[0].severity).toBe('MANUAL');
    });

    it('transferencia con los dos bancos conciliados → un solo impedimento', async () => {
      const id = await confirmed(transferencia('10', `BANK:${bankAId}`, `BANK:${bankBId}`));
      await prisma.bankMovement.updateMany({
        where: { fundMovementId: id },
        data: { reconciled: true },
      });
      expect(await impedimentsOf(id)).toEqual([impediments.fundBankMovementReconciled(DOC_LABEL)]);
    });

    it('caja de una sesión cerrada → cashSessionClosed', async () => {
      const id = await confirmed(retiro('10', `CASH:${cashClosableId}`));
      await prisma.cashRegisterSession.update({
        where: { id: sessionClosableId },
        data: { status: 'CLOSED', closedAt: new Date(), closedBy: 'test' },
      });

      const found = await impedimentsOf(id);
      expect(found).toEqual([impediments.cashSessionClosed(`${PREFIX}Caja T792M-C2`, DOC_LABEL)]);
      expect(found[0].severity).toBe('BLOCKED');
    });

    it('MF viejo sin vínculo al banco → untraceable', async () => {
      const id = await confirmed(aporte('10'));
      // Como un MF anterior a la trazabilidad que el backfill no pudo vincular.
      await prisma.bankMovement.updateMany({
        where: { fundMovementId: id },
        data: { fundMovementId: null },
      });
      expect(await impedimentsOf(id)).toEqual([impediments.untraceable(DOC_LABEL)]);
    });

    it('MF viejo sin vínculo a la caja → untraceable', async () => {
      const id = await confirmed(transferencia('10'));
      await prisma.cashMovement.updateMany({
        where: { fundMovementId: id },
        data: { fundMovementId: null },
      });
      expect(await impedimentsOf(id)).toEqual([impediments.untraceable(DOC_LABEL)]);
    });

    it('un movimiento de otra empresa vinculado al MF no cuenta', async () => {
      const id = await confirmed(aporte('10'));
      await prisma.bankMovement.updateMany({
        where: { fundMovementId: id },
        data: { fundMovementId: null },
      });
      await prisma.bankMovement.create({
        data: {
          companyId: otherCompanyId,
          bankAccountId: otherBankId,
          type: 'DEPOSIT',
          amount: 10,
          date: new Date(DATE),
          description: `${PREFIX}ajeno`,
          fundMovementId: id,
          reconciled: true,
          createdBy: 'test',
        },
      });
      expect(await impedimentsOf(id)).toEqual([impediments.untraceable(DOC_LABEL)]);
    });
  });

  describe('writeFundMovementDataTx', () => {
    it('reescribe los datos de un MF confirmado sin mover saldos ni tocar estado y asiento', async () => {
      const id = await confirmed(gastos(['80']));
      const stateBefore = await movementState(id);
      const before = await balances();

      await inTx((tx) =>
        writeFundMovementDataTx(tx, companyId, id, {
          ...gastos(['60', '15.55']),
          description: `${PREFIX}Gastos corregidos`,
        })
      );

      const after = await movementSnapshot(id);
      expect(Number(after.amount)).toBe(75.55);
      expect(after.description).toBe(`${PREFIX}Gastos corregidos`);
      expect(
        after.lines.map((l) => ({
          amount: Number(l.amount),
          conceptId: l.conceptId,
          accountId: l.accountId,
          conceptName: l.conceptName,
        }))
      ).toEqual([
        {
          amount: 60,
          conceptId: chargeConceptId,
          accountId: expenseAccountId,
          conceptName: `${PREFIX}Comisión`,
        },
        {
          amount: 15.55,
          conceptId: chargeConceptId,
          accountId: expenseAccountId,
          conceptName: `${PREFIX}Comisión`,
        },
      ]);
      expect(await movementState(id)).toEqual(stateBefore);
      expect(await balances()).toEqual(before);
    });

    it.each([
      [
        'un banco de otra empresa',
        () => aporte('20', `BANK:${otherBankId}`),
        'La cuenta bancaria seleccionada no es válida',
      ],
      [
        'una caja de otra empresa',
        () => transferencia('20', `BANK:${bankAId}`, `CASH:${otherCashId}`),
        'La caja seleccionada no es válida',
      ],
      [
        'un socio de otra empresa',
        () => ({ ...aporte('20'), partnerId: otherPartnerId }),
        'El socio seleccionado no es válido',
      ],
      [
        'un socio de otra empresa en una transferencia',
        () => ({ ...transferencia('20'), partnerId: otherPartnerId }),
        'El socio seleccionado no es válido',
      ],
      [
        'el concepto del movimiento de otra empresa',
        () => ({ ...aporte('20'), conceptId: otherContributionConceptId }),
        'El concepto elegido ya no existe. Elegí otro.',
      ],
      [
        'el concepto de una línea de otra empresa',
        () => ({
          ...gastos(['20']),
          lines: [{ conceptId: otherChargeConceptId, description: '', amount: '20' }],
        }),
        'El concepto elegido ya no existe. Elegí otro.',
      ],
    ])('rechaza %s y deja el MF igual', async (_name, build, message) => {
      const id = await confirmed(gastos(['33']));
      const before = await movementSnapshot(id);

      const attempt = inTx((tx) => writeFundMovementDataTx(tx, companyId, id, build()));
      await expect(attempt).rejects.toMatchObject({ name: 'BusinessError', message });

      expect(await movementSnapshot(id)).toEqual(before);
    });

    it('un MF de otra empresa → Movimiento no encontrado', async () => {
      const id = await confirmed(aporte('20'));
      const before = await movementSnapshot(id);
      await expect(
        inTx((tx) => writeFundMovementDataTx(tx, otherCompanyId, id, aporte('99')))
      ).rejects.toMatchObject({ name: 'BusinessError', message: 'Movimiento no encontrado' });
      expect(await movementSnapshot(id)).toEqual(before);
    });

    it('dos confirmaciones simultáneas aplican los efectos una sola vez (TSK-812)', async () => {
      const id = await draft(aporte('70'));
      const before = await balances();
      const lastNumberBefore = await readLastEntryNumber(companyId);

      const results = await Promise.all([confirmFundMovement(id), confirmFundMovement(id)]);

      expect(results.filter((r) => r.success)).toHaveLength(1);
      expect(results.filter((r) => !r.success)).toEqual([
        { success: false, error: 'El movimiento ya fue confirmado o anulado' },
      ]);
      expect(await balances()).toEqual({ ...before, bankA: before.bankA + 70 });
      expect(await linkedMovements(id)).toEqual({ bank: 1, cash: 0 });
      expect(await readLastEntryNumber(companyId)).toBe(lastNumberBefore + 1);
    });

    it('updateFundMovement edita un borrador y rechaza uno confirmado', async () => {
      const draftId = await draft(aporte('20'));
      expect(await updateFundMovement(draftId, aporte('25'))).toEqual({
        success: true,
        id: draftId,
      });
      expect(Number((await movementSnapshot(draftId)).amount)).toBe(25);

      const confirmedId = await confirmed(aporte('20'));
      expect(await updateFundMovement(confirmedId, aporte('25'))).toEqual({
        success: false,
        error: 'Solo se pueden editar movimientos en borrador',
      });
      expect(Number((await movementSnapshot(confirmedId)).amount)).toBe(20);
    });
  });
});
