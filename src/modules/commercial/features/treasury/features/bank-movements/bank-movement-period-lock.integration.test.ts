/**
 * Tests de integración del período cerrado en movimientos bancarios manuales y
 * transferencias (TSK-760, fase 6) contra la base real de desarrollo.
 *
 * Mismo andamiaje que `depreciation-period-lock.integration.test.ts`
 * (`describe.skipIf` sin base, `vi.mock` de la frontera de sesión/permisos/caché
 * de Next y `server-only`), con prefijo PROPIO (`TSK760-BNK-`): Vitest corre los
 * archivos en paralelo y los `afterAll` cuentan por prefijo.
 *
 * Se ejercita el CÓDIGO REAL de `createBankMovement` y `createBankTransfer`.
 * Qué se prueba:
 * - mes abierto: el asiento nace DRAFT `'system'` con `fiscalYearId`/`periodId`
 *   del mes y número tomado del contador (atómico);
 * - mes cerrado por `AccountingPeriod` (B3): `{ success: false }` con el texto
 *   estándar, sin consumir número, sin grabar movimientos de banco/caja y sin
 *   tocar saldos;
 * - dos movimientos en paralelo no chocan en la numeración (B8);
 * - empresa sin Ajustes contables: el movimiento se graba sin asiento (decisión
 *   2.0 del plan, se conserva).
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// Frontera aislada: sesión/permisos/empresa activa/caché de Next.
vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', () => ({
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { cleanupAccountingCompany } from '@/modules/accounting/shared/test-utils/cleanup-accounting-company';
import {
  closeMonthForTest,
  readEntryPeriod,
  readLastEntryNumber,
} from '@/modules/accounting/shared/test-utils/period-test-helpers';
// Código real de producción.
import { createBankMovement, createBankTransfer } from './actions.server';

const PREFIX = 'TSK760-BNK-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const closedMessage = (day: string, month: string) =>
  `No se puede registrar con fecha ${day}: el período está cerrado (mes ${month} cerrado).`;

/** Mediodía UTC del día: el mismo día calendario en UTC y en UTC-3. */
const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

async function bankBalance(id: string): Promise<number> {
  const bank = await prisma.bankAccount.findUniqueOrThrow({ where: { id }, select: { balance: true } });
  return Number(bank.balance);
}

async function countBankMovements(description: string): Promise<number> {
  return prisma.bankMovement.count({ where: { description } });
}

/** Asiento generado por el movimiento: el único con esa descripción. */
async function findEntryId(companyId: string, descriptionContains: string): Promise<string> {
  const entries = await prisma.journalEntry.findMany({
    where: { companyId, description: { contains: descriptionContains } },
    select: { id: true },
  });
  expect(entries).toHaveLength(1);
  return entries[0].id;
}

describe.skipIf(!dbAvailable)('integración: período cerrado en bancos y transferencias (TSK-760)', () => {
  let companyId: string;
  let noSettingsCompanyId: string;

  let bank1LedgerId: string;
  let bank2LedgerId: string;
  let cashLedgerId: string;
  let expenseAccountId: string;

  let bank1Id: string;
  let bank2Id: string;
  let bank3Id: string;
  let cashRegisterId: string;
  let sessionId: string;

  let noSettingsBankId: string;
  let noSettingsExpenseId: string;

  async function createAccount(cid: string, code: string, name: string, type: 'ASSET' | 'EXPENSE') {
    const account = await prisma.account.create({
      data: {
        companyId: cid,
        code,
        name: `${PREFIX}${name}`,
        type,
        nature: 'DEBIT',
      },
      select: { id: true },
    });
    return account.id;
  }

  async function createBank(cid: string, number: string, accountId: string | null, balance = 1000000) {
    const bank = await prisma.bankAccount.create({
      data: {
        companyId: cid,
        bankName: `${PREFIX}Banco ${number}`,
        accountNumber: `${PREFIX}${number}`,
        accountType: 'CHECKING',
        balance,
        status: 'ACTIVE',
        accountId,
      },
      select: { id: true },
    });
    return bank.id;
  }

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
      select: { id: true },
    });
    companyId = company.id;
    const noSettings = await prisma.company.create({
      data: { name: `${PREFIX}Empresa sin Ajustes`, isActive: true },
      select: { id: true },
    });
    noSettingsCompanyId = noSettings.id;

    bank1LedgerId = await createAccount(companyId, 'T760B-BANCO1', 'Banco 1', 'ASSET');
    bank2LedgerId = await createAccount(companyId, 'T760B-BANCO2', 'Banco 2', 'ASSET');
    cashLedgerId = await createAccount(companyId, 'T760B-CAJA', 'Caja', 'ASSET');
    expenseAccountId = await createAccount(companyId, 'T760B-GASTO', 'Gastos bancarios', 'EXPENSE');
    noSettingsExpenseId = await createAccount(noSettingsCompanyId, 'T760B-GASTO', 'Gastos sin Ajustes', 'EXPENSE');
    const noSettingsLedgerId = await createAccount(noSettingsCompanyId, 'T760B-BANCO', 'Banco sin Ajustes', 'ASSET');

    bank1Id = await createBank(companyId, '0001', bank1LedgerId);
    bank2Id = await createBank(companyId, '0002', bank2LedgerId);
    bank3Id = await createBank(companyId, '0003', bank1LedgerId);
    noSettingsBankId = await createBank(noSettingsCompanyId, '0009', noSettingsLedgerId);

    const cash = await prisma.cashRegister.create({
      data: { companyId, code: `${PREFIX}CAJA`, name: `${PREFIX}Caja`, accountId: cashLedgerId },
      select: { id: true },
    });
    cashRegisterId = cash.id;
    const session = await prisma.cashRegisterSession.create({
      data: {
        companyId,
        cashRegisterId,
        sessionNumber: 1,
        openingBalance: 0,
        expectedBalance: 5000,
        openedBy: `${PREFIX}user`,
      },
      select: { id: true },
    });
    sessionId = session.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01T03:00:00.000Z'),
        fiscalYearEnd: new Date('2026-12-31T03:00:00.000Z'),
        lastEntryNumber: 0,
      },
    });

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}user`);
  });

  afterAll(async () => {
    // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
    for (const cid of [companyId, noSettingsCompanyId]) {
      if (!cid) continue;
      await cleanupAccountingCompany(cid);
      await prisma.cashMovement.deleteMany({ where: { companyId: cid } });
      await prisma.cashRegisterSession.deleteMany({ where: { companyId: cid } });
      await prisma.cashRegister.deleteMany({ where: { companyId: cid } });
      await prisma.bankMovement.deleteMany({ where: { companyId: cid } });
      await prisma.bankAccount.deleteMany({ where: { companyId: cid } });
      await prisma.accountingSettings.deleteMany({ where: { companyId: cid } });
      await prisma.account.deleteMany({ where: { companyId: cid } });
      await prisma.company.deleteMany({ where: { id: cid } });
    }

    const [companies, accounts, banks, fiscalYears] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.bankAccount.count({ where: { bankName: { startsWith: PREFIX } } }),
      prisma.fiscalYear.count({ where: { companyId: { in: [companyId, noSettingsCompanyId] } } }),
    ]);
    expect(companies).toBe(0);
    expect(accounts).toBe(0);
    expect(banks).toBe(0);
    expect(fiscalYears).toBe(0);
  });

  describe('movimiento bancario manual', () => {
    it('mes abierto: graba el movimiento y un asiento DRAFT con ejercicio, período y número atómico', async () => {
      const before = await readLastEntryNumber(companyId);
      const description = `${PREFIX}Comisión abril`;

      const result = await createBankMovement({
        bankAccountId: bank1Id,
        type: 'FEE',
        amount: '150.25',
        date: day('2026-04-10'),
        description,
        reference: null,
        statementNumber: null,
        accountId: expenseAccountId,
      });

      expect(result).toMatchObject({ success: true });
      expect(await countBankMovements(description)).toBe(1);
      expect(await bankBalance(bank1Id)).toBe(1000000 - 150.25);

      const entry = await readEntryPeriod(await findEntryId(companyId, description));
      expect(entry).toMatchObject({
        number: before + 1,
        status: 'DRAFT',
        createdBy: 'system',
        period: { year: 2026, month: 4, type: 'MONTHLY' },
      });
      expect(entry.fiscalYearId).toBeTruthy();
      expect(entry.periodId).toBeTruthy();
      expect(await readLastEntryNumber(companyId)).toBe(before + 1);
    });

    it('mes cerrado: rechaza con el texto estándar sin grabar el movimiento, ni tocar el saldo, ni consumir número', async () => {
      const reopen = await closeMonthForTest(companyId, day('2026-05-12'));
      try {
        const before = await readLastEntryNumber(companyId);
        const balanceBefore = await bankBalance(bank1Id);
        const description = `${PREFIX}Comisión mayo cerrado`;

        const result = await createBankMovement({
          bankAccountId: bank1Id,
          type: 'DEPOSIT',
          amount: '300',
          date: day('2026-05-12'),
          description,
          reference: null,
          statementNumber: null,
          accountId: expenseAccountId,
        });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain(closedMessage('12/05/2026', '05/2026'));
        expect(await countBankMovements(description)).toBe(0);
        expect(await bankBalance(bank1Id)).toBe(balanceBefore);
        expect(await readLastEntryNumber(companyId)).toBe(before);
      } finally {
        await reopen();
      }
    });

    it('dos movimientos en paralelo no chocan en la numeración', async () => {
      const before = await readLastEntryNumber(companyId);
      const results = await Promise.all(
        [bank2Id, bank3Id].map((bankAccountId, i) =>
          createBankMovement({
            bankAccountId,
            type: 'FEE',
            amount: '10',
            date: day('2026-04-20'),
            description: `${PREFIX}Paralelo ${i}`,
            reference: null,
            statementNumber: null,
            accountId: expenseAccountId,
          })
        )
      );

      expect(results.every((r) => r.success)).toBe(true);
      const numbers = await prisma.journalEntry.findMany({
        where: { companyId, description: { contains: `${PREFIX}Paralelo` } },
        select: { number: true },
        orderBy: { number: 'asc' },
      });
      expect(numbers.map((n) => n.number)).toEqual([before + 1, before + 2]);
      expect(await readLastEntryNumber(companyId)).toBe(before + 2);
    });

    it('empresa sin Ajustes contables: graba el movimiento sin asiento (se conserva)', async () => {
      vi.mocked(getActiveCompanyId).mockResolvedValueOnce(noSettingsCompanyId);
      const description = `${PREFIX}Sin Ajustes`;

      const result = await createBankMovement({
        bankAccountId: noSettingsBankId,
        type: 'FEE',
        amount: '50',
        date: day('2026-05-12'),
        description,
        reference: null,
        statementNumber: null,
        accountId: noSettingsExpenseId,
      });

      expect(result).toMatchObject({ success: true });
      expect(await countBankMovements(description)).toBe(1);
      expect(await bankBalance(noSettingsBankId)).toBe(1000000 - 50);
      expect(await prisma.journalEntry.count({ where: { companyId: noSettingsCompanyId } })).toBe(0);
    });
  });

  describe('transferencia banco → banco', () => {
    it('mes abierto: mueve los saldos y genera el asiento con ejercicio, período y número', async () => {
      const before = await readLastEntryNumber(companyId);
      const [b1, b2] = [await bankBalance(bank1Id), await bankBalance(bank2Id)];
      const description = `${PREFIX}Transferencia abierta`;

      const result = await createBankTransfer({
        sourceBankAccountId: bank1Id,
        destinationType: 'BANK',
        destinationBankAccountId: bank2Id,
        destinationCashRegisterId: null,
        amount: '1000',
        date: day('2026-04-15'),
        description,
        reference: null,
      });

      expect(result).toMatchObject({ success: true });
      expect(await countBankMovements(description)).toBe(2);
      expect(await bankBalance(bank1Id)).toBe(b1 - 1000);
      expect(await bankBalance(bank2Id)).toBe(b2 + 1000);

      const entry = await readEntryPeriod(await findEntryId(companyId, description));
      expect(entry).toMatchObject({
        number: before + 1,
        status: 'DRAFT',
        createdBy: 'system',
        period: { year: 2026, month: 4, type: 'MONTHLY' },
      });
      expect(entry.fiscalYearId).toBeTruthy();
    });

    it('mes cerrado: rechaza sin movimientos, sin cambiar saldos ni consumir número', async () => {
      const reopen = await closeMonthForTest(companyId, day('2026-05-12'));
      try {
        const before = await readLastEntryNumber(companyId);
        const [b1, b2] = [await bankBalance(bank1Id), await bankBalance(bank2Id)];
        const description = `${PREFIX}Transferencia cerrada`;

        const result = await createBankTransfer({
          sourceBankAccountId: bank1Id,
          destinationType: 'BANK',
          destinationBankAccountId: bank2Id,
          destinationCashRegisterId: null,
          amount: '1000',
          date: day('2026-05-12'),
          description,
          reference: null,
        });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain(closedMessage('12/05/2026', '05/2026'));
        expect(await countBankMovements(description)).toBe(0);
        expect(await bankBalance(bank1Id)).toBe(b1);
        expect(await bankBalance(bank2Id)).toBe(b2);
        expect(await readLastEntryNumber(companyId)).toBe(before);
      } finally {
        await reopen();
      }
    });
  });

  describe('transferencia banco → caja', () => {
    async function sessionBalance(): Promise<number> {
      const s = await prisma.cashRegisterSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { expectedBalance: true },
      });
      return Number(s.expectedBalance);
    }

    it('mes abierto: mueve banco y caja y genera el asiento con ejercicio, período y número', async () => {
      const before = await readLastEntryNumber(companyId);
      const [b1, cash] = [await bankBalance(bank1Id), await sessionBalance()];
      const description = `${PREFIX}A caja abierta`;

      const result = await createBankTransfer({
        sourceBankAccountId: bank1Id,
        destinationType: 'CASH',
        destinationBankAccountId: null,
        destinationCashRegisterId: cashRegisterId,
        amount: '400',
        date: day('2026-04-16'),
        description,
        reference: null,
      });

      expect(result).toMatchObject({ success: true });
      expect(await countBankMovements(description)).toBe(1);
      expect(await prisma.cashMovement.count({ where: { description } })).toBe(1);
      expect(await bankBalance(bank1Id)).toBe(b1 - 400);
      expect(await sessionBalance()).toBe(cash + 400);

      const entry = await readEntryPeriod(await findEntryId(companyId, description));
      expect(entry).toMatchObject({
        number: before + 1,
        status: 'DRAFT',
        createdBy: 'system',
        period: { year: 2026, month: 4, type: 'MONTHLY' },
      });
    });

    it('mes cerrado: rechaza sin movimiento de banco ni de caja y sin cambiar saldos', async () => {
      const reopen = await closeMonthForTest(companyId, day('2026-05-12'));
      try {
        const before = await readLastEntryNumber(companyId);
        const [b1, cash] = [await bankBalance(bank1Id), await sessionBalance()];
        const description = `${PREFIX}A caja cerrada`;

        const result = await createBankTransfer({
          sourceBankAccountId: bank1Id,
          destinationType: 'CASH',
          destinationBankAccountId: null,
          destinationCashRegisterId: cashRegisterId,
          amount: '400',
          date: day('2026-05-12'),
          description,
          reference: null,
        });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain(closedMessage('12/05/2026', '05/2026'));
        expect(await countBankMovements(description)).toBe(0);
        expect(await prisma.cashMovement.count({ where: { description } })).toBe(0);
        expect(await bankBalance(bank1Id)).toBe(b1);
        expect(await sessionBalance()).toBe(cash);
        expect(await readLastEntryNumber(companyId)).toBe(before);
      } finally {
        await reopen();
      }
    });
  });
});
