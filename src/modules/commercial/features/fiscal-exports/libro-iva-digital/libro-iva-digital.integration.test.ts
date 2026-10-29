/**
 * Libro IVA Digital: qué comprobantes entran según su estado (TSK-796), contra
 * la base real (`contable-pms-db`).
 *
 * Una factura cobrada o pagada (total o parcial) sigue siendo un comprobante
 * del mes: entra al libro igual que una confirmada. Solo quedan afuera el
 * borrador y la anulada. Además, cada registro respeta el largo del diseño de ARCA y
 * las compras B no generan alícuotas. Todo lo creado lleva el prefijo `TSK796-TEST-`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));

import { getActiveCompanyId } from '@/shared/lib/company';

import { generateLibroIVADigital } from './actions.server';

const PREFIX = 'TSK796-TEST-';
const ISSUE_DATE = new Date('2026-06-15T12:00:00.000Z');
const STATUSES = ['DRAFT', 'CONFIRMED', 'PAID', 'PARTIAL_PAID', 'CANCELLED'] as const;

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('Libro IVA Digital: estados que entran al libro (TSK-796)', () => {
  let companyId: string;

  beforeAll(async () => {
    ({ id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
      select: { id: true },
    }));
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);

    const [customer, supplier, pointOfSale] = await Promise.all([
      prisma.contractor.create({
        data: { companyId, name: `${PREFIX}Cliente`, taxId: '20111111112' },
        select: { id: true },
      }),
      prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}PROV`,
          businessName: `${PREFIX}Proveedor`,
          taxId: '30796000019',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
        select: { id: true },
      }),
      prisma.salesPointOfSale.create({
        data: { companyId, number: 9796, name: `${PREFIX}PV`, createdBy: 'test' },
        select: { id: true },
      }),
    ]);

    const amounts = { subtotal: 1000, netTaxed: 1000, vatAmount: 210, total: 1210 };
    for (const [i, status] of STATUSES.entries()) {
      const number = i + 1;
      await prisma.salesInvoice.create({
        data: {
          companyId,
          customerId: customer.id,
          pointOfSaleId: pointOfSale.id,
          voucherType: 'FACTURA_A',
          number,
          fullNumber: `9796-${String(number).padStart(8, '0')}`,
          issueDate: ISSUE_DATE,
          status,
          ...amounts,
          createdBy: 'test',
        },
      });
      await prisma.purchaseInvoice.create({
        data: {
          companyId,
          supplierId: supplier.id,
          voucherType: 'FACTURA_A',
          pointOfSale: '0001',
          number: String(number).padStart(8, '0'),
          fullNumber: `0001-${String(number).padStart(8, '0')}`,
          issueDate: ISSUE_DATE,
          status,
          ...amounts,
          createdBy: 'test',
        },
      });
    }
    // Factura B de compra: no discrimina IVA.
    await prisma.purchaseInvoice.create({
      data: {
        companyId,
        supplierId: supplier.id,
        voucherType: 'FACTURA_B',
        pointOfSale: '0001',
        number: '00000006',
        fullNumber: '0001-00000006',
        issueDate: ISSUE_DATE,
        status: 'CONFIRMED',
        subtotal: 1210,
        netTaxed: 1210,
        vatAmount: 0,
        total: 1210,
        createdBy: 'test',
      },
    });
  });

  afterAll(async () => {
    if (!companyId) return;
    await prisma.salesInvoice.deleteMany({ where: { companyId } });
    await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
    await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
    await prisma.supplier.deleteMany({ where: { companyId } });
    await prisma.contractor.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });

  it('incluye las confirmadas, cobradas/pagadas y parciales; excluye borrador y anulada', async () => {
    const result = await generateLibroIVADigital(2026, 6);

    // Números 2, 3 y 4: CONFIRMED, PAID y PARTIAL_PAID (más la compra B, número 6).
    const numbersIn = (cabecera: string) =>
      cabecera.split('\r\n').map((line) => Number(line.slice(16, 36)));

    expect(result.ventas.registros).toBe(3);
    expect(numbersIn(result.ventas.cabecera)).toEqual([2, 3, 4]);
    expect(result.compras.registros).toBe(4);
    expect(numbersIn(result.compras.cabecera)).toEqual([2, 3, 4, 6]);
  });

  it('cada archivo respeta el largo de registro de ARCA y la compra B no tiene alícuotas', async () => {
    const result = await generateLibroIVADigital(2026, 6);
    const lengths = (content: string) => [...new Set(content.split('\r\n').map((l) => l.length))];

    expect(lengths(result.ventas.cabecera)).toEqual([266]);
    expect(lengths(result.ventas.alicuotas)).toEqual([62]);
    expect(lengths(result.compras.cabecera)).toEqual([325]);
    expect(lengths(result.compras.alicuotas)).toEqual([84]);

    const compraB = result.compras.cabecera.split('\r\n')[3];
    expect(compraB.slice(237, 238)).toBe('0'); // cantidad de alícuotas
    expect(result.compras.alicuotas.split('\r\n')).toHaveLength(3);
  });
});
