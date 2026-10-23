/**
 * Tests de integración de los conceptos en el movimiento bancario manual
 * (TSK-791, Tarea 7) contra la base real de desarrollo.
 *
 * Mismo andamiaje que `bank-movement-period-lock.integration.test.ts`:
 * `describe.skipIf` sin base, prefijo propio (`TSK791-T7-`), `vi.mock` de la
 * frontera de sesión/permisos/caché de Next y limpieza + verificación en el
 * `afterAll`. Se ejercita el código real de `createBankMovement` y
 * `getBankMovementConcepts`.
 *
 * Qué se prueba:
 *  - La contrapartida del asiento es la cuenta del concepto y el movimiento
 *    guarda `conceptId` y el snapshot `conceptName`.
 *  - Un concepto que no aplica al tipo, desactivado o de otra empresa se
 *    rechaza sin dejar movimiento ni mover el saldo.
 *  - El catálogo del formulario viene indexado por tipo de movimiento.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ConceptUsage } from '@/generated/prisma/enums';
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
// Código real de producción.
import { createBankMovement, getBankMovementConcepts } from './actions.server';

const PREFIX = 'TSK791-T7-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

describe.skipIf(!dbAvailable)('integración: conceptos en el movimiento bancario (TSK-791)', () => {
  let companyId: string;
  let otherCompanyId: string;
  let bankLedgerId: string;
  let feeAccountId: string;
  let bankId: string;
  const concepts: Record<string, string> = {};

  async function createAccount(cid: string, code: string, name: string) {
    const a = await prisma.account.create({
      data: { companyId: cid, code, name: `${PREFIX}${name}`, type: 'ASSET', nature: 'DEBIT' },
      select: { id: true },
    });
    return a.id;
  }

  async function createConcept(
    key: string,
    usages: ConceptUsage[],
    opts: { accountId: string; companyId?: string; isActive?: boolean }
  ) {
    const c = await prisma.movementConcept.create({
      data: {
        companyId: opts.companyId ?? companyId,
        name: `${PREFIX}${key}`,
        usages,
        accountId: opts.accountId,
        isActive: opts.isActive ?? true,
        createdBy: `${PREFIX}user`,
      },
      select: { id: true },
    });
    concepts[key] = c.id;
  }

  async function balance(): Promise<number> {
    const b = await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId }, select: { balance: true } });
    return Number(b.balance);
  }

  const input = (description: string, type: 'FEE' | 'DEPOSIT', conceptId: string) => ({
    bankAccountId: bankId,
    type,
    amount: '100',
    date: day('2026-04-10'),
    description: `${PREFIX}${description}`,
    reference: null,
    statementNumber: null,
    conceptId,
  });

  beforeAll(async () => {
    companyId = (await prisma.company.create({ data: { name: `${PREFIX}Empresa`, isActive: true }, select: { id: true } })).id;
    otherCompanyId = (
      await prisma.company.create({ data: { name: `${PREFIX}Otra`, isActive: true }, select: { id: true } })
    ).id;

    bankLedgerId = await createAccount(companyId, 'T791B-BANCO', 'Banco');
    feeAccountId = await createAccount(companyId, 'T791B-COMISION', 'Cuenta de comisión');
    const otherAccountId = await createAccount(otherCompanyId, 'T791B-OTRA', 'Cuenta ajena');

    bankId = (
      await prisma.bankAccount.create({
        data: {
          companyId,
          bankName: `${PREFIX}Banco`,
          accountNumber: `${PREFIX}0001`,
          accountType: 'CHECKING',
          balance: 1000,
          status: 'ACTIVE',
          accountId: bankLedgerId,
        },
        select: { id: true },
      })
    ).id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01T03:00:00.000Z'),
        fiscalYearEnd: new Date('2026-12-31T03:00:00.000Z'),
        lastEntryNumber: 0,
      },
    });

    await createConcept('Comisión', ['BANK_FEE'], { accountId: feeAccountId });
    await createConcept('Inactivo', ['BANK_FEE'], { accountId: feeAccountId, isActive: false });
    await createConcept('Ajeno', ['BANK_FEE'], { accountId: otherAccountId, companyId: otherCompanyId });

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}user`);
  });

  afterAll(async () => {
    // Guarda: sin ids Prisma omitiría el filtro y borraría tablas enteras.
    for (const cid of [companyId, otherCompanyId]) {
      if (!cid) continue;
      await cleanupAccountingCompany(cid);
      await prisma.bankMovement.deleteMany({ where: { companyId: cid } });
      await prisma.bankAccount.deleteMany({ where: { companyId: cid } });
      await prisma.movementConcept.deleteMany({ where: { companyId: cid } });
      await prisma.accountingSettings.deleteMany({ where: { companyId: cid } });
      await prisma.account.deleteMany({ where: { companyId: cid } });
      await prisma.company.deleteMany({ where: { id: cid } });
    }
    const [companies, accounts, banks, movementConcepts, movements] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.bankAccount.count({ where: { bankName: { startsWith: PREFIX } } }),
      prisma.movementConcept.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.bankMovement.count({ where: { description: { startsWith: PREFIX } } }),
    ]);
    expect({ companies, accounts, banks, movementConcepts, movements }).toEqual({
      companies: 0,
      accounts: 0,
      banks: 0,
      movementConcepts: 0,
      movements: 0,
    });
  });

  it('registra comisión con la cuenta del concepto como contrapartida y guarda el snapshot', async () => {
    const before = await balance();
    const result = await createBankMovement(input('Comisión ok', 'FEE', concepts['Comisión']));
    expect(result).toMatchObject({ success: true });

    const movement = await prisma.bankMovement.findFirstOrThrow({
      where: { description: `${PREFIX}Comisión ok` },
      select: { conceptId: true, conceptName: true },
    });
    expect(movement).toEqual({ conceptId: concepts['Comisión'], conceptName: `${PREFIX}Comisión` });
    expect(await balance()).toBe(before - 100);

    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { companyId, description: { contains: `${PREFIX}Comisión ok` } },
      select: { lines: { select: { accountId: true, debit: true, credit: true } } },
    });
    const byAccount = Object.fromEntries(entry.lines.map((l) => [l.accountId, [Number(l.debit), Number(l.credit)]]));
    expect(byAccount[feeAccountId]).toEqual([100, 0]);
    expect(byAccount[bankLedgerId]).toEqual([0, 100]);
  });

  async function expectRejected(description: string, type: 'FEE' | 'DEPOSIT', conceptId: string, text: string) {
    const before = await balance();
    const result = await createBankMovement(input(description, type, conceptId));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain(text);
    expect(await prisma.bankMovement.count({ where: { description: `${PREFIX}${description}` } })).toBe(0);
    expect(await balance()).toBe(before);
  }

  it('rechaza concepto que no aplica al tipo', async () => {
    await expectRejected('Depósito con concepto de comisión', 'DEPOSIT', concepts['Comisión'], 'ya no aplica a Depósito');
  });

  it('rechaza concepto inactivo', async () => {
    await expectRejected('Con inactivo', 'FEE', concepts['Inactivo'], 'está desactivado');
  });

  it('rechaza concepto de otra empresa', async () => {
    await expectRejected('Con ajeno', 'FEE', concepts['Ajeno'], 'ya no existe');
  });

  it('getBankMovementConcepts devuelve los conceptos activos indexados por tipo', async () => {
    const catalog = await getBankMovementConcepts();
    expect(catalog.FEE.map((c) => c.id)).toEqual([concepts['Comisión']]);
    expect(catalog.DEPOSIT).toEqual([]);
    expect(Object.keys(catalog).sort()).toEqual(
      ['CHECK', 'DEBIT', 'DEPOSIT', 'FEE', 'INTEREST', 'TRANSFER_IN', 'TRANSFER_OUT', 'WITHDRAWAL']
    );
  });
});
