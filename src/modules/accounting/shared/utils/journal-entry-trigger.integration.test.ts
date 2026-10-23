/**
 * Tests de integración del trigger de inmutabilidad de asientos
 * (`prevent_posted_entry_modification`, TSK-792 §6) contra la base real
 * (`contable-pms-db`).
 *
 * El trigger admite una transición nueva: Registrado → Borrador, siempre que no
 * cambien `number`, `date`, `description`, `company_id`, `original_entry_id` ni
 * `reversal_entry_id`. El resto de la inmutabilidad sigue igual: un POSTED no se
 * borra ni se edita, un REVERSED no admite ningún cambio y las líneas de un POSTED
 * siguen bloqueadas (recién se editan cuando el asiento ya volvió a DRAFT).
 *
 * Empresa propia con prefijo `TSK792-TRG-`. `afterAll` limpia con
 * `cleanupAccountingCompany` (`session_replication_role`), que no pasa por el trigger.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// `journal-entry-tx.ts` y `period-lock.ts` abren con `import 'server-only'`.
vi.mock('server-only', () => ({}));

import { cleanupAccountingCompany } from '../test-utils/cleanup-accounting-company';
import { createJournalEntryTx, reverseJournalEntryTx } from './journal-entry-tx';

const PREFIX = 'TSK792-TRG-';
const USER = 'test-user';
const NOW = new Date('2026-10-23T15:00:00.000Z');
const MARCH_10 = new Date('2026-03-10T12:00:00.000Z');
const TX_OPTS = { maxWait: 10_000, timeout: 10_000 };

// Mensajes del trigger, completos: un error de validación de Prisma renderiza el código
// fuente de la llamada y una regex corta podría coincidir con el propio test.
const POSTED_LOCKED = /asiento contable registrado \(POSTED\)/;
const REVERSED_LOCKED = /asiento contable anulado \(REVERSED\)/;
const LINES_LOCKED = /líneas de un asiento contable con estado POSTED/;

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('trigger de inmutabilidad de asientos (TSK-792)', () => {
  let companyId = '';
  let cajaId = '';
  let ventasId = '';

  /** Asiento nuevo creado con el núcleo (POSTED por defecto). */
  const createEntry = (status: 'DRAFT' | 'POSTED' = 'POSTED') =>
    prisma.$transaction(
      (tx) =>
        createJournalEntryTx(tx, {
          companyId,
          date: MARCH_10,
          description: `${PREFIX}asiento`,
          status,
          createdBy: USER,
          lines: [
            { accountId: cajaId, debit: 100, credit: 0 },
            { accountId: ventasId, debit: 0, credit: 100 },
          ],
        }),
      TX_OPTS
    );

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
      select: { id: true },
    });
    companyId = company.id;
    const [caja, ventas] = await Promise.all([
      prisma.account.create({
        data: {
          companyId,
          code: 'T792-CAJA',
          name: `${PREFIX}Caja`,
          type: 'ASSET',
          nature: 'DEBIT',
        },
        select: { id: true },
      }),
      prisma.account.create({
        data: {
          companyId,
          code: 'T792-VENTAS',
          name: `${PREFIX}Ventas`,
          type: 'REVENUE',
          nature: 'CREDIT',
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
    cajaId = caja.id;
    ventasId = ventas.id;
  });

  afterAll(async () => {
    if (!companyId) return;
    await cleanupAccountingCompany(companyId);
    await prisma.accountingSettings.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });

    const [companies, entries] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.journalEntry.count({ where: { description: { startsWith: PREFIX } } }),
    ]);
    expect({ companies, entries }).toEqual({ companies: 0, entries: 0 });
  });

  it('permite POSTED → DRAFT sin tocar el contenido', async () => {
    const posted = await createEntry();

    await prisma.journalEntry.update({
      where: { id: posted.id },
      data: { status: 'DRAFT', postDate: null, revertedToDraftAt: NOW, revertedToDraftBy: USER },
    });

    const after = await prisma.journalEntry.findUnique({
      where: { id: posted.id },
      select: {
        status: true,
        number: true,
        postDate: true,
        revertedToDraftAt: true,
        revertedToDraftBy: true,
      },
    });
    expect(after).toEqual({
      status: 'DRAFT',
      number: posted.number,
      postDate: null,
      revertedToDraftAt: NOW,
      revertedToDraftBy: USER,
    });
  });

  it('el asiento vuelto a DRAFT ya admite editar sus líneas y registrarse de nuevo', async () => {
    const posted = await createEntry();
    await prisma.journalEntry.update({
      where: { id: posted.id },
      data: { status: 'DRAFT', postDate: null, revertedToDraftAt: NOW, revertedToDraftBy: USER },
    });

    await prisma.journalEntryLine.updateMany({
      where: { entryId: posted.id },
      data: { description: 'editada en borrador' },
    });
    await prisma.journalEntry.update({
      where: { id: posted.id },
      data: { status: 'POSTED', postDate: NOW },
    });

    const lines = await prisma.journalEntryLine.findMany({
      where: { entryId: posted.id },
      select: { description: true },
    });
    expect(lines.map((l) => l.description)).toEqual(['editada en borrador', 'editada en borrador']);
  });

  describe('sigue rechazando POSTED → DRAFT si cambia el contenido', () => {
    it.each([
      ['la descripción', { description: 'otra' }],
      ['el número', { number: 999_999 }],
      ['la fecha', { date: new Date('2026-03-11T12:00:00.000Z') }],
    ])('%s', async (_label, change) => {
      const posted2 = await createEntry();

      await expect(
        prisma.journalEntry.update({
          where: { id: posted2.id },
          data: { status: 'DRAFT', ...change },
        })
      ).rejects.toThrow(POSTED_LOCKED);

      const after = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: posted2.id },
        select: { status: true },
      });
      expect(after.status).toBe('POSTED');
    });
  });

  it('sigue rechazando editar un POSTED sin cambiar el estado', async () => {
    const posted = await createEntry();
    await expect(
      prisma.journalEntry.update({ where: { id: posted.id }, data: { description: 'otra' } })
    ).rejects.toThrow(POSTED_LOCKED);
  });

  it('sigue rechazando DELETE de un POSTED y cualquier cambio de un REVERSED', async () => {
    const posted = await createEntry();
    await expect(prisma.journalEntry.delete({ where: { id: posted.id } })).rejects.toThrow(
      POSTED_LOCKED
    );

    // La anulación (POSTED → REVERSED) sigue permitida: el original queda REVERSED.
    await prisma.$transaction(
      (tx) =>
        reverseJournalEntryTx(tx, {
          companyId,
          entryId: posted.id,
          date: MARCH_10,
          createdBy: USER,
        }),
      TX_OPTS
    );

    await expect(
      prisma.journalEntry.update({
        where: { id: posted.id },
        data: { status: 'DRAFT', postDate: null },
      })
    ).rejects.toThrow(REVERSED_LOCKED);
    await expect(
      prisma.journalEntry.update({ where: { id: posted.id }, data: { revertedToDraftBy: USER } })
    ).rejects.toThrow(REVERSED_LOCKED);
    await expect(prisma.journalEntry.delete({ where: { id: posted.id } })).rejects.toThrow(
      REVERSED_LOCKED
    );

    const after = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: posted.id },
      select: { status: true },
    });
    expect(after.status).toBe('REVERSED');
  });

  it('sigue rechazando editar líneas de un POSTED', async () => {
    const posted = await createEntry();
    await expect(
      prisma.journalEntryLine.updateMany({
        where: { entryId: posted.id },
        data: { description: 'cambio' },
      })
    ).rejects.toThrow(LINES_LOCKED);
    await expect(
      prisma.journalEntryLine.deleteMany({ where: { entryId: posted.id } })
    ).rejects.toThrow(LINES_LOCKED);
  });

  it('createJournalEntryTx persiste el proceso mensual que genera el asiento (TSK-792)', async () => {
    const entry = await prisma.$transaction(
      (tx) =>
        createJournalEntryTx(tx, {
          companyId,
          date: MARCH_10,
          description: `${PREFIX}liquidación`,
          status: 'POSTED',
          createdBy: 'system',
          process: 'VAT_SETTLEMENT',
          lines: [
            { accountId: cajaId, debit: 50, credit: 0 },
            { accountId: ventasId, debit: 0, credit: 50 },
          ],
        }),
      TX_OPTS
    );
    const row = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: entry.id },
      select: { process: true },
    });
    expect(row.process).toBe('VAT_SETTLEMENT');
  });
});
