/**
 * Tests de integración del alta/edición de cuentas contables cuando el código
 * pertenece a una cuenta eliminada (TSK-822), contra la base real de desarrollo.
 *
 * Eliminar una cuenta es un soft delete (`isActive: false`): la cuenta
 * desaparece del Plan de Cuentas pero su código seguía ocupado por el
 * `@@unique([companyId, code])`, y el alta fallaba con un error que Next
 * redacta en producción. Ahora el código se libera si la eliminada no tiene
 * referencias, y todo error de negocio viaja como `ActionResult`.
 *
 * Mismo molde que `concepts-crud.integration.test.ts`: `describe.skipIf` sin
 * base, prefijo único y limpieza + verificación en el `afterAll`.
 */
import 'dotenv/config';
import { prisma } from '@/shared/lib/prisma';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', () => ({
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// `revalidateAccountingRoutes` hace `require('next/cache')`, que el mock de ESM no alcanza.
vi.mock('../../shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/utils')>()),
  revalidateAccountingRoutes: vi.fn(),
}));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { createAccount, deleteAccount, updateAccount } from './actions.server';

const PREFIX = 'TSK822-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('integración: código de una cuenta eliminada (TSK-822)', () => {
  let companyId: string;
  let banksId: string;

  /** Crea una hija de BANCOS y la elimina con la action real (soft delete). */
  async function createDeletedBank(code: string, name: string): Promise<string> {
    const account = await prisma.account.create({
      data: {
        companyId,
        code,
        name: `${PREFIX}${name}`,
        type: 'ASSET',
        nature: 'DEBIT',
        parentId: banksId,
      },
    });
    const result = await deleteAccount(companyId, account.id);
    expect(result).toEqual({ success: true });
    return account.id;
  }

  function bankInput(code: string, name: string) {
    return {
      code,
      name: `${PREFIX}${name}`,
      type: 'ASSET' as const,
      nature: 'DEBIT' as const,
      parentId: banksId,
    };
  }

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;
    const banks = await prisma.account.create({
      data: {
        companyId,
        code: '1.1.1/02/00',
        name: `${PREFIX}BANCOS`,
        type: 'ASSET',
        nature: 'DEBIT',
        isLeaf: false,
      },
    });
    banksId = banks.id;
    await prisma.account.create({
      data: {
        companyId,
        code: '1.1.1/02/01',
        name: `${PREFIX}Banco Galicia`,
        type: 'ASSET',
        nature: 'DEBIT',
        parentId: banksId,
      },
    });
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}user`);
  });

  afterAll(async () => {
    // Guarda: sin companyId Prisma omitiría el filtro y borraría la tabla entera.
    if (companyId) {
      await prisma.expenseCategory.deleteMany({ where: { companyId } });
      // Hijas antes que padres: la FK de la jerarquía no cascadea.
      await prisma.account.deleteMany({ where: { companyId, parentId: { not: null } } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    const [accounts, companies] = await Promise.all([
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
    ]);
    expect(accounts).toBe(0);
    expect(companies).toBe(0);
    await prisma.$disconnect();
  });

  it('crea la cuenta reutilizando el código de una eliminada sin referencias (el caso del ticket)', async () => {
    const deletedId = await createDeletedBank('1.1.1/02/02', 'Santander dólares');

    const result = await createAccount({
      companyId,
      input: bankInput('1.1.1/02/02', 'Mercado Pago'),
    });

    expect(result.success).toBe(true);
    const holders = await prisma.account.findMany({
      where: { companyId, code: '1.1.1/02/02' },
      select: { id: true, name: true, isActive: true, parentId: true },
    });
    expect(holders).toHaveLength(1);
    expect(holders[0]).toMatchObject({
      name: `${PREFIX}Mercado Pago`,
      isActive: true,
      parentId: banksId,
    });
    expect(holders[0].id).not.toBe(deletedId);
    // La eliminada se borró de verdad: no queda ningún registro con su id.
    expect(await prisma.account.count({ where: { id: deletedId } })).toBe(0);
  });

  it('no libera el código si la eliminada sigue asignada en otro lado, y lo dice', async () => {
    const deletedId = await createDeletedBank('1.1.1/02/03', 'Santander custodia');
    await prisma.expenseCategory.create({
      data: { companyId, name: `${PREFIX}Categoría`, accountId: deletedId },
    });

    const result = await createAccount({
      companyId,
      input: bankInput('1.1.1/02/03', 'Otra'),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('1.1.1/02/03');
    expect(result.error).toContain('eliminada');
    expect(result.error).toContain(`${PREFIX}Santander custodia`);
    expect(result.error).toContain('Categorías de egreso');
    // La eliminada y su referencia quedan intactas.
    const category = await prisma.expenseCategory.findFirst({
      where: { companyId, name: `${PREFIX}Categoría` },
      select: { accountId: true },
    });
    expect(category?.accountId).toBe(deletedId);
  });

  it('rechaza un código de una cuenta activa con un mensaje que llega al cliente', async () => {
    const result = await createAccount({
      companyId,
      input: bankInput('1.1.1/02/01', 'Duplicada'),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('Ya existe una cuenta con el código 1.1.1/02/01');
  });

  it('devuelve los errores de formato y de tipo de padre como resultado, no como excepción', async () => {
    const badFormat = await createAccount({
      companyId,
      input: bankInput('0.1.1/02/09', 'Formato'),
    });
    expect(badFormat).toEqual({
      success: false,
      error: expect.stringContaining('no puede tener 0 como primer segmento'),
    });

    const badParent = await createAccount({
      companyId,
      input: { ...bankInput('1.1.1/02/09', 'Pasivo'), type: 'LIABILITY', nature: 'CREDIT' },
    });
    expect(badParent).toEqual({
      success: false,
      error: 'La cuenta padre debe ser del mismo tipo que la cuenta',
    });
  });

  it('al editar, también libera el código de una eliminada y rechaza el de una activa', async () => {
    const deletedId = await createDeletedBank('1.1.1/02/05', 'Vieja');
    const editable = await prisma.account.create({
      data: {
        companyId,
        code: '1.1.1/02/06',
        name: `${PREFIX}Editable`,
        type: 'ASSET',
        nature: 'DEBIT',
        parentId: banksId,
      },
    });

    const moved = await updateAccount(companyId, editable.id, { code: '1.1.1/02/05' });
    expect(moved.success).toBe(true);
    expect(await prisma.account.count({ where: { id: deletedId } })).toBe(0);
    const reloaded = await prisma.account.findUnique({
      where: { id: editable.id },
      select: { code: true },
    });
    expect(reloaded?.code).toBe('1.1.1/02/05');

    const clash = await updateAccount(companyId, editable.id, { code: '1.1.1/02/01' });
    expect(clash.success).toBe(false);
    if (clash.success) return;
    expect(clash.error).toContain('Ya existe una cuenta con el código 1.1.1/02/01');
  });

  it('el padre vuelve a ser imputable cuando se eliminan todas sus hijas', async () => {
    const parent = await prisma.account.create({
      data: {
        companyId,
        code: '1.1.1/03/00',
        name: `${PREFIX}Padre`,
        type: 'ASSET',
        nature: 'DEBIT',
        isLeaf: false,
      },
    });
    const [first, second] = await Promise.all(
      ['1.1.1/03/01', '1.1.1/03/02'].map((code) =>
        prisma.account.create({
          data: {
            companyId,
            code,
            name: `${PREFIX}Hija ${code}`,
            type: 'ASSET',
            nature: 'DEBIT',
            parentId: parent.id,
          },
        })
      )
    );

    await deleteAccount(companyId, first.id);
    expect(
      (await prisma.account.findUnique({ where: { id: parent.id }, select: { isLeaf: true } }))
        ?.isLeaf
    ).toBe(false);

    await deleteAccount(companyId, second.id);
    expect(
      (await prisma.account.findUnique({ where: { id: parent.id }, select: { isLeaf: true } }))
        ?.isLeaf
    ).toBe(true);
  });
});
