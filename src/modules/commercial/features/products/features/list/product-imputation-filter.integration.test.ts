/**
 * Tests de integración del facet y filtro "Imputación" del listado de ítems
 * (TSK-721) contra la base real de desarrollo.
 *
 * Sigue el criterio de `role-members.integration.test.ts` (TSK-692): se aísla
 * ÚNICAMENTE la frontera de sesión/permisos/empresa activa/caché de Next (los
 * cuatro `vi.mock` de abajo). `getProducts`, `getProductFacetCounts` y
 * `getItemsWithoutAccountCounts` son el código real de producción.
 *
 * Lo que se verifica:
 * - El conteo del facet distingue por `usage`: un ítem solo de compra sin
 *   cuenta de ingresos NO cuenta como "sin ingreso", y viceversa.
 * - El filtro `imputation` trae exactamente los ítems esperados y los dos
 *   valores juntos se combinan con OR.
 * - El conteo de Ajustes contables (`getItemsWithoutAccountCounts`, Prisma
 *   directo sin importar de `commercial`) coincide con el facet para ítems
 *   ACTIVOS: ata los dos literales de `usage` duplicados a propósito.
 *
 * Aislamiento de datos: prefijo `TSK721-PROD-`, empresa dedicada, limpieza
 * completa en el `afterAll`. Si la base no está disponible, el archivo se
 * saltea con `describe.skipIf` (no falla).
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// Frontera aislada: sesión, permisos, empresa activa y caché de Next. El mock
// de permisos conserva el módulo original (constantes, tipos) y solo
// reemplaza `checkPermission`.
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

// Código real de producción.
import { getProductFacetCounts, getProducts } from './actions.server';
// Solo en el test: ata el conteo de Ajustes contables al facet de ítems.
import { getItemsWithoutAccountCounts } from '@/modules/accounting/features/settings/actions.server';

const PREFIX = 'TSK721-PROD-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('integración: facet y filtro "Imputación" de ítems (TSK-721)', () => {
  let companyId: string;
  let ventaSinId: string;
  let compraSinId: string;
  let ambosOkId: string;
  let ambosSinIngresoId: string;

  const codesOf = (page: Awaited<ReturnType<typeof getProducts>>) =>
    page.data.map((p) => p.code).sort();

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const [ingresos, egresos] = await Promise.all([
      prisma.account.create({
        data: {
          companyId,
          code: 'T721-VENTAS',
          name: `${PREFIX}Ventas`,
          type: 'REVENUE',
          nature: 'CREDIT',
        },
      }),
      prisma.account.create({
        data: {
          companyId,
          code: 'T721-COMPRAS',
          name: `${PREFIX}Compras`,
          type: 'EXPENSE',
          nature: 'DEBIT',
        },
      }),
    ]);

    const mkProduct = (
      code: string,
      usage: 'SALE' | 'PURCHASE' | 'PURCHASE_SALE',
      accounts: { defaultIncomeAccountId?: string; defaultExpenseAccountId?: string } = {}
    ) =>
      prisma.product.create({
        data: {
          companyId,
          code: `${PREFIX}${code}`,
          name: `${PREFIX}${code}`,
          usage,
          createdBy: 'test',
          ...accounts,
        },
        select: { id: true },
      });

    const [ventaSin, compraSin, ambosOk, ambosSinIngreso] = await Promise.all([
      mkProduct('VENTA-SIN', 'SALE'),
      mkProduct('COMPRA-SIN', 'PURCHASE'),
      mkProduct('AMBOS-OK', 'PURCHASE_SALE', {
        defaultIncomeAccountId: ingresos.id,
        defaultExpenseAccountId: egresos.id,
      }),
      mkProduct('AMBOS-SIN-INGRESO', 'PURCHASE_SALE', { defaultExpenseAccountId: egresos.id }),
    ]);
    ventaSinId = ventaSin.id;
    compraSinId = compraSin.id;
    ambosOkId = ambosOk.id;
    ambosSinIngresoId = ambosSinIngreso.id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}usuario`);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });

    expect(await prisma.product.count({ where: { code: { startsWith: PREFIX } } })).toBe(0);
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
  });

  it('el facet cuenta por uso: 2 sin ingreso (venta y ambos), 1 sin egreso (compra)', async () => {
    const counts = await getProductFacetCounts();
    expect(counts.imputation).toEqual({ noIncome: 2, noExpense: 1 });
  });

  it('"sin cuenta de ingreso" trae solo el de venta y el de ambos sin ingreso', async () => {
    const page = await getProducts({ filters: { imputation: ['noIncome'] }, pageSize: 50 });
    expect(codesOf(page)).toEqual([`${PREFIX}AMBOS-SIN-INGRESO`, `${PREFIX}VENTA-SIN`]);
    expect(page.data.map((p) => p.id).sort()).toEqual([ventaSinId, ambosSinIngresoId].sort());
    expect(page.pagination.total).toBe(2);
  });

  it('"sin cuenta de egreso" trae solo el de compra', async () => {
    const page = await getProducts({ filters: { imputation: ['noExpense'] }, pageSize: 50 });
    expect(codesOf(page)).toEqual([`${PREFIX}COMPRA-SIN`]);
    expect(page.data[0].id).toBe(compraSinId);
  });

  it('los dos valores juntos se combinan con OR y dejan afuera al que tiene las dos cuentas', async () => {
    const page = await getProducts({
      filters: { imputation: ['noIncome', 'noExpense'] },
      pageSize: 50,
    });
    expect(codesOf(page)).toEqual([
      `${PREFIX}AMBOS-SIN-INGRESO`,
      `${PREFIX}COMPRA-SIN`,
      `${PREFIX}VENTA-SIN`,
    ]);
    expect(page.data.map((p) => p.id)).not.toContain(ambosOkId);
  });

  it('sin el filtro se siguen trayendo los cuatro ítems', async () => {
    const page = await getProducts({ pageSize: 50 });
    expect(page.pagination.total).toBe(4);
  });

  it('el conteo de Ajustes contables coincide con el facet para ítems activos', async () => {
    const counts = await getItemsWithoutAccountCounts(companyId);
    expect(counts).toEqual({ saleItemsWithoutIncome: 2, purchaseItemsWithoutExpense: 1 });
  });
});
