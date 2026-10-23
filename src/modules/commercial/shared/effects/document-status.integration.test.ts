/**
 * Tests de integración del recalculo de estado de facturas y gastos (TSK-792,
 * Tarea 5), contra la base real. Cubre el ruling del plan: solo cuentan las
 * OP/RC CONFIRMED y las NC aplicadas que no están anuladas.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));

import {
  recomputeExpenseStatusTx,
  recomputePurchaseInvoiceStatusTx,
  recomputeSalesInvoiceStatusTx,
} from './document-status.server';

const PREFIX = 'TSK792-STATUS-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type PurchaseStatus = 'DRAFT' | 'CONFIRMED' | 'PAID' | 'PARTIAL_PAID' | 'CANCELLED';
type DocStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

describe.skipIf(!dbAvailable)('integración: recalculo de estado de facturas y gastos (TSK-792)', () => {
  let companyId: string;
  let supplierId: string;
  let customerId: string;
  let pointOfSaleId: string;
  let categoryId: string;
  let seq = 1;

  const run = <T>(fn: Parameters<typeof prisma.$transaction>[0]) =>
    prisma.$transaction(fn as never) as Promise<T>;

  async function purchaseInvoice(
    status: PurchaseStatus = 'CONFIRMED',
    voucherType: 'FACTURA_A' | 'NOTA_CREDITO_A' = 'FACTURA_A',
    total = 1000
  ) {
    const n = seq++;
    const number = String(n).padStart(8, '0');
    return prisma.purchaseInvoice.create({
      data: {
        companyId,
        supplierId,
        voucherType,
        pointOfSale: '9792',
        number,
        fullNumber: `9792-${number}`,
        issueDate: new Date('2026-03-01'),
        subtotal: total,
        netTaxed: total,
        vatAmount: 0,
        total,
        status,
        createdBy: 'test',
      },
      select: { id: true },
    });
  }

  async function paymentOrder(invoiceId: string | null, expenseId: string | null, amount: number, status: DocStatus) {
    const n = seq++;
    return prisma.paymentOrder.create({
      data: {
        companyId,
        supplierId,
        number: n,
        fullNumber: `${PREFIX}OP-${n}`,
        date: new Date('2026-03-10'),
        totalAmount: amount,
        status,
        createdBy: 'test',
        items: { create: [{ invoiceId, expenseId, amount }] },
      },
      select: { id: true },
    });
  }

  async function salesInvoice(status: PurchaseStatus = 'CONFIRMED', total = 1000) {
    const n = seq++;
    return prisma.salesInvoice.create({
      data: {
        companyId,
        customerId,
        pointOfSaleId,
        voucherType: 'FACTURA_A',
        number: n,
        fullNumber: `9792-${String(n).padStart(8, '0')}`,
        issueDate: new Date('2026-03-01'),
        subtotal: total,
        netTaxed: total,
        vatAmount: 0,
        total,
        totalBeforeDiscount: total,
        discountTotal: 0,
        status,
        createdBy: 'test',
      },
      select: { id: true },
    });
  }

  async function receipt(invoiceId: string, amount: number, status: DocStatus) {
    const n = seq++;
    return prisma.receipt.create({
      data: {
        companyId,
        customerId,
        number: n,
        fullNumber: `${PREFIX}R-${n}`,
        date: new Date('2026-03-10'),
        totalAmount: amount,
        status,
        createdBy: 'test',
        items: { create: [{ invoiceId, amount }] },
      },
      select: { id: true },
    });
  }

  async function expense(status: 'DRAFT' | 'CONFIRMED' | 'PAID' | 'CANCELLED' = 'CONFIRMED', amount = 500) {
    const n = seq++;
    return prisma.expense.create({
      data: {
        number: n,
        fullNumber: `${PREFIX}G-${n}`,
        description: `${PREFIX}gasto`,
        amount,
        date: new Date('2026-03-01'),
        status,
        categoryId,
        supplierId,
        companyId,
        createdBy: 'test',
      },
      select: { id: true },
    });
  }

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `${PREFIX}Empresa`, isActive: true } });
    companyId = company.id;
    supplierId = (
      await prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}PROV`,
          businessName: `${PREFIX}Proveedor`,
          taxId: '30500000002',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
      })
    ).id;
    customerId = (await prisma.contractor.create({ data: { companyId, name: `${PREFIX}Cliente` } })).id;
    pointOfSaleId = (
      await prisma.salesPointOfSale.create({ data: { companyId, number: 9792, name: `${PREFIX}PDV`, createdBy: 'test' } })
    ).id;
    categoryId = (await prisma.expenseCategory.create({ data: { companyId, name: `${PREFIX}Cat` } })).id;
  });

  afterAll(async () => {
    if (companyId) {
      await prisma.paymentOrder.deleteMany({ where: { companyId } });
      await prisma.receipt.deleteMany({ where: { companyId } });
      await prisma.purchaseCreditNoteApplication.deleteMany({ where: { companyId } });
      await prisma.salesCreditNoteApplication.deleteMany({ where: { companyId } });
      await prisma.expense.deleteMany({ where: { companyId } });
      await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
      await prisma.salesInvoice.deleteMany({ where: { companyId } });
      await prisma.expenseCategory.deleteMany({ where: { companyId } });
      await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
      await prisma.contractor.deleteMany({ where: { companyId } });
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
  });

  const statusOf = {
    purchase: async (id: string) =>
      (await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id }, select: { status: true } })).status,
    sales: async (id: string) =>
      (await prisma.salesInvoice.findUniqueOrThrow({ where: { id }, select: { status: true } })).status,
    expense: async (id: string) =>
      (await prisma.expense.findUniqueOrThrow({ where: { id }, select: { status: true } })).status,
  };

  it('vuelve a CONFIRMED cuando ya no hay pagos', async () => {
    const inv = await purchaseInvoice('PAID');
    const result = await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, inv.id));
    expect(result).toBe('CONFIRMED');
    expect(await statusOf.purchase(inv.id)).toBe('CONFIRMED');

    const sinv = await salesInvoice('PARTIAL_PAID');
    expect(await run<string>((tx) => recomputeSalesInvoiceStatusTx(tx, sinv.id))).toBe('CONFIRMED');
    expect(await statusOf.sales(sinv.id)).toBe('CONFIRMED');
  });

  it('PARTIAL_PAID con pago parcial confirmado y PAID con el total', async () => {
    const inv = await purchaseInvoice('CONFIRMED');
    await paymentOrder(inv.id, null, 400, 'CONFIRMED');
    expect(await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, inv.id))).toBe('PARTIAL_PAID');
    await paymentOrder(inv.id, null, 600, 'CONFIRMED');
    expect(await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, inv.id))).toBe('PAID');

    const sinv = await salesInvoice('CONFIRMED');
    await receipt(sinv.id, 300, 'CONFIRMED');
    expect(await run<string>((tx) => recomputeSalesInvoiceStatusTx(tx, sinv.id))).toBe('PARTIAL_PAID');
    await receipt(sinv.id, 700, 'CONFIRMED');
    expect(await run<string>((tx) => recomputeSalesInvoiceStatusTx(tx, sinv.id))).toBe('PAID');
  });

  it('ignora OP y recibos en borrador y anulados', async () => {
    const inv = await purchaseInvoice('PARTIAL_PAID');
    await paymentOrder(inv.id, null, 1000, 'DRAFT');
    await paymentOrder(inv.id, null, 1000, 'CANCELLED');
    expect(await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, inv.id))).toBe('CONFIRMED');

    const sinv = await salesInvoice('PARTIAL_PAID');
    await receipt(sinv.id, 1000, 'DRAFT');
    await receipt(sinv.id, 1000, 'CANCELLED');
    expect(await run<string>((tx) => recomputeSalesInvoiceStatusTx(tx, sinv.id))).toBe('CONFIRMED');
  });

  it('la NC aplicada cuenta, salvo que esté anulada', async () => {
    const inv = await purchaseInvoice('CONFIRMED');
    const nc = await purchaseInvoice('PARTIAL_PAID', 'NOTA_CREDITO_A', 300);
    await prisma.purchaseCreditNoteApplication.create({
      data: { creditNoteId: nc.id, invoiceId: inv.id, amount: 300, companyId },
    });
    expect(await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, inv.id))).toBe('PARTIAL_PAID');
    await paymentOrder(inv.id, null, 700, 'CONFIRMED');
    expect(await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, inv.id))).toBe('PAID');

    await prisma.purchaseInvoice.update({ where: { id: nc.id }, data: { status: 'CANCELLED' } });
    expect(await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, inv.id))).toBe('PARTIAL_PAID');

    const sinv = await salesInvoice('CONFIRMED');
    const snc = await salesInvoice('PARTIAL_PAID', 1000);
    await prisma.salesCreditNoteApplication.create({
      data: { creditNoteId: snc.id, invoiceId: sinv.id, amount: 1000, companyId },
    });
    expect(await run<string>((tx) => recomputeSalesInvoiceStatusTx(tx, sinv.id))).toBe('PAID');
  });

  it('una NC se evalúa por las aplicaciones que dio', async () => {
    const inv = await purchaseInvoice('CONFIRMED');
    const nc = await purchaseInvoice('CONFIRMED', 'NOTA_CREDITO_A', 300);
    expect(await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, nc.id))).toBe('CONFIRMED');
    await prisma.purchaseCreditNoteApplication.create({
      data: { creditNoteId: nc.id, invoiceId: inv.id, amount: 100, companyId },
    });
    expect(await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, nc.id))).toBe('PARTIAL_PAID');
    await prisma.purchaseCreditNoteApplication.updateMany({ where: { creditNoteId: nc.id }, data: { amount: 300 } });
    expect(await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, nc.id))).toBe('PAID');
  });

  it('no toca comprobantes DRAFT ni CANCELLED', async () => {
    const draft = await purchaseInvoice('DRAFT');
    const cancelled = await purchaseInvoice('CANCELLED');
    await paymentOrder(draft.id, null, 1000, 'CONFIRMED');
    await paymentOrder(cancelled.id, null, 1000, 'CONFIRMED');
    expect(await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, draft.id))).toBe('DRAFT');
    expect(await run<string>((tx) => recomputePurchaseInvoiceStatusTx(tx, cancelled.id))).toBe('CANCELLED');
    expect(await statusOf.purchase(draft.id)).toBe('DRAFT');
    expect(await statusOf.purchase(cancelled.id)).toBe('CANCELLED');

    const sdraft = await salesInvoice('DRAFT');
    expect(await run<string>((tx) => recomputeSalesInvoiceStatusTx(tx, sdraft.id))).toBe('DRAFT');

    const gdraft = await expense('DRAFT');
    expect(await run<string>((tx) => recomputeExpenseStatusTx(tx, gdraft.id))).toBe('DRAFT');
    const gcancelled = await expense('CANCELLED');
    expect(await run<string>((tx) => recomputeExpenseStatusTx(tx, gcancelled.id))).toBe('CANCELLED');
  });

  it('gasto pagado por OP confirmada', async () => {
    const g = await expense('CONFIRMED', 500);
    await paymentOrder(null, g.id, 200, 'DRAFT');
    expect(await run<string>((tx) => recomputeExpenseStatusTx(tx, g.id))).toBe('CONFIRMED');
    await paymentOrder(null, g.id, 200, 'CONFIRMED');
    expect(await run<string>((tx) => recomputeExpenseStatusTx(tx, g.id))).toBe('PARTIAL_PAID');
    await paymentOrder(null, g.id, 300, 'CONFIRMED');
    expect(await run<string>((tx) => recomputeExpenseStatusTx(tx, g.id))).toBe('PAID');
    expect(await statusOf.expense(g.id)).toBe('PAID');
  });
});
