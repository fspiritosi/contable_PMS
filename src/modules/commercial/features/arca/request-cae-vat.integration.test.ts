/**
 * Emisión a ARCA de una factura con descuento global (TSK-762), contra la base real y con WSAA/WSFE
 * reemplazados por mocks: se verifica el pedido FECAESolicitar que se arma, no la respuesta de ARCA.
 *
 * ARCA exige que las `AlicIva` sumen `ImpNeto` e `ImpIVA`. Esos dos salen de la cabecera (con el
 * descuento global); las alícuotas se armaban sumando las líneas, que guardan neto e IVA antes del
 * descuento, así que no coincidían y la factura no obtenía CAE.
 */
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { prisma } from '@/shared/lib/prisma';

vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./services/wsaa.server', () => ({
  getTokenSign: vi.fn().mockResolvedValue({ token: 'token', sign: 'sign' }),
}));
vi.mock('./services/wsfe.server', () => ({
  feCompUltimoAutorizado: vi.fn(),
  feCAESolicitar: vi.fn().mockResolvedValue({
    resultado: 'A',
    cae: '76123456789012',
    caeFchVto: '20261231',
    observations: [],
    errors: [],
  }),
}));

import { getActiveCompanyId } from '@/shared/lib/company';

import { buildSalesInvoiceAmounts } from '../sales/features/invoices/shared/totals';
import { createInvoiceSchema } from '../sales/features/invoices/shared/validators';
import { requestCAE } from './actions.server';
import { feCAESolicitar, feCompUltimoAutorizado } from './services/wsfe.server';

const PREFIX = 'TSK762-CAE-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const cents = (values: number[]) => values.reduce((acc, v) => acc + Math.round(v * 100), 0);

describe.skipIf(!dbAvailable)('requestCAE: AlicIva con descuento global (TSK-762)', () => {
  let companyId: string;
  let customerId: string;
  let pointOfSaleId: string;
  let productId: string;
  let nextNumber = 1;

  /** Factura A confirmada con los importes que guarda `createInvoice`. */
  async function confirmedSale(lines: { unitPrice: string; vatRate: string }[], discount: { percent?: string; amount?: string }) {
    const input = createInvoiceSchema.parse({
      customerId,
      pointOfSaleId,
      voucherType: 'FACTURA_A',
      issueDate: '2026-03-10',
      lines: lines.map((line, i) => ({ productId, description: `Línea ${i + 1}`, quantity: '1', ...line })),
      globalDiscountPercent: discount.percent,
      globalDiscountAmount: discount.amount,
    });
    const { linesData, amounts } = buildSalesInvoiceAmounts(input);
    const number = nextNumber++;
    vi.mocked(feCompUltimoAutorizado).mockResolvedValue(number - 1);
    return prisma.salesInvoice.create({
      data: {
        companyId,
        customerId,
        pointOfSaleId,
        voucherType: 'FACTURA_A',
        number,
        fullNumber: `9762-${String(number).padStart(8, '0')}`,
        issueDate: new Date('2026-03-10'),
        status: 'CONFIRMED',
        createdBy: 'test',
        ...amounts,
        lines: { create: linesData },
      },
      select: { id: true },
    });
  }

  beforeAll(async () => {
    ({ id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true, taxId: '30712345671' },
      select: { id: true },
    }));
    await prisma.arcaCredential.create({
      data: {
        companyId,
        cuit: '30712345671',
        certificate: Buffer.from('cert'),
        privateKey: Buffer.from('key'),
        environment: 'HOMOLOGACION',
      },
    });
    customerId = (
      await prisma.contractor.create({ data: { companyId, name: `${PREFIX}Cliente`, taxId: '20111111112' } })
    ).id;
    pointOfSaleId = (
      await prisma.salesPointOfSale.create({
        data: { companyId, number: 9762, name: `${PREFIX}PV`, afipEnabled: true, createdBy: 'test' },
      })
    ).id;
    productId = (
      await prisma.product.create({
        data: { companyId, code: `${PREFIX}P`, name: `${PREFIX}Producto`, usage: 'SALE', trackStock: false, createdBy: 'test' },
      })
    ).id;
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
  });

  beforeEach(() => vi.mocked(feCAESolicitar).mockClear());

  afterAll(async () => {
    if (!companyId) return;
    await prisma.arcaRequest.deleteMany({ where: { companyId } });
    await prisma.salesInvoice.deleteMany({ where: { companyId } });
    await prisma.product.deleteMany({ where: { companyId } });
    await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
    await prisma.contractor.deleteMany({ where: { companyId } });
    await prisma.arcaCredential.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
  });

  it('10% sobre dos alícuotas: las AlicIva van con descuento y suman ImpNeto e ImpIVA', async () => {
    const invoice = await confirmedSale(
      [
        { unitPrice: '1000', vatRate: '21' },
        { unitPrice: '500', vatRate: '10.5' },
      ],
      { percent: '10' }
    );

    expect((await requestCAE(invoice.id)).success).toBe(true);

    const request = vi.mocked(feCAESolicitar).mock.calls[0][2];
    expect(request.impNeto).toBe(1350);
    expect(request.impIVA).toBe(236.25);
    expect(request.ivaLines).toEqual([
      { id: 5, baseImp: 900, importe: 189 },
      { id: 4, baseImp: 450, importe: 47.25 },
    ]);
  });

  it('descuento en monto que no divide exacto: la suma de las AlicIva es exacta al centavo', async () => {
    const invoice = await confirmedSale(
      [
        { unitPrice: '1000', vatRate: '21' },
        { unitPrice: '500', vatRate: '10.5' },
        { unitPrice: '333.33', vatRate: '21' },
      ],
      { amount: '100' }
    );

    expect((await requestCAE(invoice.id)).success).toBe(true);

    const request = vi.mocked(feCAESolicitar).mock.calls[0][2];
    expect(cents(request.ivaLines.map((l) => l.baseImp))).toBe(Math.round(request.impNeto * 100));
    expect(cents(request.ivaLines.map((l) => l.importe))).toBe(Math.round(request.impIVA * 100));
  });
});
