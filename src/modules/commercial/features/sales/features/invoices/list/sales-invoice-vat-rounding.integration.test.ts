/**
 * El asiento de una factura de venta cuadra con el total guardado del
 * comprobante aunque el IVA por línea redondeado no sume el IVA del
 * comprobante (TSK-760, R-1), contra la base real.
 *
 * `createInvoice` calcula el IVA del comprobante sobre la suma
 * (`Σ subtotal × alícuota`, redondeado una vez) y guarda el de cada línea
 * redondeado por separado: dos líneas de $1,07 al 21% dan IVA 0,45 y total
 * 2,59, pero las líneas suman 0,22 + 0,22 = 0,44. El asiento usaba la suma de
 * las líneas (2,58) y el núcleo, que compara con `Decimal` (C5), lo rechazaba:
 * "Diferencia: $0.01". Criterio: el comprobante manda; la diferencia va a la
 * línea de IVA de mayor importe.
 *
 * Las facturas se crean con Prisma en `DRAFT` con los importes que guarda
 * `createInvoice` (que exige AFIP y numeración), como en
 * `sales-invoice-line-accounts.integration.test.ts`. Se entra por el
 * `confirmInvoice` real.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// El núcleo contable (TSK-760) abre con `import 'server-only'` (marcador de Next).
vi.mock('server-only', () => ({}));

import { prisma } from '@/shared/lib/prisma';

// Frontera aislada: sesión, permisos, empresa activa y caché de Next.
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

// Código real de producción.
import { confirmInvoice } from './actions.server';

const PREFIX = 'TSK760R1-SALE-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

interface DraftLine {
  unitPrice: number;
  vatRate: number;
  /** IVA de la línea, redondeado como lo guarda `createInvoice`. */
  vatAmount: number;
}

interface DraftHeader {
  subtotal: number;
  vatAmount: number;
  total: number;
}

describe.skipIf(!dbAvailable)('integración: IVA del asiento de venta = IVA del comprobante (TSK-760, R-1)', () => {
  let companyId: string;
  let customerId: string;
  let customerNcId: string;
  let pointOfSaleId: string;
  let productId: string;
  let ventasId: string;
  let cobrarId: string;
  let ivaDf21Id: string;
  let ivaDf105Id: string;
  let nextNumber = 1;

  async function createDraftSale(
    lines: DraftLine[],
    header: DraftHeader,
    options: { voucherType?: 'FACTURA_A' | 'NOTA_CREDITO_A'; customerId?: string } = {}
  ) {
    const number = nextNumber++;
    const invoice = await prisma.salesInvoice.create({
      data: {
        companyId,
        customerId: options.customerId ?? customerId,
        pointOfSaleId,
        voucherType: options.voucherType ?? 'FACTURA_A',
        number,
        fullNumber: `0001-${String(number).padStart(8, '0')}`,
        issueDate: new Date('2026-03-10'),
        subtotal: header.subtotal,
        netTaxed: header.subtotal,
        vatAmount: header.vatAmount,
        total: header.total,
        totalBeforeDiscount: header.subtotal,
        discountTotal: 0,
        createdBy: 'test',
        lines: {
          create: lines.map((line, i) => ({
            productId,
            description: `Línea ${i + 1}`,
            quantity: 1,
            unitPrice: line.unitPrice,
            lineType: 'TAXED' as const,
            vatRate: line.vatRate,
            vatAmount: line.vatAmount,
            subtotal: line.unitPrice,
            total: Math.round((line.unitPrice + line.vatAmount) * 100) / 100,
          })),
        },
      },
      select: { id: true },
    });
    return invoice.id;
  }

  async function confirmedEntryLines(id: string) {
    const result = await confirmInvoice(id);
    expect(result).toEqual({ success: true, id });
    const invoice = await prisma.salesInvoice.findUniqueOrThrow({
      where: { id },
      select: { status: true, journalEntryId: true },
    });
    expect(invoice.status).toBe('CONFIRMED');
    const rows = await prisma.journalEntryLine.findMany({
      where: { entryId: invoice.journalEntryId! },
      select: { accountId: true, debit: true, credit: true },
    });
    return rows.map((r) => ({ accountId: r.accountId, debit: Number(r.debit), credit: Number(r.credit) }));
  }

  const sumOf = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `${PREFIX}Empresa`, isActive: true } });
    companyId = company.id;

    const mk = (code: string, name: string, type: 'ASSET' | 'LIABILITY' | 'REVENUE', nature: 'DEBIT' | 'CREDIT') =>
      prisma.account.create({ data: { companyId, code, name: `${PREFIX}${name}`, type, nature } });

    const [ventas, cobrar, ivaDf21, ivaDf105] = await Promise.all([
      mk('R1S-VENTAS', 'Ventas', 'REVENUE', 'CREDIT'),
      mk('R1S-COBRAR', 'Cuentas por Cobrar', 'ASSET', 'DEBIT'),
      mk('R1S-IVADF21', 'IVA DF 21', 'LIABILITY', 'CREDIT'),
      mk('R1S-IVADF105', 'IVA DF 10.5', 'LIABILITY', 'CREDIT'),
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

    const [customer, customerNc] = await Promise.all([
      prisma.contractor.create({ data: { companyId, name: `${PREFIX}Cliente` } }),
      prisma.contractor.create({ data: { companyId, name: `${PREFIX}Cliente NC` } }),
    ]);
    customerId = customer.id;
    customerNcId = customerNc.id;

    const pos = await prisma.salesPointOfSale.create({
      data: { companyId, number: 9760, name: `${PREFIX}PDV`, createdBy: 'test' },
    });
    pointOfSaleId = pos.id;

    const product = await prisma.product.create({
      data: {
        companyId,
        code: `${PREFIX}P`,
        name: `${PREFIX}Producto`,
        usage: 'SALE',
        trackStock: false,
        createdBy: 'test',
      },
      select: { id: true },
    });
    productId = product.id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    await prisma.salesInvoice.deleteMany({ where: { companyId } });
    await prisma.journalEntry.deleteMany({ where: { companyId } });
    await prisma.product.deleteMany({ where: { companyId } });
    await prisma.contractor.deleteMany({ where: { companyId } });
    await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
    await prisma.accountingSettings.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });

    const remaining = await prisma.company.count({ where: { name: { startsWith: PREFIX } } });
    expect(remaining).toBe(0);

    await prisma.$disconnect();
  });

  it('dos líneas de $1,07 al 21%: confirma, IVA 0,45 y el asiento suma el total 2,59', async () => {
    // createInvoice: líneas 0,2247 → 0,22 c/u; comprobante 0,4494 → 0,45; total 2,59.
    const id = await createDraftSale(
      [
        { unitPrice: 1.07, vatRate: 21, vatAmount: 0.22 },
        { unitPrice: 1.07, vatRate: 21, vatAmount: 0.22 },
      ],
      { subtotal: 2.14, vatAmount: 0.45, total: 2.59 }
    );

    const lines = await confirmedEntryLines(id);
    expect(lines.find((l) => l.accountId === cobrarId)?.debit).toBe(2.59);
    expect(lines.find((l) => l.accountId === ventasId)?.credit).toBe(2.14);
    expect(lines.find((l) => l.accountId === ivaDf21Id)?.credit).toBe(0.45);
    expect(sumOf(lines.map((l) => l.debit))).toBe(2.59);
    expect(sumOf(lines.map((l) => l.credit))).toBe(2.59);
  });

  it('dos alícuotas (21% y 10,5%): el centavo va a la línea de IVA de mayor importe', async () => {
    // Líneas: 0,2247 → 0,22 y 0,11235 → 0,11; comprobante 0,33705 → 0,34; total 2,48.
    const id = await createDraftSale(
      [
        { unitPrice: 1.07, vatRate: 21, vatAmount: 0.22 },
        { unitPrice: 1.07, vatRate: 10.5, vatAmount: 0.11 },
      ],
      { subtotal: 2.14, vatAmount: 0.34, total: 2.48 }
    );

    const lines = await confirmedEntryLines(id);
    expect(lines.find((l) => l.accountId === ivaDf21Id)?.credit).toBe(0.23);
    expect(lines.find((l) => l.accountId === ivaDf105Id)?.credit).toBe(0.11);
    expect(lines.find((l) => l.accountId === cobrarId)?.debit).toBe(2.48);
    expect(sumOf(lines.map((l) => l.credit))).toBe(2.48);
  });

  it('nota de crédito con dos líneas de $1,07 al 21%: confirma con el IVA del comprobante en el Debe', async () => {
    const id = await createDraftSale(
      [
        { unitPrice: 1.07, vatRate: 21, vatAmount: 0.22 },
        { unitPrice: 1.07, vatRate: 21, vatAmount: 0.22 },
      ],
      { subtotal: 2.14, vatAmount: 0.45, total: 2.59 },
      { voucherType: 'NOTA_CREDITO_A', customerId: customerNcId }
    );

    const lines = await confirmedEntryLines(id);
    expect(lines.find((l) => l.accountId === cobrarId)?.credit).toBe(2.59);
    expect(lines.find((l) => l.accountId === ivaDf21Id)?.debit).toBe(0.45);
    expect(sumOf(lines.map((l) => l.debit))).toBe(2.59);
  });
});
