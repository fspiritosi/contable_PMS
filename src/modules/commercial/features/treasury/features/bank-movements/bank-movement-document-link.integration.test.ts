/**
 * Tests de integración del vínculo manual de un movimiento bancario con una OP
 * (TSK-792): `linkBankMovementToDocument` marca `MANUAL_LINK` y
 * `unlinkBankMovementFromDocument` lo limpia. Prefijo propio `TSK792-LNK-`.
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

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

import { linkBankMovementToDocument, unlinkBankMovementFromDocument } from './actions.server';

const PREFIX = 'TSK792-LNK-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('vínculo manual de movimientos bancarios (TSK-792)', () => {
  let companyId = '';
  let movementId = '';
  let orderId = '';

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
      select: { id: true },
    });
    companyId = company.id;
    const bank = await prisma.bankAccount.create({
      data: {
        companyId,
        bankName: `${PREFIX}Banco`,
        accountNumber: `${PREFIX}0001`,
        accountType: 'CHECKING',
        balance: 1000,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    const movement = await prisma.bankMovement.create({
      data: {
        companyId,
        bankAccountId: bank.id,
        type: 'WITHDRAWAL',
        amount: 100,
        date: new Date('2026-03-10T12:00:00.000Z'),
        description: `${PREFIX}movimiento`,
        createdBy: 'test',
      },
      select: { id: true },
    });
    movementId = movement.id;
    const order = await prisma.paymentOrder.create({
      data: {
        companyId,
        number: 1,
        fullNumber: `${PREFIX}OP-00001`,
        date: new Date('2026-03-10T12:00:00.000Z'),
        totalAmount: 100,
        status: 'DRAFT',
        createdBy: 'test',
      },
      select: { id: true },
    });
    orderId = order.id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    if (companyId) {
      await prisma.bankMovement.deleteMany({ where: { companyId } });
      await prisma.paymentOrder.deleteMany({ where: { companyId } });
      await prisma.bankAccount.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    await prisma.$disconnect();
  });

  it('vincular marca MANUAL_LINK y desvincular lo limpia', async () => {
    await linkBankMovementToDocument(movementId, 'PAYMENT_ORDER', orderId);
    const linked = await prisma.bankMovement.findUniqueOrThrow({
      where: { id: movementId },
      select: { paymentOrderId: true, documentLink: true },
    });
    expect(linked).toEqual({ paymentOrderId: orderId, documentLink: 'MANUAL_LINK' });

    await unlinkBankMovementFromDocument(movementId);
    const unlinked = await prisma.bankMovement.findUniqueOrThrow({
      where: { id: movementId },
      select: { paymentOrderId: true, documentLink: true },
    });
    expect(unlinked).toEqual({ paymentOrderId: null, documentLink: null });
  });
});
