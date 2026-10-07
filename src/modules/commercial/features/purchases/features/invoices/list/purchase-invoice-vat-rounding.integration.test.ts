/**
 * El asiento de una factura de compra cuadra con el total guardado del
 * comprobante aunque los importes por línea redondeados no sumen los del
 * comprobante (TSK-760, R-1), contra la base real.
 *
 * `createPurchaseInvoice` suma subtotal e IVA de las líneas **sin redondear** y
 * la base redondea el comprobante una vez; cada línea se guarda redondeada por
 * separado. Dos líneas de $1,07 al 21% dan IVA 0,45 y total 2,59 en el
 * comprobante, pero 0,22 + 0,22 = 0,44 en las líneas: el asiento sumaba 2,58 y
 * el núcleo (`Decimal`, C5) lo rechazaba con "Diferencia: $0.01". Criterio:
 * el comprobante manda; la diferencia de IVA va a la línea de IVA de mayor
 * importe y, si el neto también difiere (cantidades fraccionarias), a la línea
 * de neto de mayor importe.
 *
 * Se entra por los server actions reales (`createPurchaseInvoice`,
 * `confirmPurchaseInvoice`), como en `purchase-invoice-tributes.integration.test.ts`.
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
import { confirmPurchaseInvoice, createPurchaseInvoice } from './actions.server';

const PREFIX = 'TSK760R1-PURC-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

interface FormLine {
  quantity: string;
  unitCost: string;
  vatRate: string;
}

describe.skipIf(!dbAvailable)('integración: IVA del asiento de compra = IVA del comprobante (TSK-760, R-1)', () => {
  let companyId: string;
  let supplierId: string;
  let supplierNcId: string;
  let comprasId: string;
  let pagarId: string;
  let ivaCf21Id: string;
  let ivaCf105Id: string;
  let percIibbId: string;
  let nextNumber = 1;

  async function createDraftPurchase(
    lines: FormLine[],
    options: {
      voucherType?: 'FACTURA_A' | 'NOTA_CREDITO_A';
      supplierId?: string;
      perceptionIibb?: string;
    } = {}
  ) {
    const number = String(nextNumber++).padStart(8, '0');
    const result = await createPurchaseInvoice({
      supplierId: options.supplierId ?? supplierId,
      voucherType: options.voucherType ?? 'FACTURA_A',
      pointOfSale: '0001',
      number,
      issueDate: new Date('2026-03-10'),
      lines: lines.map((line, i) => ({ description: `Línea ${i + 1}`, ...line })),
      perceptions: options.perceptionIibb
        ? [{ type: 'IIBB' as const, jurisdiction: 'NQN', baseAmount: '2.14', amount: options.perceptionIibb }]
        : [],
      internalTaxes: '',
    });
    return result.id;
  }

  async function confirmedEntry(id: string) {
    const result = await confirmPurchaseInvoice(id);
    expect(result.success ? null : result.error).toBeNull();
    const invoice = await prisma.purchaseInvoice.findUniqueOrThrow({
      where: { id },
      select: { status: true, journalEntryId: true, total: true, vatAmount: true },
    });
    expect(invoice.status).toBe('CONFIRMED');
    const rows = await prisma.journalEntryLine.findMany({
      where: { entryId: invoice.journalEntryId! },
      select: { accountId: true, debit: true, credit: true },
    });
    return {
      total: Number(invoice.total),
      vatAmount: Number(invoice.vatAmount),
      lines: rows.map((r) => ({ accountId: r.accountId, debit: Number(r.debit), credit: Number(r.credit) })),
    };
  }

  const sumOf = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `${PREFIX}Empresa`, isActive: true } });
    companyId = company.id;

    const mk = (code: string, name: string, type: 'ASSET' | 'LIABILITY' | 'EXPENSE', nature: 'DEBIT' | 'CREDIT') =>
      prisma.account.create({ data: { companyId, code, name: `${PREFIX}${name}`, type, nature } });

    const [compras, pagar, ivaCf21, ivaCf105, percIibb] = await Promise.all([
      mk('R1P-COMPRAS', 'Compras', 'EXPENSE', 'DEBIT'),
      mk('R1P-PAGAR', 'Cuentas por Pagar', 'LIABILITY', 'CREDIT'),
      mk('R1P-IVACF21', 'IVA CF 21', 'ASSET', 'DEBIT'),
      mk('R1P-IVACF105', 'IVA CF 10.5', 'ASSET', 'DEBIT'),
      mk('R1P-PERCIIBB', 'Perc IIBB Sufrida', 'ASSET', 'DEBIT'),
    ]);
    comprasId = compras.id;
    pagarId = pagar.id;
    ivaCf21Id = ivaCf21.id;
    ivaCf105Id = ivaCf105.id;
    percIibbId = percIibb.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        purchasesAccountId: comprasId,
        payablesAccountId: pagarId,
        vatCreditAccountId: ivaCf21Id,
        perceptionIibbSufferedAccountId: percIibbId,
        requireCostCenter: false,
        vatAccounts: { create: [{ vatRate: 10.5, side: 'CREDIT', accountId: ivaCf105Id }] },
      },
    });

    const mkSupplier = (code: string, taxId: string) =>
      prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}${code}`,
          businessName: `${PREFIX}Proveedor ${code}`,
          taxId,
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
      });
    const [supplier, supplierNc] = await Promise.all([
      mkSupplier('A', '30760000001'),
      mkSupplier('NC', '30760000002'),
    ]);
    supplierId = supplier.id;
    supplierNcId = supplierNc.id;

    // La NC de compra exige un almacén principal activo (devolución de stock).
    await prisma.warehouse.create({
      data: { companyId, code: `${PREFIX}ALM`, name: `${PREFIX}Almacén`, type: 'MAIN' },
    });

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
    await prisma.journalEntry.deleteMany({ where: { companyId } });
    await prisma.supplier.deleteMany({ where: { companyId } });
    await prisma.warehouse.deleteMany({ where: { companyId } });
    await prisma.accountingSettings.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });

    const remaining = await prisma.company.count({ where: { name: { startsWith: PREFIX } } });
    expect(remaining).toBe(0);

    await prisma.$disconnect();
  });

  const twoLinesAt21: FormLine[] = [
    { quantity: '1', unitCost: '1.07', vatRate: '21' },
    { quantity: '1', unitCost: '1.07', vatRate: '21' },
  ];

  it('dos líneas de $1,07 al 21%: confirma, IVA 0,45 y el asiento suma el total 2,59', async () => {
    const id = await createDraftPurchase(twoLinesAt21);

    const { total, vatAmount, lines } = await confirmedEntry(id);
    expect(total).toBe(2.59);
    expect(vatAmount).toBe(0.45);
    expect(lines.find((l) => l.accountId === pagarId)?.credit).toBe(2.59);
    expect(lines.find((l) => l.accountId === comprasId)?.debit).toBe(2.14);
    expect(lines.find((l) => l.accountId === ivaCf21Id)?.debit).toBe(0.45);
    expect(sumOf(lines.map((l) => l.debit))).toBe(2.59);
  });

  it('dos alícuotas (21% y 10,5%): el centavo va a la línea de IVA de mayor importe', async () => {
    const id = await createDraftPurchase([
      { quantity: '1', unitCost: '1.07', vatRate: '21' },
      { quantity: '1', unitCost: '1.07', vatRate: '10.5' },
    ]);

    const { total, vatAmount, lines } = await confirmedEntry(id);
    expect(vatAmount).toBe(0.34);
    expect(total).toBe(2.48);
    expect(lines.find((l) => l.accountId === ivaCf21Id)?.debit).toBe(0.23);
    expect(lines.find((l) => l.accountId === ivaCf105Id)?.debit).toBe(0.11);
    expect(sumOf(lines.map((l) => l.debit))).toBe(2.48);
  });

  it('con percepción: la percepción va tal cual y el asiento suma el total', async () => {
    const id = await createDraftPurchase(twoLinesAt21, { perceptionIibb: '0.05' });

    const { total, lines } = await confirmedEntry(id);
    expect(total).toBe(2.64);
    expect(lines.find((l) => l.accountId === percIibbId)?.debit).toBe(0.05);
    expect(lines.find((l) => l.accountId === ivaCf21Id)?.debit).toBe(0.45);
    expect(sumOf(lines.map((l) => l.debit))).toBe(2.64);
  });

  it('cantidades fraccionarias: el neto también se ajusta al comprobante', async () => {
    // Líneas 0,5 × 1,01 = 0,505 → 0,51 c/u (IVA 0,10605 → 0,11 c/u); comprobante:
    // subtotal 1,01, IVA 0,2121 → 0,21, total 1,2221 → 1,22. El asiento sumaba 1,24.
    const id = await createDraftPurchase([
      { quantity: '0.5', unitCost: '1.01', vatRate: '21' },
      { quantity: '0.5', unitCost: '1.01', vatRate: '21' },
    ]);

    const { total, lines } = await confirmedEntry(id);
    expect(total).toBe(1.22);
    expect(lines.find((l) => l.accountId === ivaCf21Id)?.debit).toBe(0.21);
    expect(lines.find((l) => l.accountId === comprasId)?.debit).toBe(1.01);
    expect(lines.find((l) => l.accountId === pagarId)?.credit).toBe(1.22);
  });

  it('nota de crédito con dos líneas de $1,07 al 21%: confirma con el IVA del comprobante en el Haber', async () => {
    const id = await createDraftPurchase(twoLinesAt21, {
      voucherType: 'NOTA_CREDITO_A',
      supplierId: supplierNcId,
    });

    const { lines } = await confirmedEntry(id);
    expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(2.59);
    expect(lines.find((l) => l.accountId === ivaCf21Id)?.credit).toBe(0.45);
    expect(sumOf(lines.map((l) => l.credit))).toBe(2.59);
  });
});
