/**
 * Tests de integración del creador único de asientos (TSK-760, diseño §3.3.4)
 * contra la base real (`contable-pms-db`).
 *
 * Código real: `createJournalEntryTx`, `nextEntryNumberTx` (regla C1: racha
 * contigua + salteo de números ocupados), `postJournalEntryTx` y
 * `lockAccountingSettingsTx`, dentro de `prisma.$transaction` como los usarán las
 * actions. Incluye la concurrencia: 10 creaciones en paralelo y un cierre de mes
 * concurrente con una creación (el lock `FOR UPDATE` de `accounting_settings`
 * serializa por empresa).
 *
 * Cada escenario que toca el contador o el estado de los períodos usa su propia
 * empresa (prefijo `TSK760-JE-`). Los asientos POSTED son inmutables por trigger:
 * `afterAll` limpia con `cleanupAccountingCompany` (`session_replication_role`).
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// `journal-entry-tx.ts` y `period-lock.ts` abren con `import 'server-only'`.
vi.mock('server-only', () => ({}));

import { cleanupAccountingCompany } from '../test-utils/cleanup-accounting-company';
import { createJournalEntryTx, nextEntryNumberTx, postJournalEntryTx } from './journal-entry-tx';
import type { JournalEntryLineDraft } from './journal-entry-lines';
import type { Tx } from './journal-entry-types';
import { lockAccountingSettingsTx } from './period-lock';

const PREFIX = 'TSK760-JE-';
const USER = 'test-user';
const MARCH_10 = new Date('2026-03-10T12:00:00.000Z');
const TX_OPTS = { maxWait: 10_000, timeout: 10_000 };

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const inTx = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn, TX_OPTS);

interface TestCompany {
  companyId: string;
  cajaId: string;
  ventasId: string;
}

describe.skipIf(!dbAvailable)('creador único de asientos (TSK-760)', () => {
  const companyIds: string[] = [];
  let main: TestCompany;
  let rubroId: string;
  let rubroCode: string;
  let foreignAccountId: string;
  let otherCompanyId: string;
  let customerId: string;
  let supplierId: string;
  let costCenterId: string;

  async function setupCompany(name: string, withSettings = true): Promise<TestCompany> {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}${name}`, isActive: true },
      select: { id: true },
    });
    const companyId = company.id;
    companyIds.push(companyId);
    const [caja, ventas] = await Promise.all([
      prisma.account.create({
        data: { companyId, code: 'T760-CAJA', name: `${PREFIX}Caja`, type: 'ASSET', nature: 'DEBIT' },
        select: { id: true },
      }),
      prisma.account.create({
        data: { companyId, code: 'T760-VENTAS', name: `${PREFIX}Ventas`, type: 'REVENUE', nature: 'CREDIT' },
        select: { id: true },
      }),
    ]);
    if (withSettings) {
      await prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01T03:00:00.000Z'),
          fiscalYearEnd: new Date('2026-12-31T03:00:00.000Z'),
        },
      });
    }
    return { companyId, cajaId: caja.id, ventasId: ventas.id };
  }

  const lines = (c: TestCompany, amount = 100): JournalEntryLineDraft[] => [
    { accountId: c.cajaId, debit: amount, credit: 0 },
    { accountId: c.ventasId, debit: 0, credit: amount },
  ];

  const create = (
    c: TestCompany,
    overrides: Partial<Parameters<typeof createJournalEntryTx>[1]> = {}
  ) =>
    inTx((tx) =>
      createJournalEntryTx(tx, {
        companyId: c.companyId,
        date: MARCH_10,
        description: `${PREFIX}asiento`,
        lines: lines(c),
        status: 'DRAFT',
        createdBy: USER,
        ...overrides,
      })
    );

  const counter = async (companyId: string) =>
    (
      await prisma.accountingSettings.findUniqueOrThrow({
        where: { companyId },
        select: { lastEntryNumber: true },
      })
    ).lastEntryNumber;

  /** Siembra directa (sin núcleo) de un asiento, para escenarios de datos viejos. */
  const seedEntry = (
    c: TestCompany,
    number: number,
    entryLines: { accountId: string; debit: number; credit: number }[] = [
      { accountId: c.cajaId, debit: 50, credit: 0 },
      { accountId: c.ventasId, debit: 0, credit: 50 },
    ]
  ) =>
    prisma.journalEntry.create({
      data: {
        companyId: c.companyId,
        number,
        date: MARCH_10,
        description: `${PREFIX}sembrado ${number}`,
        status: 'DRAFT',
        createdBy: USER,
        lines: { create: entryLines },
      },
      select: { id: true },
    });

  async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
      await promise;
    } catch (error) {
      return error as Error;
    }
    throw new Error('Se esperaba un rechazo');
  }

  beforeAll(async () => {
    main = await setupCompany('Principal');
    const { companyId } = main;

    const rubro = await prisma.account.create({
      data: {
        companyId,
        code: 'T760-RUBRO',
        name: `${PREFIX}Rubro`,
        type: 'ASSET',
        nature: 'DEBIT',
        isLeaf: false,
      },
      select: { id: true, code: true },
    });
    rubroId = rubro.id;
    rubroCode = rubro.code;

    const other = await setupCompany('Otra', false);
    foreignAccountId = other.cajaId;
    otherCompanyId = other.companyId;

    const [customer, supplier, costCenter] = await Promise.all([
      prisma.contractor.create({ data: { companyId, name: `${PREFIX}Cliente` }, select: { id: true } }),
      prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}PROV`,
          businessName: `${PREFIX}Proveedor`,
          taxId: '30500000002',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: USER,
        },
        select: { id: true },
      }),
      prisma.costCenter.create({ data: { companyId, name: `${PREFIX}Logística` }, select: { id: true } }),
    ]);
    customerId = customer.id;
    supplierId = supplier.id;
    costCenterId = costCenter.id;
  });

  afterAll(async () => {
    for (const companyId of companyIds) {
      await cleanupAccountingCompany(companyId);
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.costCenter.deleteMany({ where: { companyId } });
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.contractor.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }

    const [companies, accounts, entries, fys] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.journalEntry.count({ where: { description: { startsWith: PREFIX } } }),
      prisma.fiscalYear.count({ where: { companyId: { in: companyIds } } }),
    ]);
    expect(companies).toBe(0);
    expect(accounts).toBe(0);
    expect(entries).toBe(0);
    expect(fys).toBe(0);
  });

  describe('numeración', () => {
    it('número correlativo y contador sincronizado', async () => {
      const c = await setupCompany('Correlativo');
      const first = await create(c);
      const second = await create(c);
      expect(first.number).toBe(1);
      expect(second.number).toBe(2);
      expect(await counter(c.companyId)).toBe(2);
    });

    it('concurrencia: 10 creaciones en paralelo → números 1..10 sin repetir y contador = 10', async () => {
      const c = await setupCompany('Concurrencia');

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          create(c, { description: `${PREFIX}paralelo ${i}`, status: i % 2 === 0 ? 'DRAFT' : 'POSTED' })
        )
      );

      const numbers = results.map((r) => r.number).sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(await counter(c.companyId)).toBe(10);
      // Un solo ejercicio, aunque las 10 tx lo pidieron a la vez.
      expect(await prisma.fiscalYear.count({ where: { companyId: c.companyId } })).toBe(1);
      expect(new Set(results.map((r) => r.fiscalYearId)).size).toBe(1);
    });

    it('C1: salta números ocupados (contador 5 con 6 y 7 sembrados → 8)', async () => {
      const c = await setupCompany('Salto');
      await prisma.accountingSettings.update({ where: { companyId: c.companyId }, data: { lastEntryNumber: 5 } });
      await seedEntry(c, 6);
      await seedEntry(c, 7);

      const entry = await create(c);

      expect(entry.number).toBe(8);
      expect(await counter(c.companyId)).toBe(8);
    });

    it('C1: un número aislado alto no dispara la numeración (contador 0 con 999999 → 1)', async () => {
      const c = await setupCompany('Aislado');
      await seedEntry(c, 999999);

      const entry = await create(c);

      expect(entry.number).toBe(1);
      expect(await counter(c.companyId)).toBe(1);
    });

    it('nextEntryNumberTx sin Ajustes → NO_SETTINGS', async () => {
      const c = await setupCompany('Sin Ajustes', false);
      const error = await rejection(inTx((tx) => nextEntryNumberTx(tx, c.companyId)));
      expect(error.name).toBe('BusinessError');
      expect(error.message).toBe(
        'No se encontró configuración contable para la empresa. Configurala en Contabilidad → Configuración.'
      );
    });
  });

  describe('concurrencia con el cierre de mes', () => {
    it('una tx cierra el mes con el lock tomado; la creación espera y falla con "el período está cerrado"', async () => {
      const c = await setupCompany('Cierre concurrente');
      // Crea el ejercicio y sus períodos.
      await create(c, { date: new Date('2026-01-15T12:00:00.000Z') });

      let signalLocked: () => void = () => undefined;
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const closer = inTx(async (tx) => {
        await lockAccountingSettingsTx(tx, c.companyId);
        signalLocked();
        await gate;
        await tx.accountingPeriod.updateMany({
          where: { fiscalYear: { companyId: c.companyId }, type: 'MONTHLY', year: 2026, month: 3 },
          data: { isClosed: true },
        });
      });

      await locked;
      let creatorSettled = false;
      const creator = create(c).finally(() => {
        creatorSettled = true;
      });
      // Evita el unhandled rejection mientras la creación espera el lock.
      creator.catch(() => undefined);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(creatorSettled).toBe(false); // esperando el FOR UPDATE

      release();
      await closer;

      const error = await rejection(creator);
      expect(error.name).toBe('BusinessError');
      expect(error.message).toContain('el período está cerrado (mes 03/2026 cerrado)');
      expect(await counter(c.companyId)).toBe(1);
    });
  });

  describe('createJournalEntryTx', () => {
    it('DRAFT y POSTED nacen con fiscalYearId y periodId; POSTED con postDate', async () => {
      const draft = await create(main);
      const posted = await create(main, { status: 'POSTED' });

      const rows = await prisma.journalEntry.findMany({
        where: { id: { in: [draft.id, posted.id] } },
        select: {
          id: true,
          status: true,
          postDate: true,
          fiscalYearId: true,
          periodId: true,
          createdBy: true,
          period: { select: { type: true, year: true, month: true } },
        },
      });
      const draftRow = rows.find((r) => r.id === draft.id);
      const postedRow = rows.find((r) => r.id === posted.id);

      expect(draftRow).toMatchObject({ status: 'DRAFT', postDate: null, createdBy: USER });
      expect(postedRow?.status).toBe('POSTED');
      expect(postedRow?.postDate).toBeInstanceOf(Date);
      for (const row of [draftRow, postedRow]) {
        expect(row?.fiscalYearId).toBeTruthy();
        expect(row?.periodId).toBeTruthy();
        expect(row?.period).toEqual({ type: 'MONTHLY', year: 2026, month: 3 });
      }
      expect(draft).toMatchObject({ status: 'DRAFT', fiscalYearId: draftRow?.fiscalYearId, periodId: draftRow?.periodId });
    });

    it('copia auxiliares, moneda, descripción y centro de costo de cada línea (TSK-583/719)', async () => {
      const entry = await create(main, {
        lines: [
          {
            accountId: main.cajaId,
            debit: 1200,
            credit: 0,
            description: 'Cobro USD',
            customerId,
            costCenterId,
            currency: 'USD',
            originalAmount: 1,
            exchangeRate: 1200,
          },
          { accountId: main.ventasId, debit: 0, credit: 1200, supplierId },
        ],
      });

      const rows = await prisma.journalEntryLine.findMany({
        where: { entryId: entry.id },
        select: {
          accountId: true,
          debit: true,
          credit: true,
          description: true,
          customerId: true,
          supplierId: true,
          costCenterId: true,
          currency: true,
          originalAmount: true,
          exchangeRate: true,
        },
      });
      const cajaLine = rows.find((r) => r.accountId === main.cajaId);
      const ventasLine = rows.find((r) => r.accountId === main.ventasId);

      expect(cajaLine).toMatchObject({ description: 'Cobro USD', customerId, supplierId: null, costCenterId, currency: 'USD' });
      expect(Number(cajaLine?.debit)).toBe(1200);
      expect(Number(cajaLine?.originalAmount)).toBe(1);
      expect(Number(cajaLine?.exchangeRate)).toBe(1200);
      expect(ventasLine).toMatchObject({ supplierId, customerId: null, costCenterId: null, currency: 'ARS' });
      expect(ventasLine?.originalAmount).toBeNull();
      expect(Number(ventasLine?.credit)).toBe(1200);
    });

    it('periodType OPENING → asiento en el período de apertura', async () => {
      const entry = await create(main, {
        date: new Date('2026-01-01T00:00:00.000Z'),
        periodType: 'OPENING',
        status: 'POSTED',
      });
      const row = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: entry.id },
        select: { period: { select: { type: true } } },
      });
      expect(row.period?.type).toBe('OPENING');
    });

    it('desbalanceado (DRAFT o POSTED, C5) → BusinessError sin consumir número', async () => {
      const c = await setupCompany('Desbalance');
      await create(c);
      const before = await counter(c.companyId);

      for (const status of ['DRAFT', 'POSTED'] as const) {
        const error = await rejection(
          create(c, {
            status,
            lines: [
              { accountId: c.cajaId, debit: 1500, credit: 0 },
              { accountId: c.ventasId, debit: 0, credit: 1499 },
            ],
          })
        );
        expect(error.name).toBe('BusinessError');
        expect(error.message).toBe(
          'El asiento no está balanceado. Debe: $1500.00, Haber: $1499.00, Diferencia: $1.00'
        );
      }
      expect(await counter(c.companyId)).toBe(before);
      expect(await prisma.journalEntry.count({ where: { companyId: c.companyId } })).toBe(1);
    });

    it('cuenta de otra empresa → BusinessError', async () => {
      const error = await rejection(
        create(main, {
          lines: [
            { accountId: foreignAccountId, debit: 100, credit: 0 },
            { accountId: main.ventasId, debit: 0, credit: 100 },
          ],
        })
      );
      expect(error.name).toBe('BusinessError');
      expect(error.message).toBe('Una o más cuentas del asiento no existen o no pertenecen a la empresa.');
    });

    it('cuenta no imputable (con subcuentas) → BusinessError con el código', async () => {
      const error = await rejection(
        create(main, {
          lines: [
            { accountId: rubroId, debit: 100, credit: 0 },
            { accountId: main.ventasId, debit: 0, credit: 100 },
          ],
        })
      );
      expect(error.name).toBe('BusinessError');
      expect(error.message).toBe(`La cuenta ${rubroCode} no es imputable (tiene subcuentas).`);
    });

    it('mes cerrado → "el período está cerrado" sin consumir número', async () => {
      const c = await setupCompany('Mes cerrado');
      await create(c, { date: new Date('2026-01-15T12:00:00.000Z') });
      await prisma.accountingPeriod.updateMany({
        where: { fiscalYear: { companyId: c.companyId }, type: 'MONTHLY', month: 3 },
        data: { isClosed: true },
      });

      await expect(create(c)).rejects.toThrow(
        'No se puede registrar con fecha 10/03/2026: el período está cerrado (mes 03/2026 cerrado).'
      );
      expect(await counter(c.companyId)).toBe(1);
    });
  });

  describe('postJournalEntryTx', () => {
    const post = (companyId: string, entryId: string) =>
      inTx((tx) => postJournalEntryTx(tx, { companyId, entryId, userId: USER }));

    it('DRAFT → POSTED con postDate y FY/período resueltos (corrige datos viejos sin ejercicio)', async () => {
      const c = await setupCompany('Registrar');
      await prisma.accountingSettings.update({ where: { companyId: c.companyId }, data: { lastEntryNumber: 40 } });
      const seeded = await seedEntry(c, 40); // sin fiscalYearId ni periodId

      const result = await post(c.companyId, seeded.id);

      expect(result).toEqual({ id: seeded.id, number: 40 });
      const row = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: seeded.id },
        select: { status: true, postDate: true, fiscalYearId: true, period: { select: { type: true, month: true } } },
      });
      expect(row.status).toBe('POSTED');
      expect(row.postDate).toBeInstanceOf(Date);
      expect(row.fiscalYearId).toBeTruthy();
      expect(row.period).toEqual({ type: 'MONTHLY', month: 3 });
    });

    it('asiento que no está en borrador → BusinessError', async () => {
      const posted = await create(main, { status: 'POSTED' });
      const error = await rejection(post(main.companyId, posted.id));
      expect(error.name).toBe('BusinessError');
      expect(error.message).toBe(`El asiento N° ${posted.number} ya no está en borrador.`);
    });

    it('inexistente o de otra empresa → "Asiento no encontrado."', async () => {
      const draft = await create(main);
      await expect(post(otherCompanyId, draft.id)).rejects.toThrow('Asiento no encontrado.');
      await expect(post(main.companyId, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        'Asiento no encontrado.'
      );
    });

    it('DRAFT de un ejercicio cerrado → rechaza (B4)', async () => {
      const c = await setupCompany('Registrar FY cerrado');
      const draft = await create(c);
      await prisma.fiscalYear.updateMany({ where: { companyId: c.companyId }, data: { isClosed: true } });

      const error = await rejection(post(c.companyId, draft.id));
      expect(error.name).toBe('BusinessError');
      expect(error.message).toBe(
        'No se puede registrar con fecha 10/03/2026: el período está cerrado (ejercicio N° 1 cerrado).'
      );
      const row = await prisma.journalEntry.findUniqueOrThrow({ where: { id: draft.id }, select: { status: true } });
      expect(row.status).toBe('DRAFT');
    });

    it('DRAFT desbalanceado (sembrado) → rechaza con el texto de balance', async () => {
      const c = await setupCompany('Registrar desbalanceado');
      const seeded = await seedEntry(c, 1, [
        { accountId: c.cajaId, debit: 100, credit: 0 },
        { accountId: c.ventasId, debit: 0, credit: 90 },
      ]);
      await expect(post(c.companyId, seeded.id)).rejects.toThrow(
        'El asiento no está balanceado. Debe: $100.00, Haber: $90.00, Diferencia: $10.00'
      );
    });
  });
});
