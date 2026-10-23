/**
 * Tests de integración de "Volver a borrador" un asiento registrado (TSK-792, Tarea 3)
 * contra la base real (`contable-pms-db`). Código real: `revertJournalEntryToDraft` y
 * `getRevertToDraftCheck` (`ActionResult`). Empresas propias con prefijo `TSK792-RD-`.
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
vi.mock('../../shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/utils')>()),
  revalidateAccountingRoutes: vi.fn(),
}));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { checkPermission } from '@/shared/lib/permissions';
import { Prisma } from '@/generated/prisma/client';

import { cleanupAccountingCompany } from '../../shared/test-utils/cleanup-accounting-company';
import { closeMonthForTest, readLastEntryNumber } from '../../shared/test-utils/period-test-helpers';
import { createJournalEntryTx, reverseJournalEntryTx } from '../../shared/utils/journal-entry-tx';
import { getRevertToDraftCheck, revertJournalEntryToDraft } from './actions.server';

const PREFIX = 'TSK792-RD-';
const USER = 'test-user';
const MARCH_10 = new Date('2026-03-10T00:00:00.000Z');

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
  capitalId: string;
  supplierId: string;
}

describe.skipIf(!dbAvailable)('volver un asiento registrado a borrador (TSK-792, Tarea 3)', () => {
  const companyIds: string[] = [];
  let main: TestCompany;
  let other: TestCompany;

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
    const [caja, capital] = await Promise.all([
      account('T792-CAJA', 'Caja'),
      account('T792-CAP', 'Capital', { type: 'EQUITY', nature: 'CREDIT' }),
    ]);
    const [supplier] = await Promise.all([
      prisma.supplier.create({
        data: {
          companyId,
          code: 'T792',
          businessName: `${PREFIX}Proveedor`,
          taxId: '20111111113',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: USER,
        },
        select: { id: true },
      }),
      prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01T03:00:00.000Z'),
          fiscalYearEnd: new Date('2026-12-31T03:00:00.000Z'),
        },
      }),
    ]);
    return { companyId, cajaId: caja.id, capitalId: capital.id, supplierId: supplier.id };
  }

  const seedEntry = (c: TestCompany, status: 'DRAFT' | 'POSTED' = 'POSTED') =>
    prisma.$transaction((tx) =>
      createJournalEntryTx(tx, {
        companyId: c.companyId,
        date: MARCH_10,
        description: `${PREFIX}asiento`,
        status,
        createdBy: USER,
        lines: [
          { accountId: c.cajaId, debit: new Prisma.Decimal('800.00'), credit: 0 },
          { accountId: c.capitalId, debit: 0, credit: new Prisma.Decimal('800.00') },
        ],
      })
    );

  const readEntry = (id: string) =>
    prisma.journalEntry.findUniqueOrThrow({
      where: { id },
      select: {
        number: true,
        status: true,
        postDate: true,
        revertedToDraftAt: true,
        revertedToDraftBy: true,
        lines: { select: { accountId: true, debit: true, credit: true } },
      },
    });

  beforeAll(async () => {
    main = await setupCompany('Principal');
    other = await setupCompany('Otra');
  });

  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(USER);
    vi.mocked(getActiveCompanyId).mockResolvedValue(main.companyId);
  });

  afterAll(async () => {
    for (const companyId of companyIds) {
      await prisma.fiscalYear.updateMany({ where: { companyId }, data: { closingEntryId: null, openingEntryId: null } });
      await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
      await cleanupAccountingCompany(companyId);
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    const [companies, entries] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.journalEntry.count({ where: { description: { contains: PREFIX } } }),
    ]);
    expect(companies).toBe(0);
    expect(entries).toBe(0);
  });

  it('vuelve a borrador un asiento registrado y conserva número y líneas', async () => {
    const entry = await seedEntry(main);
    const before = await readEntry(entry.id);
    expect(before.status).toBe('POSTED');
    expect(before.postDate).not.toBeNull();

    const result = await revertJournalEntryToDraft(entry.id);

    expect(result).toEqual({ success: true, number: entry.number });
    expect(checkPermission).toHaveBeenCalledWith('accounting.entries', 'approve', { redirect: true });
    const after = await readEntry(entry.id);
    expect(after.status).toBe('DRAFT');
    expect(after.number).toBe(entry.number);
    expect(after.postDate).toBeNull();
    expect(after.revertedToDraftBy).toBe(USER);
    expect(after.revertedToDraftAt).not.toBeNull();
    expect(after.lines).toHaveLength(2);
    expect(after.lines.map((l) => Number(l.debit) + Number(l.credit)).sort()).toEqual([800, 800]);
  });

  it('rechaza un asiento en borrador', async () => {
    const entry = await seedEntry(main, 'DRAFT');

    const result = await revertJournalEntryToDraft(entry.id);

    expect(result).toEqual({ success: false, error: `El asiento N° ${entry.number} no está registrado.` });
  });

  it('rechaza período cerrado, nombrando el asiento y sin tocarlo', async () => {
    const entry = await seedEntry(main);
    const reopen = await closeMonthForTest(main.companyId, MARCH_10);
    const lastNumber = await readLastEntryNumber(main.companyId);

    const result = await revertJournalEntryToDraft(entry.id).finally(reopen);

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining(
        `No se puede volver a borrador el asiento N° ${entry.number} (fecha 10/03/2026): el período está cerrado`
      ),
    });
    expect((await readEntry(entry.id)).status).toBe('POSTED');
    expect(await readLastEntryNumber(main.companyId)).toBe(lastNumber);
  });

  it('rechaza la refundición y la apertura de un ejercicio', async () => {
    const closing = await seedEntry(main);
    const opening = await seedEntry(main);
    const fiscalYear = await prisma.fiscalYear.findFirstOrThrow({
      where: { companyId: main.companyId },
      select: { id: true },
    });
    await prisma.fiscalYear.update({
      where: { id: fiscalYear.id },
      data: { closingEntryId: closing.id, openingEntryId: opening.id },
    });

    try {
      for (const entry of [closing, opening]) {
        expect(await revertJournalEntryToDraft(entry.id)).toEqual({
          success: false,
          error: `El asiento N° ${entry.number} es del cierre de ejercicio y no se puede volver a borrador.`,
        });
        expect((await readEntry(entry.id)).status).toBe('POSTED');
      }
      const check = await getRevertToDraftCheck(closing.id);
      expect(check).toMatchObject({ success: true, blockedMessage: expect.stringContaining('cierre de ejercicio') });
    } finally {
      await prisma.fiscalYear.update({
        where: { id: fiscalYear.id },
        data: { closingEntryId: null, openingEntryId: null },
      });
    }
  });

  it('rechaza un contraasiento y un asiento anulado', async () => {
    const original = await seedEntry(main);
    const { reversal } = await prisma.$transaction((tx) =>
      reverseJournalEntryTx(tx, { companyId: main.companyId, entryId: original.id, date: MARCH_10, createdBy: USER })
    );

    expect(await revertJournalEntryToDraft(reversal.id)).toEqual({
      success: false,
      error: `El asiento N° ${reversal.number} es la anulación de otro asiento y no se puede volver a borrador.`,
    });
    expect(await revertJournalEntryToDraft(original.id)).toEqual({
      success: false,
      error: `El asiento N° ${original.number} no está registrado.`,
    });
    expect((await readEntry(reversal.id)).status).toBe('POSTED');
    expect(await getRevertToDraftCheck(reversal.id)).toMatchObject({
      success: true,
      blockedMessage: expect.stringContaining('anulación de otro asiento'),
    });
  });

  it('rechaza el asiento de otra empresa', async () => {
    const foreign = await seedEntry(other);

    expect(await revertJournalEntryToDraft(foreign.id)).toEqual({ success: false, error: 'Asiento no encontrado.' });
    expect((await readEntry(foreign.id)).status).toBe('POSTED');
  });

  it('getRevertToDraftCheck devuelve el vínculo del documento', async () => {
    const entry = await seedEntry(main);
    await prisma.purchaseInvoice.create({
      data: {
        companyId: main.companyId,
        supplierId: main.supplierId,
        voucherType: 'FACTURA_A',
        pointOfSale: '0001',
        number: '792',
        fullNumber: '0001-00000792',
        issueDate: MARCH_10,
        status: 'CONFIRMED',
        journalEntryId: entry.id,
        createdBy: USER,
      },
    });
    const manual = await seedEntry(main);

    const linked = await getRevertToDraftCheck(entry.id);
    const free = await getRevertToDraftCheck(manual.id);

    expect(linked).toMatchObject({
      success: true,
      blockedMessage: null,
      link: { kind: 'PURCHASE_INVOICE', label: 'la factura de compra 0001-00000792' },
    });
    expect(free).toEqual({ success: true, link: null, blockedMessage: null });
  });
});
