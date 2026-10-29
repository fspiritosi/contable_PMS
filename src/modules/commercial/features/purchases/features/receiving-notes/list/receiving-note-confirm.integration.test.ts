/**
 * Test de integración de `confirmReceivingNote` contra la base real (TSK-812):
 * dos confirmaciones simultáneas del mismo remito deben sumar el stock una sola vez.
 *
 * La acción LANZA (no devuelve ActionResult), por eso se usa `Promise.allSettled`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

import { confirmReceivingNote } from './actions.server';

const PREFIX = 'TSK812-RN-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('integración: confirmación del remito de recepción (TSK-812)', () => {
  let companyId: string;
  let supplierId: string;
  let warehouseId: string;
  let productId: string;

  beforeAll(async () => {
    companyId = (
      await prisma.company.create({
        data: { name: `${PREFIX}Empresa`, isActive: true },
        select: { id: true },
      })
    ).id;
    supplierId = (
      await prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}PROV`,
          businessName: `${PREFIX}Proveedor`,
          taxId: '30912345678',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;
    productId = (
      await prisma.product.create({
        data: {
          companyId,
          code: `${PREFIX}PROD`,
          name: `${PREFIX}PROD`,
          usage: 'PURCHASE',
          trackStock: true,
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { companyId, code: 'T812RN-MAIN', name: `${PREFIX}Depósito`, type: 'MAIN' },
        select: { id: true },
      })
    ).id;
    await prisma.warehouseStock.create({
      data: { warehouseId, productId, quantity: 10, reservedQty: 0, availableQty: 10 },
    });

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
    if (companyId) {
      await prisma.stockMovement.deleteMany({ where: { companyId } });
      await prisma.warehouseStock.deleteMany({ where: { warehouse: { companyId } } });
      // Las líneas caen en cascada con el remito.
      await prisma.receivingNote.deleteMany({ where: { companyId } });
      await prisma.warehouse.deleteMany({ where: { companyId } });
      await prisma.product.deleteMany({ where: { companyId } });
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    await prisma.$disconnect();
  });

  it('dos confirmaciones simultáneas aplican los efectos una sola vez (TSK-812)', async () => {
    const note = await prisma.receivingNote.create({
      data: {
        companyId,
        supplierId,
        warehouseId,
        number: 1,
        fullNumber: `${PREFIX}RR-00001`,
        receptionDate: new Date('2026-03-10'),
        status: 'DRAFT',
        createdBy: 'test',
        lines: { create: [{ productId, description: `${PREFIX}línea`, quantity: 4 }] },
      },
      select: { id: true },
    });

    const results = await Promise.allSettled([
      confirmReceivingNote(note.id),
      confirmReceivingNote(note.id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as Error).message).toBe(
      'Solo se pueden confirmar remitos en borrador'
    );

    expect(
      (await prisma.receivingNote.findUniqueOrThrow({ where: { id: note.id } })).status
    ).toBe('CONFIRMED');
    expect(
      await prisma.stockMovement.count({
        where: { referenceType: 'receiving_note', referenceId: note.id },
      })
    ).toBe(1);
    const stock = await prisma.warehouseStock.findUniqueOrThrow({
      where: { warehouseId_productId: { warehouseId, productId } },
    });
    expect(Number(stock.quantity)).toBe(14);
    expect(Number(stock.availableQty)).toBe(14);
  });
});
