/**
 * Tests de integración del núcleo contable para corregir comprobantes (TSK-792, tarea 4)
 * contra la base real (`contable-pms-db`).
 *
 * Código real: `rewriteDraftJournalEntryTx` y `deleteDraftJournalEntryTx`
 * (`journal-entry-tx.ts`), `findMonthlyProcessEntriesTx` (`monthly-processes.ts`) y
 * `createJournalEntryForPurchaseInvoice` con `rewriteEntryId`, dentro de
 * `prisma.$transaction` como los usará el motor de corrección.
 *
 * Empresa propia con prefijo `TSK792-RW-`. Los asientos POSTED son inmutables por
 * trigger: `afterAll` limpia con `cleanupAccountingCompany`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// El núcleo contable abre con `import 'server-only'`.
vi.mock('server-only', () => ({}));

import { createJournalEntryForPurchaseInvoice } from '@/modules/accounting/features/integrations/commercial';

import { cleanupAccountingCompany } from '../test-utils/cleanup-accounting-company';
import { closeMonthForTest, readLastEntryNumber } from '../test-utils/period-test-helpers';
import type { JournalEntryLineDraft } from './journal-entry-lines';
import {
  createJournalEntryTx,
  deleteDraftJournalEntryTx,
  reverseJournalEntryTx,
  rewriteDraftJournalEntryTx,
} from './journal-entry-tx';
import type { Tx } from './journal-entry-types';
import { findMonthlyProcessEntriesTx } from './monthly-processes';

const PREFIX = 'TSK792-RW-';
const USER = 'test-user';
const MARCH_10 = new Date('2026-03-10T00:00:00.000Z');
const MARCH_31 = new Date('2026-03-31T00:00:00.000Z');
const APRIL_20 = new Date('2026-04-20T00:00:00.000Z');
const JUNE_15 = new Date('2026-06-15T00:00:00.000Z');
const TX_OPTS = { maxWait: 10_000, timeout: 10_000 };

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const inTx = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn, TX_OPTS);

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba un rechazo');
}

describe.skipIf(!dbAvailable)('reescribir y eliminar asientos de comprobantes (TSK-792)', () => {
  let companyId: string;
  let cajaId: string;
  let ventasId: string;
  let comprasId: string;
  let pagarId: string;
  let ivaCfId: string;
  let supplierId: string;

  const lines = (amount = 100): JournalEntryLineDraft[] => [
    { accountId: cajaId, debit: amount, credit: 0 },
    { accountId: ventasId, debit: 0, credit: amount },
  ];

  const create = (overrides: Partial<Parameters<typeof createJournalEntryTx>[1]> = {}) =>
    inTx((tx) =>
      createJournalEntryTx(tx, {
        companyId,
        date: MARCH_10,
        description: `${PREFIX}asiento`,
        lines: lines(),
        status: 'DRAFT',
        createdBy: USER,
        ...overrides,
      })
    );

  const readEntry = (id: string) =>
    prisma.journalEntry.findUniqueOrThrow({
      where: { id },
      select: {
        number: true,
        status: true,
        date: true,
        description: true,
        periodId: true,
        period: { select: { year: true, month: true } },
        lines: {
          select: { accountId: true, debit: true, credit: true, description: true, supplierId: true },
          orderBy: [{ debit: 'desc' }, { credit: 'desc' }],
        },
      },
    });

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
      select: { id: true },
    });
    companyId = company.id;

    const account = (code: string, name: string, type: 'ASSET' | 'LIABILITY' | 'EXPENSE' | 'REVENUE') =>
      prisma.account.create({
        data: {
          companyId,
          code,
          name: `${PREFIX}${name}`,
          type,
          nature: type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT',
        },
        select: { id: true },
      });
    const [caja, ventas, compras, pagar, ivaCf] = await Promise.all([
      account('T792-CAJA', 'Caja', 'ASSET'),
      account('T792-VENTAS', 'Ventas', 'REVENUE'),
      account('T792-COMPRAS', 'Compras', 'EXPENSE'),
      account('T792-PAGAR', 'Proveedores', 'LIABILITY'),
      account('T792-IVACF', 'IVA Crédito Fiscal', 'ASSET'),
    ]);
    cajaId = caja.id;
    ventasId = ventas.id;
    comprasId = compras.id;
    pagarId = pagar.id;
    ivaCfId = ivaCf.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01T00:00:00.000Z'),
        fiscalYearEnd: new Date('2026-12-31T00:00:00.000Z'),
        purchasesAccountId: comprasId,
        payablesAccountId: pagarId,
        vatCreditAccountId: ivaCfId,
      },
    });

    const supplier = await prisma.supplier.create({
      data: {
        companyId,
        code: `${PREFIX}PROV`,
        businessName: `${PREFIX}Proveedor`,
        taxId: '30500000792',
        taxCondition: 'RESPONSABLE_INSCRIPTO',
        createdBy: USER,
      },
      select: { id: true },
    });
    supplierId = supplier.id;
  });

  afterAll(async () => {
    if (!companyId) return;
    await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
    await cleanupAccountingCompany(companyId);
    await prisma.accountingSettings.deleteMany({ where: { companyId } });
    await prisma.supplier.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });

    const remaining = await prisma.company.count({ where: { name: { startsWith: PREFIX } } });
    expect(remaining).toBe(0);
  });

  describe('rewriteDraftJournalEntryTx', () => {
    it('rewrite conserva id y número, reemplaza líneas y no avanza lastEntryNumber', async () => {
      const draft = await create();
      const before = await readLastEntryNumber(companyId);

      const result = await inTx((tx) =>
        rewriteDraftJournalEntryTx(tx, {
          companyId,
          entryId: draft.id,
          date: APRIL_20,
          description: `${PREFIX}reescrito`,
          lines: [
            { accountId: comprasId, debit: 250, credit: 0, description: 'nueva debe' },
            { accountId: cajaId, debit: 0, credit: 250, description: 'nueva haber' },
          ],
        })
      );

      expect(result).toEqual({ id: draft.id, number: draft.number });
      expect(await readLastEntryNumber(companyId)).toBe(before);

      const entry = await readEntry(draft.id);
      expect(entry.number).toBe(draft.number);
      expect(entry.status).toBe('DRAFT');
      expect(entry.date.toISOString()).toBe(APRIL_20.toISOString());
      expect(entry.description).toBe(`${PREFIX}reescrito`);
      expect(entry.period).toEqual({ year: 2026, month: 4 });
      expect(entry.lines).toHaveLength(2);
      expect(entry.lines.map((l) => [l.accountId, Number(l.debit), Number(l.credit), l.description])).toEqual([
        [comprasId, 250, 0, 'nueva debe'],
        [cajaId, 0, 250, 'nueva haber'],
      ]);
    });

    it('rewrite rechaza POSTED', async () => {
      const posted = await create({ status: 'POSTED' });

      const error = await rejection(
        inTx((tx) =>
          rewriteDraftJournalEntryTx(tx, {
            companyId,
            entryId: posted.id,
            date: MARCH_10,
            description: `${PREFIX}no`,
            lines: lines(300),
          })
        )
      );

      expect(error.message).toBe(`El asiento N° ${posted.number} ya no está en borrador.`);
      const entry = await readEntry(posted.id);
      expect(entry.status).toBe('POSTED');
      expect(entry.lines.map((l) => Number(l.debit) + Number(l.credit))).toEqual([100, 100]);
    });

    it('rewrite rechaza fecha nueva en mes cerrado', async () => {
      const draft = await create();
      const reopen = await closeMonthForTest(companyId, JUNE_15);
      try {
        const error = await rejection(
          inTx((tx) =>
            rewriteDraftJournalEntryTx(tx, {
              companyId,
              entryId: draft.id,
              date: JUNE_15,
              description: `${PREFIX}a junio`,
              lines: lines(),
            })
          )
        );
        expect(error.name).toBe('BusinessError');
        expect(error.message).toMatch(/cerrad/i);
      } finally {
        await reopen();
      }

      const entry = await readEntry(draft.id);
      expect(entry.date.toISOString()).toBe(MARCH_10.toISOString());
      expect(entry.description).toBe(`${PREFIX}asiento`);
    });

    it('rewrite valida balance', async () => {
      const draft = await create();

      const error = await rejection(
        inTx((tx) =>
          rewriteDraftJournalEntryTx(tx, {
            companyId,
            entryId: draft.id,
            date: MARCH_10,
            description: `${PREFIX}desbalanceado`,
            lines: [
              { accountId: cajaId, debit: 100, credit: 0 },
              { accountId: ventasId, debit: 0, credit: 90 },
            ],
          })
        )
      );

      expect(error.name).toBe('BusinessError');
      const entry = await readEntry(draft.id);
      expect(entry.description).toBe(`${PREFIX}asiento`);
      expect(entry.lines.map((l) => Number(l.debit) + Number(l.credit))).toEqual([100, 100]);
    });
  });

  describe('deleteDraftJournalEntryTx', () => {
    it('deleteDraft borra un DRAFT y rechaza un POSTED', async () => {
      const draft = await create();
      const deleted = await inTx((tx) => deleteDraftJournalEntryTx(tx, { companyId, entryId: draft.id }));
      expect(deleted).toEqual({ number: draft.number });
      expect(await prisma.journalEntry.count({ where: { id: draft.id } })).toBe(0);
      expect(await prisma.journalEntryLine.count({ where: { entryId: draft.id } })).toBe(0);

      const posted = await create({ status: 'POSTED' });
      const error = await rejection(
        inTx((tx) => deleteDraftJournalEntryTx(tx, { companyId, entryId: posted.id }))
      );
      expect(error.name).toBe('BusinessError');
      expect(error.message).toBe(`El asiento N° ${posted.number} ya no está en borrador.`);
      expect(await prisma.journalEntry.count({ where: { id: posted.id } })).toBe(1);
    });
  });

  describe('findMonthlyProcessEntriesTx', () => {
    it('findMonthlyProcessEntriesTx encuentra la liquidación de IVA del mes y no la de otro mes ni las anuladas', async () => {
      const marchVat = await create({
        date: MARCH_31,
        description: `${PREFIX}Liquidación IVA marzo`,
        status: 'POSTED',
        process: 'VAT_SETTLEMENT',
      });
      const aprilVat = await create({
        date: APRIL_20,
        description: `${PREFIX}Liquidación IVA abril`,
        status: 'POSTED',
        process: 'VAT_SETTLEMENT',
      });
      const reversedVat = await create({
        date: MARCH_10,
        description: `${PREFIX}Liquidación IVA marzo anulada`,
        status: 'POSTED',
        process: 'VAT_SETTLEMENT',
      });
      await inTx((tx) =>
        reverseJournalEntryTx(tx, { companyId, entryId: reversedVat.id, date: MARCH_10, createdBy: USER })
      );
      // Borrador con proceso y registrado sin proceso: tampoco cuentan.
      await create({ date: MARCH_10, description: `${PREFIX}RECPAM borrador`, process: 'INFLATION_ADJUSTMENT' });
      await create({ date: MARCH_10, description: `${PREFIX}manual de marzo`, status: 'POSTED' });

      const march = await inTx((tx) => findMonthlyProcessEntriesTx(tx, companyId, [MARCH_10, MARCH_31]));
      expect(march).toEqual([
        {
          id: marchVat.id,
          number: marchVat.number,
          process: 'VAT_SETTLEMENT',
          date: MARCH_31,
          description: `${PREFIX}Liquidación IVA marzo`,
        },
      ]);

      const marchAndApril = await inTx((tx) =>
        findMonthlyProcessEntriesTx(tx, companyId, [APRIL_20, MARCH_10])
      );
      expect(marchAndApril.map((e) => e.id)).toEqual([marchVat.id, aprilVat.id]);

      expect(await inTx((tx) => findMonthlyProcessEntriesTx(tx, companyId, [JUNE_15]))).toEqual([]);
      expect(await inTx((tx) => findMonthlyProcessEntriesTx(tx, companyId, []))).toEqual([]);
    });
  });

  describe('integración comercial', () => {
    it('createJournalEntryForPurchaseInvoice con rewriteEntryId reescribe el asiento existente', async () => {
      const invoice = await prisma.purchaseInvoice.create({
        data: {
          companyId,
          supplierId,
          voucherType: 'FACTURA_A',
          pointOfSale: '0001',
          number: '00000792',
          fullNumber: '0001-00000792',
          issueDate: MARCH_10,
          subtotal: 1000,
          netTaxed: 1000,
          vatAmount: 210,
          total: 1210,
          createdBy: USER,
          lines: {
            create: [
              {
                description: `${PREFIX}Servicio`,
                quantity: 1,
                unitCost: 1000,
                lineType: 'TAXED',
                vatRate: 21,
                vatAmount: 210,
                subtotal: 1000,
                total: 1210,
              },
            ],
          },
        },
        select: { id: true, lines: { select: { id: true } } },
      });

      const entryId = await inTx((tx) => createJournalEntryForPurchaseInvoice(invoice.id, companyId, tx));
      await prisma.purchaseInvoice.update({ where: { id: invoice.id }, data: { journalEntryId: entryId } });
      const original = await readEntry(entryId);
      const before = await readLastEntryNumber(companyId);

      // Se corrige el comprobante: otro número, otra fecha y otro importe.
      await prisma.purchaseInvoice.update({
        where: { id: invoice.id },
        data: {
          number: '00000793',
          fullNumber: '0001-00000793',
          issueDate: APRIL_20,
          subtotal: 2000,
          netTaxed: 2000,
          vatAmount: 420,
          total: 2420,
          lines: {
            update: {
              where: { id: invoice.lines[0].id },
              data: { unitCost: 2000, vatAmount: 420, subtotal: 2000, total: 2420 },
            },
          },
        },
      });

      const rewrittenId = await inTx((tx) =>
        createJournalEntryForPurchaseInvoice(invoice.id, companyId, tx, { rewriteEntryId: entryId })
      );

      expect(rewrittenId).toBe(entryId);
      expect(await readLastEntryNumber(companyId)).toBe(before);
      const entry = await readEntry(entryId);
      expect(entry.number).toBe(original.number);
      expect(entry.status).toBe('DRAFT');
      expect(entry.date.toISOString()).toBe(APRIL_20.toISOString());
      expect(entry.description).toBe('Factura de compra 0001-00000793');
      expect(entry.period).toEqual({ year: 2026, month: 4 });
      expect(entry.lines.map((l) => [l.accountId, Number(l.debit), Number(l.credit)])).toEqual([
        [comprasId, 2000, 0],
        [ivaCfId, 420, 0],
        [pagarId, 0, 2420],
      ]);
      expect(entry.lines.find((l) => l.accountId === pagarId)?.supplierId).toBe(supplierId);
    });
  });
});
