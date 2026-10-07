/**
 * Tests de integración de la anulación desde Asientos y de "Eliminar borrador"
 * (TSK-760, Fase 10: B10, D5, D6, C6) contra la base real (`contable-pms-db`).
 *
 * Código real: `reverseJournalEntry`, `getReversalCheck` y `deleteDraftJournalEntry`
 * (`ActionResult`), que usan `getEntryDocumentLink` y `reverseJournalEntryTx`.
 *
 * La fecha de "hoy" se fija en 06/10/2026 15:00Z (solo `Date` falso) para que el
 * test no dependa del día en que corre. Empresas propias con prefijo `TSK760-RV-`.
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
import { entriesWithoutDocumentWhere } from '../../shared/utils/entry-document-link';
import { createJournalEntryTx } from '../../shared/utils/journal-entry-tx';
import { deleteDraftJournalEntry, getReversalCheck, reverseJournalEntry } from './actions.server';

const PREFIX = 'TSK760-RV-';
const USER = 'test-user';
const NOW = new Date('2026-10-06T15:00:00.000Z');
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
  proveedoresId: string;
  gastosId: string;
  supplierId: string;
  costCenterId: string;
  categoryId: string;
}

describe.skipIf(!dbAvailable)('anular y eliminar desde Asientos (TSK-760, Fase 10)', () => {
  const companyIds: string[] = [];
  let main: TestCompany;
  let other: TestCompany;
  let docSeq = 0;

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
    const [caja, proveedores, gastos] = await Promise.all([
      account('T760-CAJA', 'Caja'),
      account('T760-PROV', 'Proveedores', { type: 'LIABILITY', nature: 'CREDIT', requiresAuxiliary: 'SUPPLIER' }),
      account('T760-GASTOS', 'Gastos', { type: 'EXPENSE', requiresAuxiliary: 'COST_CENTER' }),
    ]);
    const [supplier, costCenter, category] = await Promise.all([
      prisma.supplier.create({
        data: {
          companyId,
          code: 'T760',
          businessName: `${PREFIX}Proveedor`,
          taxId: '20111111112',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: USER,
        },
        select: { id: true },
      }),
      prisma.costCenter.create({ data: { companyId, name: `${PREFIX}Logística` }, select: { id: true } }),
      prisma.expenseCategory.create({ data: { companyId, name: `${PREFIX}Varios` }, select: { id: true } }),
      prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01T03:00:00.000Z'),
          fiscalYearEnd: new Date('2026-12-31T03:00:00.000Z'),
        },
      }),
    ]);
    return {
      companyId,
      cajaId: caja.id,
      proveedoresId: proveedores.id,
      gastosId: gastos.id,
      supplierId: supplier.id,
      costCenterId: costCenter.id,
      categoryId: category.id,
    };
  }

  /** Asiento con todas las columnas de línea (auxiliar, centro de costo y moneda). */
  async function seedEntry(
    c: TestCompany,
    opts: { status?: 'DRAFT' | 'POSTED'; createdBy?: string; date?: Date } = {}
  ) {
    return prisma.$transaction((tx) =>
      createJournalEntryTx(tx, {
        companyId: c.companyId,
        date: opts.date ?? MARCH_10,
        description: `${PREFIX}asiento`,
        status: opts.status ?? 'POSTED',
        createdBy: opts.createdBy ?? USER,
        lines: [
          {
            accountId: c.gastosId,
            debit: new Prisma.Decimal('1500.00'),
            credit: 0,
            description: 'gasto en dólares',
            costCenterId: c.costCenterId,
            currency: 'USD',
            originalAmount: new Prisma.Decimal('1.50'),
            exchangeRate: new Prisma.Decimal('1000'),
          },
          {
            accountId: c.proveedoresId,
            debit: 0,
            credit: new Prisma.Decimal('1500.00'),
            supplierId: c.supplierId,
          },
        ],
      })
    );
  }

  const linkPurchaseInvoice = async (c: TestCompany, entryId: string) => {
    docSeq += 1;
    const fullNumber = `0001-${String(docSeq).padStart(8, '0')}`;
    await prisma.purchaseInvoice.create({
      data: {
        companyId: c.companyId,
        supplierId: c.supplierId,
        voucherType: 'FACTURA_A',
        pointOfSale: '0001',
        number: String(docSeq),
        fullNumber,
        issueDate: MARCH_10,
        status: 'CONFIRMED',
        journalEntryId: entryId,
        createdBy: USER,
      },
    });
    return fullNumber;
  };

  const linkFundMovement = (c: TestCompany, entryId: string) =>
    prisma.fundMovement.create({
      data: {
        companyId: c.companyId,
        status: 'CONFIRMED',
        date: MARCH_10,
        type: 'PARTNER_CONTRIBUTION',
        amount: 1500,
        description: 'Aporte de socio',
        journalEntryId: entryId,
        createdBy: USER,
      },
    });

  const statusOf = async (id: string) =>
    (await prisma.journalEntry.findUnique({ where: { id }, select: { status: true } }))?.status ?? null;

  const asCompany = (c: TestCompany) => vi.mocked(getActiveCompanyId).mockResolvedValue(c.companyId);

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    main = await setupCompany('Principal');
    other = await setupCompany('Otra');
  });

  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(USER);
    asCompany(main);
  });

  afterAll(async () => {
    vi.useRealTimers();
    for (const companyId of companyIds) {
      await prisma.fundMovement.deleteMany({ where: { companyId } });
      await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
      await prisma.expense.deleteMany({ where: { companyId } });
      await cleanupAccountingCompany(companyId);
      await prisma.expenseCategory.deleteMany({ where: { companyId } });
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.costCenter.deleteMany({ where: { companyId } });
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

  describe('reverseJournalEntry', () => {
    it('anula un manual con fecha de hoy, copiando auxiliares, centro de costo y moneda (B10, D5)', async () => {
      const original = await seedEntry(main);

      const result = await reverseJournalEntry({ entryId: original.id });

      expect(result).toEqual({ success: true, reversalNumber: original.number + 1 });
      expect(checkPermission).toHaveBeenCalledWith('accounting.entries', 'approve', { redirect: true });
      const after = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: original.id },
        select: { status: true, reversedBy: true, reversalEntry: { select: { id: true } } },
      });
      expect(after.status).toBe('REVERSED');
      expect(after.reversedBy).toBe(USER);
      const reversal = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: after.reversalEntry?.id },
        select: {
          number: true,
          date: true,
          status: true,
          originalEntryId: true,
          period: { select: { type: true, year: true, month: true } },
          lines: {
            orderBy: { accountId: 'asc' },
            select: {
              accountId: true,
              debit: true,
              credit: true,
              supplierId: true,
              costCenterId: true,
              currency: true,
              originalAmount: true,
              exchangeRate: true,
            },
          },
        },
      });
      expect(reversal.date.toISOString()).toBe('2026-10-06T00:00:00.000Z');
      expect(reversal.status).toBe('POSTED');
      expect(reversal.originalEntryId).toBe(original.id);
      expect(reversal.period).toEqual({ type: 'MONTHLY', year: 2026, month: 10 });
      const byAccount = new Map(reversal.lines.map((line) => [line.accountId, line]));
      const gasto = byAccount.get(main.gastosId);
      const proveedor = byAccount.get(main.proveedoresId);
      expect(Number(gasto?.debit)).toBe(0);
      expect(Number(gasto?.credit)).toBe(1500);
      expect(gasto?.costCenterId).toBe(main.costCenterId);
      expect(gasto?.currency).toBe('USD');
      expect(Number(gasto?.originalAmount)).toBe(1.5);
      expect(Number(gasto?.exchangeRate)).toBe(1000);
      expect(Number(proveedor?.debit)).toBe(1500);
      expect(proveedor?.supplierId).toBe(main.supplierId);
    });

    it('rechaza si el mes del original está cerrado, nombrando el asiento, sin consumir número', async () => {
      const original = await seedEntry(main);
      const reopen = await closeMonthForTest(main.companyId, MARCH_10);
      const before = await readLastEntryNumber(main.companyId);

      const result = await reverseJournalEntry({ entryId: original.id }).finally(reopen);

      expect(result).toEqual({
        success: false,
        error:
          `No se puede anular el asiento N° ${original.number} (fecha 10/03/2026): el período está ` +
          'cerrado (mes 03/2026 cerrado). Para operar, reabrilo desde Contabilidad → Configuración → ' +
          'Bloqueo de Períodos.',
      });
      expect(await statusOf(original.id)).toBe('POSTED');
      expect(await readLastEntryNumber(main.companyId)).toBe(before);
    });

    it('rechaza si el mes de hoy (fecha de la reversión) está cerrado', async () => {
      const original = await seedEntry(main);
      const reopen = await closeMonthForTest(main.companyId, NOW);

      const result = await reverseJournalEntry({ entryId: original.id }).finally(reopen);

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining(
          'No se puede registrar con fecha 06/10/2026: el período está cerrado (mes 10/2026 cerrado).'
        ),
      });
      expect(await statusOf(original.id)).toBe('POSTED');
    });

    it('rechaza el asiento de una factura de compra nombrando el comprobante (D6)', async () => {
      const original = await seedEntry(main, { createdBy: 'system' });
      const fullNumber = await linkPurchaseInvoice(main, original.id);

      const result = await reverseJournalEntry({ entryId: original.id });

      expect(result).toEqual({
        success: false,
        error:
          `Este asiento pertenece a la factura de compra ${fullNumber} y no se puede anular desde ` +
          'Asientos: anulá el comprobante.',
      });
      expect(await statusOf(original.id)).toBe('POSTED');
    });

    it('rechaza el asiento de un egreso', async () => {
      const original = await seedEntry(main, { createdBy: 'system' });
      await prisma.expense.create({
        data: {
          companyId: main.companyId,
          number: 7,
          fullNumber: 'GTO-00007',
          description: `${PREFIX}egreso`,
          amount: 1500,
          date: MARCH_10,
          status: 'CONFIRMED',
          categoryId: main.categoryId,
          journalEntryId: original.id,
          createdBy: USER,
        },
      });

      expect(await reverseJournalEntry({ entryId: original.id })).toEqual({
        success: false,
        error: 'Este asiento pertenece al egreso GTO-00007 y no se puede anular desde Asientos: anulá el comprobante.',
      });
    });

    it('rechaza el asiento de un movimiento de fondos (columna sin relación)', async () => {
      const original = await seedEntry(main, { createdBy: 'system' });
      await linkFundMovement(main, original.id);

      expect(await reverseJournalEntry({ entryId: original.id })).toEqual({
        success: false,
        error:
          'Este asiento pertenece al movimiento de fondos "Aporte de socio" y no se puede anular desde ' +
          'Asientos: anulá el comprobante.',
      });
      expect(await statusOf(original.id)).toBe('POSTED');
    });

    it('rechaza la refundición de un ejercicio', async () => {
      const original = await seedEntry(main, { createdBy: 'system' });
      const fy = await prisma.fiscalYear.findFirstOrThrow({
        where: { companyId: main.companyId, number: 1 },
        select: { id: true },
      });
      await prisma.fiscalYear.update({ where: { id: fy.id }, data: { closingEntryId: original.id } });

      const result = await reverseJournalEntry({ entryId: original.id }).finally(() =>
        prisma.fiscalYear.update({ where: { id: fy.id }, data: { closingEntryId: null } })
      );

      expect(result).toEqual({
        success: false,
        error: 'Este asiento es la refundición del ejercicio N° 1 y no se puede anular.',
      });
    });

    it('rechaza un borrador y un asiento de otra empresa', async () => {
      const draft = await seedEntry(main, { status: 'DRAFT' });
      expect(await reverseJournalEntry({ entryId: draft.id })).toEqual({
        success: false,
        error: `Solo se pueden anular asientos registrados; el N° ${draft.number} está en estado Borrador.`,
      });

      const foreign = await seedEntry(other);
      expect(await reverseJournalEntry({ entryId: foreign.id })).toEqual({
        success: false,
        error: 'Asiento no encontrado.',
      });
      expect(await statusOf(foreign.id)).toBe('POSTED');
    });

    it('anula un asiento de sistema sin vínculo (banco, transferencia, baja)', async () => {
      const original = await seedEntry(main, { createdBy: 'system' });
      const result = await reverseJournalEntry({ entryId: original.id });
      expect(result.success).toBe(true);
      expect(await statusOf(original.id)).toBe('REVERSED');
    });
  });

  describe('getReversalCheck', () => {
    it('manual: sin bloqueo ni aviso, con la fecha de hoy', async () => {
      const original = await seedEntry(main);
      expect(await getReversalCheck(original.id)).toEqual({
        success: true,
        link: null,
        blockedMessage: null,
        warning: null,
        date: '2026-10-06',
      });
    });

    it('de sistema sin vínculo: aviso de que no revierte bancos ni equipos (D6)', async () => {
      const original = await seedEntry(main, { createdBy: 'system' });
      const result = await getReversalCheck(original.id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.link).toBeNull();
      expect(result.warning).toContain('no revierte el saldo bancario ni el estado del equipo');
    });

    it('vinculado: devuelve el documento y el motivo del bloqueo', async () => {
      const original = await seedEntry(main, { createdBy: 'system' });
      const fullNumber = await linkPurchaseInvoice(main, original.id);
      const result = await getReversalCheck(original.id);
      expect(result).toMatchObject({
        success: true,
        link: { kind: 'PURCHASE_INVOICE', label: `la factura de compra ${fullNumber}` },
        blockedMessage: expect.stringContaining(`la factura de compra ${fullNumber}`),
      });
    });
  });

  describe('entriesWithoutDocumentWhere (asientos sin respaldo)', () => {
    it('excluye factura, egreso, fondos (columna sin relación) y refundición; deja el manual', async () => {
      const c = await setupCompany('SinRespaldo');
      const manual = await seedEntry(c);
      const invoice = await seedEntry(c, { createdBy: 'system' });
      await linkPurchaseInvoice(c, invoice.id);
      const fund = await seedEntry(c, { createdBy: 'system' });
      await linkFundMovement(c, fund.id);
      const closing = await seedEntry(c, { createdBy: 'system' });
      await prisma.fiscalYear.updateMany({ where: { companyId: c.companyId }, data: { closingEntryId: closing.id } });

      const where = await entriesWithoutDocumentWhere(prisma, c.companyId);
      const ids = await prisma.journalEntry.findMany({
        where: { companyId: c.companyId, ...where },
        select: { id: true },
      });

      expect(ids.map((e) => e.id)).toEqual([manual.id]);
    });
  });

  describe('deleteDraftJournalEntry (C6)', () => {
    it('elimina un borrador manual con sus líneas', async () => {
      const draft = await seedEntry(main, { status: 'DRAFT' });

      expect(await deleteDraftJournalEntry(draft.id)).toEqual({ success: true, number: draft.number });
      expect(checkPermission).toHaveBeenCalledWith('accounting.entries', 'delete', { redirect: true });
      expect(await statusOf(draft.id)).toBeNull();
      expect(await prisma.journalEntryLine.count({ where: { entryId: draft.id } })).toBe(0);
    });

    it('rechaza un asiento registrado', async () => {
      const posted = await seedEntry(main);
      expect(await deleteDraftJournalEntry(posted.id)).toEqual({
        success: false,
        error: `Solo se eliminan borradores; el asiento N° ${posted.number} está en estado Registrado.`,
      });
      expect(await statusOf(posted.id)).toBe('POSTED');
    });

    it('rechaza un borrador vinculado a una factura o a un movimiento de fondos', async () => {
      const invoiceDraft = await seedEntry(main, { status: 'DRAFT', createdBy: 'system' });
      const fullNumber = await linkPurchaseInvoice(main, invoiceDraft.id);
      expect(await deleteDraftJournalEntry(invoiceDraft.id)).toEqual({
        success: false,
        error:
          `Este asiento pertenece a la factura de compra ${fullNumber} y no se puede eliminar: ` +
          'solo se eliminan borradores manuales.',
      });

      const fundDraft = await seedEntry(main, { status: 'DRAFT', createdBy: 'system' });
      await linkFundMovement(main, fundDraft.id);
      const fund = await deleteDraftJournalEntry(fundDraft.id);
      expect(fund).toEqual({ success: false, error: expect.stringContaining('movimiento de fondos') });

      expect(await statusOf(invoiceDraft.id)).toBe('DRAFT');
      expect(await statusOf(fundDraft.id)).toBe('DRAFT');
    });

    it('rechaza un borrador de sistema sin vínculo y uno de otra empresa', async () => {
      const systemDraft = await seedEntry(main, { status: 'DRAFT', createdBy: 'system' });
      expect(await deleteDraftJournalEntry(systemDraft.id)).toEqual({
        success: false,
        error:
          `El borrador N° ${systemDraft.number} lo generó el sistema (por ejemplo, un movimiento ` +
          'bancario): solo se eliminan borradores manuales.',
      });

      const foreign = await seedEntry(other, { status: 'DRAFT' });
      expect(await deleteDraftJournalEntry(foreign.id)).toEqual({
        success: false,
        error: 'Asiento no encontrado.',
      });
      expect(await statusOf(systemDraft.id)).toBe('DRAFT');
      expect(await statusOf(foreign.id)).toBe('DRAFT');
    });

    it('sin permiso de eliminar no borra nada', async () => {
      const draft = await seedEntry(main, { status: 'DRAFT' });
      vi.mocked(checkPermission).mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

      await expect(deleteDraftJournalEntry(draft.id)).rejects.toThrow('NEXT_REDIRECT');
      expect(await statusOf(draft.id)).toBe('DRAFT');
    });
  });
});
