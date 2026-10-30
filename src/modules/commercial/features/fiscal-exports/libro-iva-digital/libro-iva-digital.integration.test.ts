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

describe.skipIf(!dbAvailable)('Libro IVA Digital: alícuotas de venta con descuento global (TSK-762)', () => {
  const PREFIX_762 = 'TSK762-LIBRO-';
  let companyId: string;

  beforeAll(async () => {
    ({ id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX_762}Empresa`, isActive: true },
      select: { id: true },
    }));
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    const [customer, pointOfSale, product] = await Promise.all([
      prisma.contractor.create({ data: { companyId, name: `${PREFIX_762}Cliente`, taxId: '20111111112' } }),
      prisma.salesPointOfSale.create({ data: { companyId, number: 9762, name: `${PREFIX_762}PV`, createdBy: 'test' } }),
      prisma.product.create({
        data: { companyId, code: `${PREFIX_762}P`, name: `${PREFIX_762}Producto`, usage: 'SALE', trackStock: false, createdBy: 'test' },
      }),
    ]);
    // Neto 1000 (21%) + 500 (10,5%) con 10% de descuento global: la cabecera guarda neto 1350 e IVA
    // 236,25; las líneas, sus importes antes del descuento.
    await prisma.salesInvoice.create({
      data: {
        companyId,
        customerId: customer.id,
        pointOfSaleId: pointOfSale.id,
        voucherType: 'FACTURA_A',
        number: 1,
        fullNumber: '9762-00000001',
        issueDate: new Date('2026-07-15T12:00:00.000Z'),
        status: 'CONFIRMED',
        subtotal: 1350,
        netTaxed: 1350,
        vatAmount: 236.25,
        total: 1586.25,
        globalDiscountPercent: 10,
        totalBeforeDiscount: 1500,
        discountTotal: 150,
        createdBy: 'test',
        lines: {
          create: [
            { productId: product.id, description: '21', quantity: 1, unitPrice: 1000, vatRate: 21, vatAmount: 210, subtotal: 1000, total: 1210 },
            { productId: product.id, description: '10,5', quantity: 1, unitPrice: 500, vatRate: 10.5, vatAmount: 52.5, subtotal: 500, total: 552.5 },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    if (!companyId) return;
    await prisma.salesInvoice.deleteMany({ where: { companyId } });
    await prisma.product.deleteMany({ where: { companyId } });
    await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
    await prisma.contractor.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });

  it('cada alícuota va con su base e IVA ya descontados y suman la cabecera', async () => {
    const result = await generateLibroIVADigital(2026, 7);
    const rows = result.ventas.alicuotas.split('\r\n').map((line) => ({
      neto: Number(line.slice(28, 43)) / 100,
      codigo: Number(line.slice(43, 47)),
      iva: Number(line.slice(47, 62)) / 100,
    }));

    expect(rows).toEqual([
      { neto: 900, codigo: 5, iva: 189 },
      { neto: 450, codigo: 4, iva: 47.25 },
    ]);
  });
});

describe.skipIf(!dbAvailable)('Libro IVA Digital: consumidor final y gastos bancarios (TSK-814)', () => {
  const PREFIX_814 = 'TSK814-LIBRO-';
  let companyId: string;
  const issueDate = new Date('2026-08-14T15:00:00.000Z');

  beforeAll(async () => {
    ({ id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX_814}Empresa`, isActive: true },
      select: { id: true },
    }));
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    const [anonymous, withDni, pointOfSale, bank] = await Promise.all([
      prisma.contractor.create({ data: { companyId, name: `${PREFIX_814}Mostrador` } }),
      prisma.contractor.create({ data: { companyId, name: `${PREFIX_814}Gomez Ana`, taxId: '28111222' } }),
      prisma.salesPointOfSale.create({ data: { companyId, number: 9814, name: `${PREFIX_814}PV`, createdBy: 'test' } }),
      prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX_814}BANCO`,
          businessName: `${PREFIX_814}Banco`,
          taxId: '30500010912',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
      }),
    ]);
    const amounts = { subtotal: 1000, netTaxed: 1000, vatAmount: 210, total: 1210 };
    for (const [number, customer] of [anonymous, withDni].entries()) {
      await prisma.salesInvoice.create({
        data: {
          companyId,
          customerId: customer.id,
          pointOfSaleId: pointOfSale.id,
          voucherType: 'FACTURA_B',
          number: number + 1,
          fullNumber: `9814-${String(number + 1).padStart(8, '0')}`,
          issueDate,
          status: 'CONFIRMED',
          ...amounts,
          createdBy: 'test',
        },
      });
    }
    // Resumen bancario de agosto: comisiones con IVA discriminado.
    await prisma.purchaseInvoice.create({
      data: {
        companyId,
        supplierId: bank.id,
        voucherType: 'GASTOS_BANCARIOS',
        pointOfSale: '0001',
        number: '00000815',
        fullNumber: '0001-00000815',
        issueDate,
        status: 'CONFIRMED',
        ...amounts,
        createdBy: 'test',
        lines: {
          create: [
            { description: 'Comisiones', quantity: 1, unitCost: 1000, vatRate: 21, vatAmount: 210, subtotal: 1000, total: 1210 },
          ],
        },
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

  it('venta a consumidor final sin identificar: código 99, número 0 y "CONSUMIDOR FINAL"', async () => {
    const [anonymous, withDni] = (await generateLibroIVADigital(2026, 8)).ventas.cabecera.split('\r\n');

    expect(anonymous.slice(56, 58)).toBe('99');
    expect(anonymous.slice(58, 78)).toBe('0'.repeat(20));
    expect(anonymous.slice(78, 108)).toBe('CONSUMIDOR FINAL'.padEnd(30));
    // Identificado con DNI: va su documento y su nombre.
    expect(withDni.slice(56, 58)).toBe('96');
    expect(withDni.slice(78, 108)).toBe(`${PREFIX_814}Gomez Ana`.padEnd(30));
  });

  it('gastos bancarios: comprobante 099 con punto de venta en ceros, también en sus alícuotas', async () => {
    const { compras } = await generateLibroIVADigital(2026, 8);

    expect(compras.cabecera.slice(8, 11)).toBe('099');
    expect(compras.cabecera.slice(11, 16)).toBe('00000');
    expect(compras.cabecera.slice(16, 36)).toBe('815'.padStart(20, '0'));
    expect(compras.alicuotas.slice(0, 3)).toBe('099');
    expect(compras.alicuotas.slice(3, 8)).toBe('00000');
  });
});
