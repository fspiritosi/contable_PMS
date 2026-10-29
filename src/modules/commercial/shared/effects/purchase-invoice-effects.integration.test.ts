/**
 * Tests de integración de los efectos de la factura de compra (TSK-792, Tarea 9),
 * contra la base real: `applyPurchaseInvoiceEffectsTx` (vía `confirmPurchaseInvoice`
 * y directo, con `rewriteEntryId`), su inversa `revertPurchaseInvoiceEffectsTx`, los
 * impedimentos propios (`purchaseInvoiceEffectImpedimentsTx`), la escritura de datos
 * (`writePurchaseInvoiceDataTx`), la validación previa a confirmar y las inversas de
 * la compensación de NC (`unapplyPurchaseCreditNoteTx` / `unapplySalesCreditNoteTx`).
 *
 * Los borradores se crean con el server action real (`createPurchaseInvoice`) y se
 * confirman con `confirmPurchaseInvoice`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/modules/accounting/features/integrations/core';
import { prisma } from '@/shared/lib/prisma';

import type { PurchaseInvoiceFormInput } from '@/modules/commercial/features/purchases/features/invoices/shared/validators';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { cleanupAccountingCompany } from '@/modules/accounting/shared/test-utils/cleanup-accounting-company';
import { readLastEntryNumber } from '@/modules/accounting/shared/test-utils/period-test-helpers';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { BusinessError } from '@/shared/lib/action-result';

import {
  confirmPurchaseInvoice,
  createPurchaseInvoice,
  updatePurchaseInvoice,
} from '@/modules/commercial/features/purchases/features/invoices/list/actions.server';
import {
  unapplyPurchaseCreditNoteTx,
  unapplySalesCreditNoteTx,
} from '../credit-note-compensation';
import {
  applyPurchaseInvoiceEffectsTx,
  purchaseInvoiceEffectImpedimentsTx,
  revertPurchaseInvoiceEffectsTx,
  validatePurchaseInvoiceForConfirmation,
} from './purchase-invoice.server';
import { writePurchaseInvoiceDataTx } from './purchase-invoice-data.server';
import type { EffectsCtx } from './types';

const PREFIX = 'TSK792-FCFX-';
const ISSUE_DATE = new Date('2026-03-10');
const DOC_LABEL = 'la FC de prueba';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type LineInput = PurchaseInvoiceFormInput['lines'][number];

const inTx = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction((tx) => fn(tx));

describe.skipIf(!dbAvailable)('integración: efectos de la factura de compra (TSK-792)', () => {
  let companyId: string;
  let ctx: EffectsCtx;
  let supplierId: string;
  let warehouseId: string;
  let stockProductId: string;
  let serviceProductId: string;
  let badAccountProductId: string;
  let costCenterId: string;
  let customerId: string;
  let pointOfSaleId: string;
  let otherCompanyId: string | undefined;
  let seq = 1;
  let poSeq = 1;

  const line = (overrides: Partial<LineInput> = {}): LineInput => ({
    description: `${PREFIX}línea`,
    quantity: '1',
    unitCost: '1000',
    vatRate: '21',
    ...overrides,
  });

  const formInput = (
    overrides: Partial<PurchaseInvoiceFormInput> = {}
  ): PurchaseInvoiceFormInput => ({
    supplierId,
    voucherType: 'FACTURA_A',
    pointOfSale: '0001',
    number: String(seq++).padStart(8, '0'),
    issueDate: ISSUE_DATE,
    lines: [line()],
    internalTaxes: '',
    ...overrides,
  });

  async function draftInvoice(overrides: Partial<PurchaseInvoiceFormInput> = {}) {
    const input = formInput(overrides);
    const created = await createPurchaseInvoice(input);
    return { id: created.id, input };
  }

  async function confirmedInvoice(overrides: Partial<PurchaseInvoiceFormInput> = {}) {
    const draft = await draftInvoice(overrides);
    const result = await confirmPurchaseInvoice(draft.id);
    if (!result.success) throw new Error(`No se pudo confirmar la FC: ${result.error}`);
    return draft;
  }

  /** Proveedor propio por test de NC: la NC compensa FIFO contra todo lo pendiente del proveedor. */
  async function newSupplier(code: string): Promise<string> {
    return (
      await prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}${code}`,
          businessName: `${PREFIX}Proveedor ${code}`,
          taxId: `30${String(9_000_000 + seq++).padStart(9, '0')}`,
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;
  }

  async function purchaseOrder(forCompanyId: string, forSupplierId: string, quantities: number[]) {
    const number = 9790 + poSeq++;
    return prisma.purchaseOrder.create({
      data: {
        companyId: forCompanyId,
        supplierId: forSupplierId,
        number,
        fullNumber: `OC-${number}`,
        issueDate: ISSUE_DATE,
        status: 'APPROVED',
        createdBy: 'test',
        lines: {
          create: quantities.map((quantity, i) => ({
            description: `${PREFIX}línea OC ${i + 1}`,
            quantity,
            unitCost: 1000,
            vatRate: 21,
            vatAmount: 210 * quantity,
            subtotal: 1000 * quantity,
            total: 1210 * quantity,
          })),
        },
      },
      select: { id: true, lines: { select: { id: true }, orderBy: { description: 'asc' } } },
    });
  }

  const orderState = async (orderId: string) => {
    const order = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        invoicingStatus: true,
        lines: { select: { invoicedQty: true }, orderBy: { description: 'asc' } },
      },
    });
    return {
      invoicingStatus: order.invoicingStatus,
      invoiced: order.lines.map((l) => Number(l.invoicedQty)),
    };
  };
  const stockQty = async () => {
    const stock = await prisma.warehouseStock.findUnique({
      where: { warehouseId_productId: { warehouseId, productId: stockProductId } },
      select: { quantity: true, availableQty: true },
    });
    return { quantity: Number(stock?.quantity ?? 0), available: Number(stock?.availableQty ?? 0) };
  };
  const invoiceRow = (id: string) =>
    prisma.purchaseInvoice.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        journalEntryId: true,
        fullNumber: true,
        supplierId: true,
        purchaseOrderId: true,
        total: true,
        updatedAt: true,
      },
    });
  const movementsOf = (invoiceId: string) =>
    prisma.stockMovement.count({
      where: { referenceType: 'purchase_invoice', referenceId: invoiceId },
    });
  const impedimentCodes = (id: string) =>
    inTx((tx) => purchaseInvoiceEffectImpedimentsTx(tx, id, DOC_LABEL)).then((list) =>
      list.map((i) => i.code)
    );

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;
    ctx = { companyId, userId: 'test-user' };

    const mk = (
      code: string,
      name: string,
      type: 'ASSET' | 'LIABILITY' | 'EXPENSE',
      nature: 'DEBIT' | 'CREDIT',
      extra: { isLeaf?: boolean } = {}
    ) =>
      prisma.account.create({
        data: { companyId, code, name: `${PREFIX}${name}`, type, nature, ...extra },
      });
    const [compras, pagar, ivaCf, rubro] = await Promise.all([
      mk('T792F-COMPRAS', 'Compras', 'EXPENSE', 'DEBIT'),
      mk('T792F-PAGAR', 'Cuentas por Pagar', 'LIABILITY', 'CREDIT'),
      mk('T792F-IVACF', 'IVA Credito Fiscal', 'ASSET', 'DEBIT'),
      // Cuenta con hijas: no es imputable.
      mk('T792F-RUBRO', 'Compras (rubro)', 'EXPENSE', 'DEBIT', { isLeaf: false }),
    ]);

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        purchasesAccountId: compras.id,
        payablesAccountId: pagar.id,
        vatCreditAccountId: ivaCf.id,
        requireCostCenter: false,
      },
    });

    supplierId = await newSupplier('PROV');

    const mkProduct = (
      code: string,
      trackStock: boolean,
      defaultExpenseAccountId: string | null = null
    ) =>
      prisma.product
        .create({
          data: {
            companyId,
            code: `${PREFIX}${code}`,
            name: `${PREFIX}${code}`,
            usage: 'PURCHASE',
            trackStock,
            defaultExpenseAccountId,
            createdBy: 'test',
          },
          select: { id: true },
        })
        .then((p) => p.id);
    [stockProductId, serviceProductId, badAccountProductId] = await Promise.all([
      mkProduct('STOCK', true),
      mkProduct('SERV', false),
      mkProduct('RUBRO', false, rubro.id),
    ]);

    warehouseId = (
      await prisma.warehouse.create({
        data: { companyId, code: 'T792F-MAIN', name: `${PREFIX}Depósito`, type: 'MAIN' },
        select: { id: true },
      })
    ).id;
    await prisma.warehouseStock.create({
      data: { warehouseId, productId: stockProductId, quantity: 50, reservedQty: 0, availableQty: 50 },
    });

    costCenterId = (
      await prisma.costCenter.create({
        data: { companyId, name: `${PREFIX}Centro` },
        select: { id: true },
      })
    ).id;

    customerId = (
      await prisma.contractor.create({
        data: { companyId, name: `${PREFIX}Cliente` },
        select: { id: true },
      })
    ).id;
    pointOfSaleId = (
      await prisma.salesPointOfSale.create({
        data: { companyId, number: 9793, name: `${PREFIX}PDV`, createdBy: 'test' },
        select: { id: true },
      })
    ).id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
    if (companyId) {
      await prisma.stockMovement.deleteMany({ where: { companyId } });
      await prisma.warehouseStock.deleteMany({ where: { warehouse: { companyId } } });
      await prisma.warehouse.deleteMany({ where: { companyId } });
      await prisma.purchaseCreditNoteApplication.deleteMany({ where: { companyId } });
      await prisma.salesCreditNoteApplication.deleteMany({ where: { companyId } });
      // Las líneas y repartos caen en cascada con la factura y la OC.
      await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
      await prisma.purchaseOrder.deleteMany({ where: { companyId } });
      await cleanupAccountingCompany(companyId);
      await prisma.salesInvoice.deleteMany({ where: { companyId } });
      await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
      await prisma.contractor.deleteMany({ where: { companyId } });
      await prisma.product.deleteMany({ where: { companyId } });
      await prisma.costCenter.deleteMany({ where: { companyId } });
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    if (otherCompanyId) {
      await prisma.purchaseOrder.deleteMany({ where: { companyId: otherCompanyId } });
      await prisma.product.deleteMany({ where: { companyId: otherCompanyId } });
      await prisma.costCenter.deleteMany({ where: { companyId: otherCompanyId } });
      await prisma.supplier.deleteMany({ where: { companyId: otherCompanyId } });
      await prisma.company.deleteMany({ where: { id: otherCompanyId } });
    }
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    await prisma.$disconnect();
  });

  it('dos confirmaciones simultáneas aplican los efectos una sola vez (TSK-812)', async () => {
    const { id } = await draftInvoice();
    const lastNumberBefore = await readLastEntryNumber(companyId);

    const results = await Promise.all([confirmPurchaseInvoice(id), confirmPurchaseInvoice(id)]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => !r.success)).toEqual([
      { success: false, error: 'Solo se pueden confirmar facturas en estado borrador' },
    ]);
    expect((await invoiceRow(id)).status).toBe('CONFIRMED');
    expect((await invoiceRow(id)).journalEntryId).not.toBeNull();
    expect(await readLastEntryNumber(companyId)).toBe(lastNumberBefore + 1);
  });

  describe('orden de compra', () => {
    it('revert(apply) de FC con OC deja invoicedQty y estado de la OC como antes', async () => {
      const order = await purchaseOrder(companyId, supplierId, [10, 5]);
      // La OC ya tenía una facturación previa en la segunda línea.
      await prisma.purchaseOrderLine.update({
        where: { id: order.lines[1].id },
        data: { invoicedQty: 2 },
      });
      await prisma.purchaseOrder.update({
        where: { id: order.id },
        data: { invoicingStatus: 'PARTIALLY_INVOICED' },
      });
      const before = await orderState(order.id);

      const { id } = await confirmedInvoice({
        purchaseOrderId: order.id,
        lines: [
          line({ quantity: '10', purchaseOrderLineId: order.lines[0].id }),
          line({ quantity: '3', purchaseOrderLineId: order.lines[1].id }),
        ],
      });
      // apply facturó toda la OC
      expect(await orderState(order.id)).toEqual({
        invoicingStatus: 'FULLY_INVOICED',
        invoiced: [10, 5],
      });
      const invoiceBefore = await invoiceRow(id);

      await inTx((tx) => revertPurchaseInvoiceEffectsTx(tx, ctx, id));

      expect(await orderState(order.id)).toEqual(before);
      // No toca el estado de la FC ni su asiento (lo decide el motor).
      expect(await invoiceRow(id)).toEqual(invoiceBefore);
    });

    it('cambio de OC: revert + write + apply devuelve la OC vieja y factura la nueva', async () => {
      const oldOrder = await purchaseOrder(companyId, supplierId, [4]);
      const newOrder = await purchaseOrder(companyId, supplierId, [4]);
      const { id, input } = await confirmedInvoice({
        purchaseOrderId: oldOrder.id,
        lines: [line({ quantity: '4', purchaseOrderLineId: oldOrder.lines[0].id })],
      });
      expect(await orderState(oldOrder.id)).toEqual({
        invoicingStatus: 'FULLY_INVOICED',
        invoiced: [4],
      });
      const { journalEntryId } = await invoiceRow(id);

      await inTx(async (tx) => {
        await revertPurchaseInvoiceEffectsTx(tx, ctx, id);
        await writePurchaseInvoiceDataTx(tx, companyId, id, {
          ...input,
          purchaseOrderId: newOrder.id,
          lines: [line({ quantity: '1', purchaseOrderLineId: newOrder.lines[0].id })],
        });
        await applyPurchaseInvoiceEffectsTx(tx, ctx, id, { rewriteEntryId: journalEntryId! });
      });

      expect(await orderState(oldOrder.id)).toEqual({
        invoicingStatus: 'NOT_INVOICED',
        invoiced: [0],
      });
      expect(await orderState(newOrder.id)).toEqual({
        invoicingStatus: 'PARTIALLY_INVOICED',
        invoiced: [1],
      });
    });
  });

  describe('nota de crédito', () => {
    async function compensatedPair(code: string) {
      const ncSupplierId = await newSupplier(code);
      const { id: invoiceId } = await confirmedInvoice({ supplierId: ncSupplierId });
      const { id: noteId } = await confirmedInvoice({
        supplierId: ncSupplierId,
        voucherType: 'NOTA_CREDITO_A',
        lines: [line({ productId: stockProductId, quantity: '2', unitCost: '100' })],
      });
      return { invoiceId, noteId };
    }

    it('revert(apply) de NC devuelve stock y borra aplicaciones; la factura compensada vuelve a CONFIRMED', async () => {
      const stockBefore = await stockQty();
      const { invoiceId, noteId } = await compensatedPair('NC1');

      // apply: devolución al proveedor y compensación de 242 contra la FC de 1210
      expect(await stockQty()).toEqual({
        quantity: stockBefore.quantity - 2,
        available: stockBefore.available - 2,
      });
      expect(await movementsOf(noteId)).toBe(1);
      expect(
        await prisma.purchaseCreditNoteApplication.findMany({
          where: { creditNoteId: noteId },
          select: { invoiceId: true, amount: true },
        })
      ).toEqual([{ invoiceId, amount: expect.anything() }]);
      expect((await invoiceRow(invoiceId)).status).toBe('PARTIAL_PAID');
      expect((await invoiceRow(noteId)).status).toBe('PAID');
      const { journalEntryId } = await invoiceRow(noteId);

      await inTx((tx) => revertPurchaseInvoiceEffectsTx(tx, ctx, noteId));

      expect(await stockQty()).toEqual(stockBefore);
      expect(await movementsOf(noteId)).toBe(0);
      expect(await prisma.purchaseCreditNoteApplication.count({ where: { creditNoteId: noteId } })).toBe(0);
      expect((await invoiceRow(invoiceId)).status).toBe('CONFIRMED');
      // La NC queda CONFIRMED (sin aplicaciones) y conserva su asiento.
      expect(await invoiceRow(noteId)).toMatchObject({ status: 'CONFIRMED', journalEntryId });
    });

    it('apply con rewriteEntryId conserva el número de asiento y deja los efectos una sola vez', async () => {
      const { invoiceId, noteId } = await compensatedPair('NC2');
      const { journalEntryId } = await invoiceRow(noteId);
      expect(journalEntryId).not.toBeNull();
      const entryBefore = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: journalEntryId! },
        select: { number: true },
      });
      const lastNumberBefore = await readLastEntryNumber(companyId);
      const stockBefore = await stockQty();

      const result = await inTx(async (tx) => {
        await revertPurchaseInvoiceEffectsTx(tx, ctx, noteId);
        return applyPurchaseInvoiceEffectsTx(tx, ctx, noteId, { rewriteEntryId: journalEntryId! });
      });

      expect(result).toEqual({ journalEntryId });
      expect(
        await prisma.journalEntry.findUniqueOrThrow({
          where: { id: journalEntryId! },
          select: { number: true, status: true },
        })
      ).toEqual({ number: entryBefore.number, status: 'DRAFT' });
      expect(await readLastEntryNumber(companyId)).toBe(lastNumberBefore);
      expect(await stockQty()).toEqual(stockBefore);
      expect(await movementsOf(noteId)).toBe(1);
      expect(await prisma.purchaseCreditNoteApplication.count({ where: { creditNoteId: noteId } })).toBe(1);
      expect((await invoiceRow(invoiceId)).status).toBe('PARTIAL_PAID');
      expect((await invoiceRow(noteId)).status).toBe('PAID');
    });

    it('revert de una NC anulada no vuelve a mover stock', async () => {
      const { noteId } = await compensatedPair('NC3');
      await prisma.purchaseInvoice.update({ where: { id: noteId }, data: { status: 'CANCELLED' } });
      const stockBefore = await stockQty();

      await inTx((tx) => revertPurchaseInvoiceEffectsTx(tx, ctx, noteId));

      expect(await stockQty()).toEqual(stockBefore);
      expect(await movementsOf(noteId)).toBe(1);
    });
  });

  describe('impedimentos', () => {
    it('FC con OC y NC con sus movimientos → ninguno', async () => {
      const order = await purchaseOrder(companyId, supplierId, [1]);
      const { id: invoiceId } = await confirmedInvoice({
        purchaseOrderId: order.id,
        lines: [line({ purchaseOrderLineId: order.lines[0].id })],
      });
      const ncSupplierId = await newSupplier('IMP1');
      const { id: noteId } = await confirmedInvoice({
        supplierId: ncSupplierId,
        voucherType: 'NOTA_CREDITO_A',
        lines: [line({ productId: stockProductId, quantity: '1', unitCost: '100' })],
      });
      expect(await impedimentCodes(invoiceId)).toEqual([]);
      expect(await impedimentCodes(noteId)).toEqual([]);
    });

    it('NC en borrador → ninguno', async () => {
      const { id } = await draftInvoice({
        voucherType: 'NOTA_CREDITO_A',
        lines: [line({ productId: stockProductId })],
      });
      expect(await impedimentCodes(id)).toEqual([]);
    });

    it('NC confirmada con ítems de stock y sin movimientos → untraceable', async () => {
      const ncSupplierId = await newSupplier('IMP2');
      const { id } = await confirmedInvoice({
        supplierId: ncSupplierId,
        voucherType: 'NOTA_CREDITO_A',
        lines: [
          line({ productId: stockProductId, quantity: '1', unitCost: '100' }),
          line({ productId: serviceProductId, quantity: '1', unitCost: '100' }),
        ],
      });
      // Anterior a la trazabilidad: la devolución no dejó movimiento ubicable.
      await prisma.stockMovement.deleteMany({
        where: { referenceType: 'purchase_invoice', referenceId: id },
      });

      const list = await inTx((tx) => purchaseInvoiceEffectImpedimentsTx(tx, id, DOC_LABEL));
      expect(list).toEqual([
        {
          code: 'UNTRACEABLE_EFFECT',
          severity: 'BLOCKED',
          message: `Un movimiento de ${DOC_LABEL} es anterior a la trazabilidad y no se puede corregir automáticamente.`,
        },
      ]);
    });
  });

  describe('writePurchaseInvoiceDataTx', () => {
    it('cambia líneas y totales de una FC confirmada', async () => {
      const { id, input } = await confirmedInvoice();
      const before = await invoiceRow(id);
      expect(Number(before.total)).toBe(1210);

      await inTx((tx) =>
        writePurchaseInvoiceDataTx(tx, companyId, id, {
          ...input,
          number: '00099999',
          notes: `${PREFIX}editada`,
          lines: [
            line({ productId: serviceProductId, quantity: '2', unitCost: '500', vatRate: '10.5' }),
            line({
              description: `${PREFIX}con centro`,
              quantity: '1',
              unitCost: '300',
              vatRate: '21',
              costCenterAllocations: [{ costCenterId, percentage: 100 }],
            }),
          ],
          perceptions: [{ type: 'IVA', baseAmount: '1000', amount: '30' }],
          internalTaxes: '20',
        })
      );

      const after = await prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id },
        select: {
          status: true,
          journalEntryId: true,
          fullNumber: true,
          subtotal: true,
          vatAmount: true,
          otherTaxes: true,
          internalTaxes: true,
          total: true,
          notes: true,
          lines: {
            select: {
              quantity: true,
              total: true,
              costCenterAllocations: { select: { costCenterId: true } },
            },
            orderBy: { total: 'desc' },
          },
          perceptions: { select: { amount: true } },
        },
      });
      // 2×500 + 10,5% = 1105; 300 + 21% = 363; + percepción 30 + internos 20
      expect({
        status: after.status,
        journalEntryId: after.journalEntryId,
        fullNumber: after.fullNumber,
        subtotal: Number(after.subtotal),
        vatAmount: Number(after.vatAmount),
        otherTaxes: Number(after.otherTaxes),
        internalTaxes: Number(after.internalTaxes),
        total: Number(after.total),
        notes: after.notes,
        lines: after.lines.map((l) => ({
          quantity: Number(l.quantity),
          total: Number(l.total),
          costCenters: l.costCenterAllocations.map((a) => a.costCenterId),
        })),
        perceptions: after.perceptions.map((p) => Number(p.amount)),
      }).toEqual({
        status: 'CONFIRMED',
        journalEntryId: before.journalEntryId,
        fullNumber: '0001-00099999',
        subtotal: 1300,
        vatAmount: 168,
        otherTaxes: 50,
        internalTaxes: 20,
        total: 1518,
        notes: `${PREFIX}editada`,
        lines: [
          { quantity: 2, total: 1105, costCenters: [] },
          { quantity: 1, total: 363, costCenters: [costCenterId] },
        ],
        perceptions: [30],
      });
    });

    it('rechaza un número que ya tiene otra factura del proveedor', async () => {
      const { input: taken } = await draftInvoice();
      const { id, input } = await draftInvoice();
      await expect(
        inTx((tx) => writePurchaseInvoiceDataTx(tx, companyId, id, { ...input, number: taken.number }))
      ).rejects.toThrow(BusinessError);
    });

    describe('referencias de otra empresa (R10)', () => {
      let foreignSupplierId: string;
      let foreignOrder: { id: string; lines: { id: string }[] };
      let foreignProductId: string;
      let foreignCostCenterId: string;
      let ownOrderA: { id: string; lines: { id: string }[] };
      let ownOrderB: { id: string; lines: { id: string }[] };
      let otherSupplierOrder: { id: string; lines: { id: string }[] };

      beforeAll(async () => {
        ownOrderA = await purchaseOrder(companyId, supplierId, [1]);
        ownOrderB = await purchaseOrder(companyId, supplierId, [1]);
        otherSupplierOrder = await purchaseOrder(companyId, await newSupplier('OTRO'), [1]);
        const other = await prisma.company.create({
          data: { name: `${PREFIX}Otra empresa`, isActive: true },
          select: { id: true },
        });
        otherCompanyId = other.id;
        foreignSupplierId = (
          await prisma.supplier.create({
            data: {
              companyId: other.id,
              code: `${PREFIX}AJENO`,
              businessName: `${PREFIX}Proveedor ajeno`,
              taxId: '30500000003',
              taxCondition: 'RESPONSABLE_INSCRIPTO',
              createdBy: 'test',
            },
            select: { id: true },
          })
        ).id;
        foreignOrder = await purchaseOrder(other.id, foreignSupplierId, [3]);
        foreignProductId = (
          await prisma.product.create({
            data: {
              companyId: other.id,
              code: `${PREFIX}AJENO`,
              name: `${PREFIX}ajeno`,
              usage: 'PURCHASE',
              trackStock: false,
              createdBy: 'test',
            },
            select: { id: true },
          })
        ).id;
        foreignCostCenterId = (
          await prisma.costCenter.create({
            data: { companyId: other.id, name: `${PREFIX}Centro ajeno` },
            select: { id: true },
          })
        ).id;
      });

      const cases: [string, () => Partial<PurchaseInvoiceFormInput>][] = [
        ['proveedor ajeno', () => ({ supplierId: foreignSupplierId })],
        [
          'OC ajena',
          () => ({
            purchaseOrderId: foreignOrder.id,
            lines: [line({ purchaseOrderLineId: foreignOrder.lines[0].id })],
          }),
        ],
        [
          'línea de OC ajena',
          () => ({ lines: [line({ purchaseOrderLineId: foreignOrder.lines[0].id })] }),
        ],
        [
          'línea de otra OC de la empresa',
          () => ({
            purchaseOrderId: ownOrderA.id,
            lines: [line({ purchaseOrderLineId: ownOrderB.lines[0].id })],
          }),
        ],
        ['OC de otro proveedor', () => ({ purchaseOrderId: otherSupplierOrder.id })],
        ['ítem ajeno', () => ({ lines: [line({ productId: foreignProductId })] })],
        [
          'centro de costo ajeno',
          () => ({
            lines: [line({ costCenterAllocations: [{ costCenterId: foreignCostCenterId, percentage: 100 }] })],
          }),
        ],
      ];

      it.each(cases)('%s → BusinessError y la FC queda igual', async (_name, overrides) => {
        const { id, input } = await confirmedInvoice();
        const before = await invoiceRow(id);
        const linesBefore = await prisma.purchaseInvoiceLine.findMany({
          where: { invoiceId: id },
          select: { id: true, productId: true, purchaseOrderLineId: true },
        });

        await expect(
          inTx((tx) => writePurchaseInvoiceDataTx(tx, companyId, id, { ...input, ...overrides() }))
        ).rejects.toThrow(BusinessError);

        expect(await invoiceRow(id)).toEqual(before);
        expect(
          await prisma.purchaseInvoiceLine.findMany({
            where: { invoiceId: id },
            select: { id: true, productId: true, purchaseOrderLineId: true },
          })
        ).toEqual(linesBefore);
      });

      it('factura de otra empresa → BusinessError', async () => {
        const { id, input } = await draftInvoice();
        await expect(
          inTx((tx) => writePurchaseInvoiceDataTx(tx, otherCompanyId!, id, input))
        ).rejects.toThrow(BusinessError);
      });
    });
  });

  describe('validatePurchaseInvoiceForConfirmation', () => {
    it('dentro de la tx valida los datos recién escritos', async () => {
      const { id, input } = await draftInvoice();
      // Con los datos guardados la factura se puede confirmar.
      await expect(validatePurchaseInvoiceForConfirmation(id, companyId)).resolves.toBeUndefined();

      const outcome = await inTx(async (tx) => {
        await writePurchaseInvoiceDataTx(tx, companyId, id, {
          ...input,
          lines: [line({ productId: badAccountProductId })],
        });
        return validatePurchaseInvoiceForConfirmation(id, companyId, tx).then(
          () => 'ok',
          (error: unknown) => (error instanceof BusinessError ? 'business' : String(error))
        );
      });
      expect(outcome).toBe('business');
    });

    it('rechaza una factura de otra empresa', async () => {
      const { id } = await draftInvoice();
      await expect(
        validatePurchaseInvoiceForConfirmation(id, '00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(BusinessError);
    });
  });

  describe('updatePurchaseInvoice (borrador)', () => {
    it('edita un borrador y rechaza una FC confirmada', async () => {
      const { id, input } = await draftInvoice();
      await updatePurchaseInvoice(id, { ...input, lines: [line({ unitCost: '2000' })] });
      expect(Number((await invoiceRow(id)).total)).toBe(2420);

      const confirmed = await confirmedInvoice();
      await expect(updatePurchaseInvoice(confirmed.id, confirmed.input)).rejects.toThrow(
        'No se puede editar una factura confirmada'
      );
    });
  });

  describe('unapplySalesCreditNoteTx', () => {
    it('borra las aplicaciones que dio la NC, recalcula las facturas y deja la NC CONFIRMED', async () => {
      const mkSales = (voucherType: 'FACTURA_A' | 'NOTA_CREDITO_A', total: number, status: 'CONFIRMED' | 'PARTIAL_PAID' | 'PAID') => {
        const number = seq++;
        return prisma.salesInvoice.create({
          data: {
            companyId,
            customerId,
            pointOfSaleId,
            voucherType,
            number,
            fullNumber: `9793-${String(number).padStart(8, '0')}`,
            issueDate: ISSUE_DATE,
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
      };
      const invoice = await mkSales('FACTURA_A', 1000, 'PARTIAL_PAID');
      const note = await mkSales('NOTA_CREDITO_A', 300, 'PAID');
      await prisma.salesCreditNoteApplication.create({
        data: { creditNoteId: note.id, invoiceId: invoice.id, amount: 300, companyId },
      });

      const affected = await inTx((tx) => unapplySalesCreditNoteTx(tx, note.id));

      expect(affected).toEqual([invoice.id]);
      expect(await prisma.salesCreditNoteApplication.count({ where: { creditNoteId: note.id } })).toBe(0);
      const statuses = await prisma.salesInvoice.findMany({
        where: { id: { in: [invoice.id, note.id] } },
        select: { id: true, status: true },
      });
      expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
        [invoice.id]: 'CONFIRMED',
        [note.id]: 'CONFIRMED',
      });
    });
  });

  it('unapplyPurchaseCreditNoteTx devuelve las facturas afectadas', async () => {
    const ncSupplierId = await newSupplier('UNAP');
    const { id: invoiceId } = await confirmedInvoice({ supplierId: ncSupplierId });
    const { id: noteId } = await confirmedInvoice({
      supplierId: ncSupplierId,
      voucherType: 'NOTA_CREDITO_A',
      lines: [line({ productId: serviceProductId, unitCost: '100' })],
    });

    expect(await inTx((tx) => unapplyPurchaseCreditNoteTx(tx, noteId))).toEqual([invoiceId]);
    expect((await invoiceRow(invoiceId)).status).toBe('CONFIRMED');
    expect((await invoiceRow(noteId)).status).toBe('CONFIRMED');
  });
});
