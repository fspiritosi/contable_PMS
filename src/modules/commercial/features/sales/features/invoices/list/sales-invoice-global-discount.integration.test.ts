/**
 * Asiento de una factura de venta con descuento global (TSK-762), contra la base real.
 *
 * Las líneas guardan su neto e IVA **antes** del descuento global; la cabecera (neto, IVA y
 * total) ya lo descuenta, prorrateado por línea (`buildSalesInvoiceAmounts`). El asiento armaba
 * neto e IVA con los importes de línea y Deudores con el total: quedaba descuadrado por el
 * descuento y la confirmación se rechazaba. Criterio: igual que el descuento por línea, el global
 * reduce el neto de cada línea (y su IVA) en proporción; no hay cuenta de descuentos otorgados. El
 * IVA del asiento es el del comprobante, que es el que se informa a ARCA.
 *
 * Los importes se arman con el `buildSalesInvoiceAmounts` real (lo que guarda `createInvoice`) y
 * la factura se crea con Prisma en DRAFT, como en `sales-invoice-vat-rounding.integration.test.ts`.
 * Se entra por el `confirmInvoice` real.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { prisma } from '@/shared/lib/prisma';

vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

import { cleanupAccountingCompany } from '@/modules/accounting/shared/test-utils/cleanup-accounting-company';

import { buildSalesInvoiceAmounts } from '../shared/totals';
import { createInvoiceSchema } from '../shared/validators';
import { confirmInvoice } from './actions.server';

const PREFIX = 'TSK762-DTO-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

interface SaleLine {
  unitPrice: string;
  vatRate: string;
  allocations?: { costCenterId: string; percentage: number }[];
}

describe.skipIf(!dbAvailable)('integración: asiento de venta con descuento global (TSK-762)', () => {
  let companyId: string;
  let customerId: string;
  /** La NC va a otro cliente: con el mismo, se imputaría sola a las facturas de los otros casos. */
  let customerNcId: string;
  let pointOfSaleId: string;
  let productId: string;
  let ventasId: string;
  let cobrarId: string;
  let ivaDf21Id: string;
  let ivaDf105Id: string;
  let centroA: string;
  let centroB: string;
  let nextNumber = 1;

  /** Factura en DRAFT con los importes que guarda `createInvoice`. */
  async function createDraftSale(
    lines: SaleLine[],
    discount: { percent?: string; amount?: string },
    voucherType: 'FACTURA_A' | 'NOTA_CREDITO_A' = 'FACTURA_A'
  ) {
    const customer = voucherType === 'NOTA_CREDITO_A' ? customerNcId : customerId;
    const input = createInvoiceSchema.parse({
      customerId: customer,
      pointOfSaleId,
      voucherType,
      issueDate: '2026-03-10',
      lines: lines.map((line, i) => ({
        productId,
        description: `Línea ${i + 1}`,
        quantity: '1',
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        costCenterAllocations: line.allocations,
      })),
      globalDiscountPercent: discount.percent,
      globalDiscountAmount: discount.amount,
    });
    const { linesData, amounts } = buildSalesInvoiceAmounts(input);
    const number = nextNumber++;
    const invoice = await prisma.salesInvoice.create({
      data: {
        companyId,
        customerId: customer,
        pointOfSaleId,
        voucherType,
        number,
        fullNumber: `0001-${String(number).padStart(8, '0')}`,
        issueDate: new Date('2026-03-10'),
        createdBy: 'test',
        ...amounts,
        lines: { create: linesData },
      },
      select: { id: true, subtotal: true, vatAmount: true, total: true },
    });
    return invoice;
  }

  async function confirmedEntryLines(id: string) {
    const result = await confirmInvoice(id);
    expect(result).toEqual({ success: true, id });
    const { journalEntryId } = await prisma.salesInvoice.findUniqueOrThrow({
      where: { id },
      select: { journalEntryId: true },
    });
    const rows = await prisma.journalEntryLine.findMany({
      where: { entryId: journalEntryId! },
      select: { accountId: true, debit: true, credit: true, costCenterId: true },
    });
    return rows.map((r) => ({
      accountId: r.accountId,
      costCenterId: r.costCenterId,
      debit: Number(r.debit),
      credit: Number(r.credit),
    }));
  }

  const sumOf = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `${PREFIX}Empresa`, isActive: true } });
    companyId = company.id;

    const mk = (code: string, name: string, type: 'ASSET' | 'LIABILITY' | 'REVENUE', nature: 'DEBIT' | 'CREDIT') =>
      prisma.account.create({ data: { companyId, code, name: `${PREFIX}${name}`, type, nature } });
    const [ventas, cobrar, ivaDf21, ivaDf105] = await Promise.all([
      mk('T762-VENTAS', 'Ventas', 'REVENUE', 'CREDIT'),
      mk('T762-COBRAR', 'Cuentas por Cobrar', 'ASSET', 'DEBIT'),
      mk('T762-IVADF21', 'IVA DF 21', 'LIABILITY', 'CREDIT'),
      mk('T762-IVADF105', 'IVA DF 10.5', 'LIABILITY', 'CREDIT'),
    ]);
    ventasId = ventas.id;
    cobrarId = cobrar.id;
    ivaDf21Id = ivaDf21.id;
    ivaDf105Id = ivaDf105.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        salesAccountId: ventasId,
        receivablesAccountId: cobrarId,
        vatDebitAccountId: ivaDf21Id,
        requireCostCenter: false,
        vatAccounts: { create: [{ vatRate: 10.5, side: 'DEBIT', accountId: ivaDf105Id }] },
      },
    });

    const [a, b] = await Promise.all([
      prisma.costCenter.create({ data: { companyId, name: `${PREFIX}Centro A` }, select: { id: true } }),
      prisma.costCenter.create({ data: { companyId, name: `${PREFIX}Centro B` }, select: { id: true } }),
    ]);
    centroA = a.id;
    centroB = b.id;

    customerId = (await prisma.contractor.create({ data: { companyId, name: `${PREFIX}Cliente` } })).id;
    customerNcId = (await prisma.contractor.create({ data: { companyId, name: `${PREFIX}Cliente NC` } })).id;
    pointOfSaleId = (
      await prisma.salesPointOfSale.create({ data: { companyId, number: 9762, name: `${PREFIX}PDV`, createdBy: 'test' } })
    ).id;
    productId = (
      await prisma.product.create({
        data: { companyId, code: `${PREFIX}P`, name: `${PREFIX}Producto`, usage: 'SALE', trackStock: false, createdBy: 'test' },
        select: { id: true },
      })
    ).id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    if (!companyId) return;
    await prisma.salesCreditNoteApplication.deleteMany({ where: { companyId } });
    await prisma.salesInvoice.deleteMany({ where: { companyId } });
    await cleanupAccountingCompany(companyId);
    await prisma.product.deleteMany({ where: { companyId } });
    await prisma.contractor.deleteMany({ where: { companyId } });
    await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
    await prisma.accountingSettings.deleteMany({ where: { companyId } });
    await prisma.costCenter.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });

    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    await prisma.$disconnect();
  });

  it('10% sobre dos alícuotas: neto, IVA y centros con descuento; el asiento cuadra con el total', async () => {
    // Neto 1000 (21%, centro A) + 500 (10,5%, 50/50 A-B) = 1500; descuento 150 → neto 1350.
    // IVA: 900 × 21% = 189 + 450 × 10,5% = 47,25 → 236,25. Total 1586,25.
    const invoice = await createDraftSale(
      [
        { unitPrice: '1000', vatRate: '21', allocations: [{ costCenterId: centroA, percentage: 100 }] },
        {
          unitPrice: '500',
          vatRate: '10.5',
          allocations: [
            { costCenterId: centroA, percentage: 50 },
            { costCenterId: centroB, percentage: 50 },
          ],
        },
      ],
      { percent: '10' }
    );
    expect([Number(invoice.subtotal), Number(invoice.vatAmount), Number(invoice.total)]).toEqual([1350, 236.25, 1586.25]);

    const lines = await confirmedEntryLines(invoice.id);

    expect(lines.find((l) => l.accountId === cobrarId)?.debit).toBe(1586.25);
    const ventas = lines.filter((l) => l.accountId === ventasId);
    expect(sumOf(ventas.map((l) => l.credit))).toBe(1350);
    expect(ventas.find((l) => l.costCenterId === centroA)?.credit).toBe(1125); // 900 + 225
    expect(ventas.find((l) => l.costCenterId === centroB)?.credit).toBe(225);
    expect(lines.find((l) => l.accountId === ivaDf21Id)?.credit).toBe(189);
    expect(lines.find((l) => l.accountId === ivaDf105Id)?.credit).toBe(47.25);
    expect(sumOf(lines.map((l) => l.credit))).toBe(1586.25);
  });

  it('nota de crédito con descuento en monto: el asiento espeja la factura con el descuento', async () => {
    // Neto 1000 (21%) + 500 (10,5%); descuento $100 prorrateado 2/3 - 1/3 → neto 1400.
    // IVA: 933,33 × 21% = 196 + 466,67 × 10,5% = 49 → 245. Total 1645.
    const invoice = await createDraftSale(
      [
        { unitPrice: '1000', vatRate: '21' },
        { unitPrice: '500', vatRate: '10.5' },
      ],
      { amount: '100' },
      'NOTA_CREDITO_A'
    );
    expect([Number(invoice.subtotal), Number(invoice.vatAmount), Number(invoice.total)]).toEqual([1400, 245, 1645]);

    const lines = await confirmedEntryLines(invoice.id);

    expect(lines.find((l) => l.accountId === cobrarId)?.credit).toBe(1645);
    expect(sumOf(lines.filter((l) => l.accountId === ventasId).map((l) => l.debit))).toBe(1400);
    expect(lines.find((l) => l.accountId === ivaDf21Id)?.debit).toBe(196);
    expect(lines.find((l) => l.accountId === ivaDf105Id)?.debit).toBe(49);
    expect(sumOf(lines.map((l) => l.debit))).toBe(1645);
  });

  it('descuento que no divide exacto: los centavos van a una línea y el asiento sigue cuadrando', async () => {
    // 3 × 333,33 = 999,99; 7% = 70,00 → neto 929,99; IVA 195,30; total 1125,29.
    const invoice = await createDraftSale(
      [
        { unitPrice: '333.33', vatRate: '21' },
        { unitPrice: '333.33', vatRate: '21' },
        { unitPrice: '333.33', vatRate: '21' },
      ],
      { percent: '7' }
    );
    expect([Number(invoice.subtotal), Number(invoice.vatAmount), Number(invoice.total)]).toEqual([929.99, 195.3, 1125.29]);

    const lines = await confirmedEntryLines(invoice.id);

    expect(lines.find((l) => l.accountId === cobrarId)?.debit).toBe(1125.29);
    expect(sumOf(lines.filter((l) => l.accountId === ventasId).map((l) => l.credit))).toBe(929.99);
    expect(lines.find((l) => l.accountId === ivaDf21Id)?.credit).toBe(195.3);
    expect(sumOf(lines.map((l) => l.credit))).toBe(1125.29);
  });
});
