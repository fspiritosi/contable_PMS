/**
 * Tests de integración de los efectos de la factura de venta (TSK-792, Tarea 10),
 * contra la base real: `applySalesInvoiceEffectsTx` (vía `confirmInvoice` y directo,
 * con `rewriteEntryId`), su inversa `revertSalesInvoiceEffectsTx`, los impedimentos
 * propios (`salesInvoiceEffectImpedimentsTx`), la escritura de datos
 * (`writeSalesInvoiceDataTx`) y la validación previa a confirmar.
 *
 * Los borradores se crean con el server action real (`createInvoice`) y se confirman
 * con `confirmInvoice`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { Tx } from '@/modules/accounting/features/integrations/core';
import { prisma } from '@/shared/lib/prisma';

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
  confirmInvoice,
  createInvoice,
  updateInvoice,
} from '@/modules/commercial/features/sales/features/invoices/list/actions.server';
import { createInvoiceSchema } from '@/modules/commercial/features/sales/features/invoices/shared/validators';
import {
  acceptDeliveryNote,
  createDeliveryNote,
  invoiceDeliveryNotes,
} from '@/modules/commercial/features/sales/features/delivery-notes/list/actions.server';
import {
  applySalesInvoiceEffectsTx,
  revertSalesInvoiceEffectsTx,
  salesInvoiceEffectImpedimentsTx,
  validateSalesInvoiceForConfirmation,
} from './sales-invoice.server';
import { writeSalesInvoiceDataTx } from './sales-invoice-data.server';
import type { EffectsCtx } from './types';

const PREFIX = 'TSK792-FVFX-';
const ISSUE_DATE = new Date('2026-03-10');
const DOC_LABEL = 'la FV de prueba';
const FIXED_FIELDS_MESSAGE =
  'El punto de venta, el tipo y el número de una factura de venta no se pueden modificar.';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type RawInput = z.input<typeof createInvoiceSchema>;
type RawLine = RawInput['lines'][number];
type DataInput = Parameters<typeof writeSalesInvoiceDataTx>[3];

const inTx = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction((tx) => fn(tx));

describe.skipIf(!dbAvailable)('integración: efectos de la factura de venta (TSK-792)', () => {
  let companyId: string;
  let ctx: EffectsCtx;
  let customerId: string;
  let pointOfSaleId: string;
  let otherPointOfSaleId: string;
  let afipPointOfSaleId: string;
  let warehouseId: string;
  let stockProductId: string;
  let serviceProductId: string;
  let badAccountProductId: string;
  let costCenterId: string;
  let otherCompanyId: string;
  let foreignCustomerId: string;
  let foreignProductId: string;
  let foreignCostCenterId: string;
  let foreignWarehouseId: string;
  let seq = 1;

  const line = (overrides: Partial<RawLine> = {}): RawLine => ({
    productId: serviceProductId,
    description: `${PREFIX}línea`,
    quantity: '1',
    unitPrice: '1000',
    vatRate: '21',
    ...overrides,
  });

  const rawInput = (overrides: Partial<RawInput> = {}): RawInput => ({
    customerId,
    pointOfSaleId,
    voucherType: 'FACTURA_A',
    issueDate: ISSUE_DATE,
    lines: [line()],
    internalTaxes: '',
    ...overrides,
  });

  async function draftInvoice(overrides: Partial<RawInput> = {}) {
    const raw = rawInput(overrides);
    const created = await createInvoice(raw);
    return { id: created.id, input: createInvoiceSchema.parse(raw) };
  }

  async function confirmedInvoice(overrides: Partial<RawInput> = {}) {
    const draft = await draftInvoice(overrides);
    const result = await confirmInvoice(draft.id);
    if (!result.success) throw new Error(`No se pudo confirmar la FV: ${result.error}`);
    return draft;
  }

  /** Cliente propio por test de NC: la NC compensa FIFO contra todo lo pendiente del cliente. */
  async function newCustomer(code: string, forCompanyId = companyId): Promise<string> {
    return (
      await prisma.contractor.create({
        data: {
          companyId: forCompanyId,
          name: `${PREFIX}Cliente ${code}`,
          taxCondition: 'RESPONSABLE_INSCRIPTO',
        },
        select: { id: true },
      })
    ).id;
  }

  const stockAt = async (atWarehouseId = warehouseId) => {
    const stock = await prisma.warehouseStock.findUnique({
      where: { warehouseId_productId: { warehouseId: atWarehouseId, productId: stockProductId } },
      select: { quantity: true, availableQty: true },
    });
    return { quantity: Number(stock?.quantity ?? 0), available: Number(stock?.availableQty ?? 0) };
  };
  const invoiceRow = (id: string) =>
    prisma.salesInvoice.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        journalEntryId: true,
        pointOfSaleId: true,
        voucherType: true,
        number: true,
        fullNumber: true,
        customerId: true,
        total: true,
        updatedAt: true,
      },
    });
  const invoiceLines = (id: string) =>
    prisma.salesInvoiceLine.findMany({
      where: { invoiceId: id },
      select: { id: true, productId: true, quantity: true },
      orderBy: { id: 'asc' },
    });
  const movementsOf = (invoiceId: string) =>
    prisma.stockMovement.findMany({
      where: { referenceType: 'sales_invoice', referenceId: invoiceId },
      select: { id: true, type: true, warehouseId: true, quantity: true },
    });
  const impedimentsOf = (id: string) =>
    inTx((tx) => salesInvoiceEffectImpedimentsTx(tx, id, DOC_LABEL));

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true, taxStatus: 'RESPONSABLE_INSCRIPTO' },
    });
    companyId = company.id;
    ctx = { companyId, userId: 'test-user' };

    const mk = (
      code: string,
      name: string,
      type: 'ASSET' | 'LIABILITY' | 'REVENUE',
      nature: 'DEBIT' | 'CREDIT',
      extra: { isLeaf?: boolean } = {}
    ) =>
      prisma.account.create({
        data: { companyId, code, name: `${PREFIX}${name}`, type, nature, ...extra },
      });
    const [ventas, cobrar, ivaDf, rubro] = await Promise.all([
      mk('T792V-VENTAS', 'Ventas', 'REVENUE', 'CREDIT'),
      mk('T792V-COBRAR', 'Cuentas por Cobrar', 'ASSET', 'DEBIT'),
      mk('T792V-IVADF', 'IVA Debito Fiscal', 'LIABILITY', 'CREDIT'),
      // Cuenta con hijas: no es imputable.
      mk('T792V-RUBRO', 'Ventas (rubro)', 'REVENUE', 'CREDIT', { isLeaf: false }),
    ]);

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        salesAccountId: ventas.id,
        receivablesAccountId: cobrar.id,
        vatDebitAccountId: ivaDf.id,
        requireCostCenter: false,
      },
    });

    customerId = await newCustomer('PRINCIPAL');

    const mkPos = (number: number, afipEnabled = false) =>
      prisma.salesPointOfSale
        .create({
          data: { companyId, number, name: `${PREFIX}PDV ${number}`, afipEnabled, createdBy: 'test' },
          select: { id: true },
        })
        .then((p) => p.id);
    [pointOfSaleId, otherPointOfSaleId, afipPointOfSaleId] = await Promise.all([
      mkPos(9794),
      mkPos(9795),
      mkPos(9796, true),
    ]);

    const mkProduct = (
      forCompanyId: string,
      code: string,
      trackStock: boolean,
      defaultIncomeAccountId: string | null = null
    ) =>
      prisma.product
        .create({
          data: {
            companyId: forCompanyId,
            code: `${PREFIX}${code}`,
            name: `${PREFIX}${code}`,
            usage: 'SALE',
            trackStock,
            defaultIncomeAccountId,
            createdBy: 'test',
          },
          select: { id: true },
        })
        .then((p) => p.id);
    [stockProductId, serviceProductId, badAccountProductId] = await Promise.all([
      mkProduct(companyId, 'STOCK', true),
      mkProduct(companyId, 'SERV', false),
      mkProduct(companyId, 'RUBRO', false, rubro.id),
    ]);

    warehouseId = (
      await prisma.warehouse.create({
        data: { companyId, code: 'T792V-MAIN', name: `${PREFIX}Depósito`, type: 'MAIN' },
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

    // Otra empresa, para las referencias ajenas (R10) y el filtro por empresa.
    otherCompanyId = (
      await prisma.company.create({
        data: { name: `${PREFIX}Otra empresa`, isActive: true },
        select: { id: true },
      })
    ).id;
    foreignCustomerId = await newCustomer('AJENO', otherCompanyId);
    foreignProductId = await mkProduct(otherCompanyId, 'AJENO', true);
    foreignCostCenterId = (
      await prisma.costCenter.create({
        data: { companyId: otherCompanyId, name: `${PREFIX}Centro ajeno` },
        select: { id: true },
      })
    ).id;
    foreignWarehouseId = (
      await prisma.warehouse.create({
        data: {
          companyId: otherCompanyId,
          code: 'T792V-AJENO',
          name: `${PREFIX}Depósito ajeno`,
          type: 'MAIN',
        },
        select: { id: true },
      })
    ).id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
    if (companyId) {
      await prisma.deliveryNote.deleteMany({ where: { companyId } });
      await prisma.stockMovement.deleteMany({ where: { companyId } });
      await prisma.warehouseStock.deleteMany({ where: { warehouse: { companyId } } });
      await prisma.warehouse.deleteMany({ where: { companyId } });
      await prisma.salesCreditNoteApplication.deleteMany({ where: { companyId } });
      // Las líneas, repartos y percepciones caen en cascada con la factura.
      await prisma.salesInvoice.deleteMany({ where: { companyId } });
      await cleanupAccountingCompany(companyId);
      await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
      await prisma.contractor.deleteMany({ where: { companyId } });
      await prisma.product.deleteMany({ where: { companyId } });
      await prisma.costCenter.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    if (otherCompanyId) {
      await prisma.stockMovement.deleteMany({ where: { companyId: otherCompanyId } });
      await prisma.warehouse.deleteMany({ where: { companyId: otherCompanyId } });
      await prisma.product.deleteMany({ where: { companyId: otherCompanyId } });
      await prisma.costCenter.deleteMany({ where: { companyId: otherCompanyId } });
      await prisma.contractor.deleteMany({ where: { companyId: otherCompanyId } });
      await prisma.company.deleteMany({ where: { id: otherCompanyId } });
    }
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    await prisma.$disconnect();
  });

  it('dos confirmaciones simultáneas aplican los efectos una sola vez (TSK-812)', async () => {
    const { id } = await draftInvoice({ lines: [line({ productId: stockProductId, quantity: '3' })] });
    const stockBefore = await stockAt();
    const lastNumberBefore = await readLastEntryNumber(companyId);

    const results = await Promise.all([confirmInvoice(id), confirmInvoice(id)]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => !r.success)).toEqual([
      { success: false, error: 'Factura no encontrada o ya está confirmada' },
    ]);
    expect((await invoiceRow(id)).status).toBe('CONFIRMED');
    expect(await stockAt()).toEqual({
      quantity: stockBefore.quantity - 3,
      available: stockBefore.available - 3,
    });
    expect((await movementsOf(id)).map((m) => [m.type, Number(m.quantity)])).toEqual([['SALE', 3]]);
    expect(await readLastEntryNumber(companyId)).toBe(lastNumberBefore + 1);
  });

  describe('stock de la factura', () => {
    it('revert(apply) de factura con dos líneas del mismo producto restaura todo el stock', async () => {
      const stockBefore = await stockAt();
      const { id } = await confirmedInvoice({
        lines: [
          line({ productId: stockProductId, quantity: '3' }),
          line({ productId: stockProductId, quantity: '2' }),
          line(),
        ],
      });

      // apply: dos SALE en el almacén principal, uno por línea con stock
      expect(await stockAt()).toEqual({
        quantity: stockBefore.quantity - 5,
        available: stockBefore.available - 5,
      });
      const movements = await movementsOf(id);
      expect(movements.map((m) => [m.type, m.warehouseId, Number(m.quantity)]).sort()).toEqual([
        ['SALE', warehouseId, 2],
        ['SALE', warehouseId, 3],
      ]);
      const invoiceBefore = await invoiceRow(id);
      expect(invoiceBefore.status).toBe('CONFIRMED');
      expect(invoiceBefore.journalEntryId).not.toBeNull();

      await inTx((tx) => revertSalesInvoiceEffectsTx(tx, ctx, id));

      expect(await stockAt()).toEqual(stockBefore);
      expect(await movementsOf(id)).toEqual([]);
      // No toca el estado de la FV ni su asiento (lo decide el motor).
      expect(await invoiceRow(id)).toEqual(invoiceBefore);
    });

    it('cada movimiento vuelve a su propio almacén, no al principal de hoy', async () => {
      const { id } = await confirmedInvoice({
        lines: [
          line({ productId: stockProductId, quantity: '3' }),
          line({ productId: stockProductId, quantity: '2' }),
        ],
      });
      // Un movimiento (histórico) salió de otro almacén.
      const second = await prisma.warehouse.create({
        data: { companyId, code: `T792V-W${seq++}`, name: `${PREFIX}Depósito 2`, type: 'MAIN' },
        select: { id: true },
      });
      await prisma.warehouseStock.create({
        data: {
          warehouseId: second.id,
          productId: stockProductId,
          quantity: 10,
          reservedQty: 0,
          availableQty: 10,
        },
      });
      const moved = (await movementsOf(id)).find((m) => Number(m.quantity) === 2)!;
      await prisma.stockMovement.update({ where: { id: moved.id }, data: { warehouseId: second.id } });
      const mainBefore = await stockAt();

      await inTx((tx) => revertSalesInvoiceEffectsTx(tx, ctx, id));

      expect(await stockAt()).toEqual({
        quantity: mainBefore.quantity + 3,
        available: mainBefore.available + 3,
      });
      expect(await stockAt(second.id)).toEqual({ quantity: 12, available: 12 });
      expect(await movementsOf(id)).toEqual([]);
      await prisma.warehouseStock.deleteMany({ where: { warehouseId: second.id } });
      await prisma.warehouse.delete({ where: { id: second.id } });
    });

    it('apply con rewriteEntryId conserva el número de asiento y descuenta el stock una sola vez', async () => {
      const { id } = await confirmedInvoice({
        lines: [line({ productId: stockProductId, quantity: '4' })],
      });
      const { journalEntryId } = await invoiceRow(id);
      const entryBefore = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: journalEntryId! },
        select: { number: true },
      });
      const lastNumberBefore = await readLastEntryNumber(companyId);
      const stockBefore = await stockAt();

      const result = await inTx(async (tx) => {
        await revertSalesInvoiceEffectsTx(tx, ctx, id);
        return applySalesInvoiceEffectsTx(tx, ctx, id, { rewriteEntryId: journalEntryId! });
      });

      expect(result).toEqual({ journalEntryId });
      expect(
        await prisma.journalEntry.findUniqueOrThrow({
          where: { id: journalEntryId! },
          select: { number: true, status: true },
        })
      ).toEqual({ number: entryBefore.number, status: 'DRAFT' });
      expect(await readLastEntryNumber(companyId)).toBe(lastNumberBefore);
      expect(await stockAt()).toEqual(stockBefore);
      expect((await movementsOf(id)).map((m) => [m.type, Number(m.quantity)])).toEqual([['SALE', 4]]);
    });

    it('apply rechaza la venta sin stock suficiente y la FV queda en borrador', async () => {
      const { id } = await draftInvoice({
        lines: [line({ productId: stockProductId, quantity: '100000' })],
      });
      const result = await confirmInvoice(id);
      expect(result.success).toBe(false);
      expect(result.success ? '' : result.error).toContain('Stock insuficiente');
      expect((await invoiceRow(id)).status).toBe('DRAFT');
      expect(await movementsOf(id)).toEqual([]);
    });

    it('la ND no mueve stock y revertirla no hace nada', async () => {
      const stockBefore = await stockAt();
      const { id } = await confirmedInvoice({
        voucherType: 'NOTA_DEBITO_A',
        lines: [line({ productId: stockProductId, quantity: '1' })],
      });
      expect(await stockAt()).toEqual(stockBefore);
      expect(await movementsOf(id)).toEqual([]);

      await inTx((tx) => revertSalesInvoiceEffectsTx(tx, ctx, id));
      expect(await stockAt()).toEqual(stockBefore);
      expect(await impedimentsOf(id)).toEqual([]);
    });

    it('revert de una FV anulada o en borrador no mueve stock', async () => {
      const { id: cancelledId } = await confirmedInvoice({
        lines: [line({ productId: stockProductId, quantity: '1' })],
      });
      await prisma.salesInvoice.update({ where: { id: cancelledId }, data: { status: 'CANCELLED' } });
      const { id: draftId } = await draftInvoice({
        lines: [line({ productId: stockProductId, quantity: '1' })],
      });
      const stockBefore = await stockAt();

      await inTx(async (tx) => {
        await revertSalesInvoiceEffectsTx(tx, ctx, cancelledId);
        await revertSalesInvoiceEffectsTx(tx, ctx, draftId);
      });

      expect(await stockAt()).toEqual(stockBefore);
      expect(await movementsOf(cancelledId)).toHaveLength(1);
    });

    it('revert de una factura de otra empresa → BusinessError', async () => {
      const { id } = await confirmedInvoice();
      await expect(
        inTx((tx) => revertSalesInvoiceEffectsTx(tx, { ...ctx, companyId: otherCompanyId }, id))
      ).rejects.toThrow(BusinessError);
    });
  });

  describe('factura desde remitos (TSK-798)', () => {
    /** Remito aceptado del ítem de stock: ya descontó el stock al crearse. */
    async function acceptedNote(quantity: string) {
      const note = await createDeliveryNote({
        customerId,
        warehouseId,
        deliveryDate: ISSUE_DATE,
        lines: [{ productId: stockProductId, description: `${PREFIX}remito`, quantity }],
      });
      await acceptDeliveryNote(note.id);
      return note.id;
    }

    beforeAll(async () => {
      // La FV desde remitos toma el precio de venta del ítem.
      await prisma.product.update({ where: { id: stockProductId }, data: { salePrice: 1000 } });
    });

    it('confirmar la FV de un remito no vuelve a descontar el stock que movió el remito', async () => {
      const before = await stockAt();
      const noteId = await acceptedNote('4');
      expect((await stockAt()).quantity).toBe(before.quantity - 4);

      const invoice = await invoiceDeliveryNotes([noteId]);
      expect(await confirmInvoice(invoice.id)).toEqual({ success: true, id: invoice.id });

      expect((await stockAt()).quantity).toBe(before.quantity - 4);
      expect(await movementsOf(invoice.id)).toEqual([]);
      expect(await impedimentsOf(invoice.id)).toEqual([]);
    });

    it('revertir la FV de un remito no devuelve el stock: la mercadería salió con el remito', async () => {
      const before = await stockAt();
      const invoice = await invoiceDeliveryNotes([await acceptedNote('2')]);
      await confirmInvoice(invoice.id);

      await inTx((tx) => revertSalesInvoiceEffectsTx(tx, ctx, invoice.id));

      expect((await stockAt()).quantity).toBe(before.quantity - 2);
      expect(await movementsOf(invoice.id)).toEqual([]);
    });

    it('un borrador editado con más cantidad que el remito descuenta solo el excedente', async () => {
      const before = await stockAt();
      const invoice = await invoiceDeliveryNotes([await acceptedNote('3')]);
      await updateInvoice(
        invoice.id,
        rawInput({ lines: [line({ productId: stockProductId, quantity: '5' })] })
      );

      expect(await confirmInvoice(invoice.id)).toEqual({ success: true, id: invoice.id });

      expect((await stockAt()).quantity).toBe(before.quantity - 5);
      expect(
        (await movementsOf(invoice.id)).map((m) => [m.type, Number(m.quantity)])
      ).toEqual([['SALE', 2]]);
      expect(await impedimentsOf(invoice.id)).toEqual([]);
    });
  });

  describe('nota de crédito', () => {
    async function compensatedPair(code: string) {
      const ncCustomerId = await newCustomer(code);
      const { id: invoiceId } = await confirmedInvoice({ customerId: ncCustomerId });
      const { id: noteId } = await confirmedInvoice({
        customerId: ncCustomerId,
        voucherType: 'NOTA_CREDITO_A',
        lines: [line({ productId: stockProductId, quantity: '2', unitPrice: '100' })],
      });
      return { invoiceId, noteId };
    }

    it('revert(apply) de NC de venta resta lo que sumó y borra sus aplicaciones', async () => {
      const stockBefore = await stockAt();
      const { invoiceId, noteId } = await compensatedPair('NC1');

      // apply: el cliente devuelve 2 y la NC de 242 compensa la FV de 1210
      expect(await stockAt()).toEqual({
        quantity: stockBefore.quantity + 2,
        available: stockBefore.available + 2,
      });
      expect((await movementsOf(noteId)).map((m) => [m.type, Number(m.quantity)])).toEqual([
        ['RETURN', 2],
      ]);
      expect(
        await prisma.salesCreditNoteApplication.findMany({
          where: { creditNoteId: noteId },
          select: { invoiceId: true },
        })
      ).toEqual([{ invoiceId }]);
      expect((await invoiceRow(invoiceId)).status).toBe('PARTIAL_PAID');
      expect((await invoiceRow(noteId)).status).toBe('PAID');
      const { journalEntryId } = await invoiceRow(noteId);

      await inTx((tx) => revertSalesInvoiceEffectsTx(tx, ctx, noteId));

      expect(await stockAt()).toEqual(stockBefore);
      expect(await movementsOf(noteId)).toEqual([]);
      expect(await prisma.salesCreditNoteApplication.count({ where: { creditNoteId: noteId } })).toBe(0);
      expect((await invoiceRow(invoiceId)).status).toBe('CONFIRMED');
      // La NC queda CONFIRMED (sin aplicaciones) y conserva su asiento.
      expect(await invoiceRow(noteId)).toMatchObject({ status: 'CONFIRMED', journalEntryId });
    });

    it('revert + apply con rewriteEntryId deja la NC como estaba', async () => {
      const { invoiceId, noteId } = await compensatedPair('NC2');
      const { journalEntryId } = await invoiceRow(noteId);
      const stockBefore = await stockAt();

      await inTx(async (tx) => {
        await revertSalesInvoiceEffectsTx(tx, ctx, noteId);
        await applySalesInvoiceEffectsTx(tx, ctx, noteId, { rewriteEntryId: journalEntryId! });
      });

      expect(await stockAt()).toEqual(stockBefore);
      expect(await movementsOf(noteId)).toHaveLength(1);
      expect(await prisma.salesCreditNoteApplication.count({ where: { creditNoteId: noteId } })).toBe(1);
      expect((await invoiceRow(invoiceId)).status).toBe('PARTIAL_PAID');
      expect(await invoiceRow(noteId)).toMatchObject({ status: 'PAID', journalEntryId });
    });
  });

  describe('impedimentos', () => {
    it('FV y NC con sus movimientos, y FV en borrador → ninguno', async () => {
      const { id: invoiceId } = await confirmedInvoice({
        lines: [line({ productId: stockProductId })],
      });
      const { id: noteId } = await confirmedInvoice({
        customerId: await newCustomer('IMP1'),
        voucherType: 'NOTA_CREDITO_A',
        lines: [line({ productId: stockProductId, unitPrice: '100' })],
      });
      const { id: draftId } = await draftInvoice({ lines: [line({ productId: stockProductId })] });
      expect(await impedimentsOf(invoiceId)).toEqual([]);
      expect(await impedimentsOf(noteId)).toEqual([]);
      expect(await impedimentsOf(draftId)).toEqual([]);
    });

    it('FV confirmada con ítems de stock y sin movimientos → untraceable, aunque otra empresa tenga uno con ese id', async () => {
      const { id } = await confirmedInvoice({
        lines: [line({ productId: stockProductId }), line()],
      });
      // Anterior a la trazabilidad: la venta no dejó movimiento ubicable.
      await prisma.stockMovement.deleteMany({
        where: { referenceType: 'sales_invoice', referenceId: id },
      });
      // Un movimiento de otra empresa con la misma referencia no cuenta.
      await prisma.stockMovement.create({
        data: {
          companyId: otherCompanyId,
          warehouseId: foreignWarehouseId,
          productId: foreignProductId,
          type: 'SALE',
          quantity: 1,
          referenceType: 'sales_invoice',
          referenceId: id,
          date: ISSUE_DATE,
          createdBy: 'test',
        },
      });

      expect(await impedimentsOf(id)).toEqual([
        {
          code: 'UNTRACEABLE_EFFECT',
          severity: 'BLOCKED',
          message: `Un movimiento de ${DOC_LABEL} es anterior a la trazabilidad y no se puede corregir automáticamente.`,
        },
      ]);
    });

    it('FV con CAE → AFIP_CAE', async () => {
      const { id } = await confirmedInvoice();
      await prisma.salesInvoice.update({ where: { id }, data: { cae: '71234567890123' } });

      expect(await impedimentsOf(id)).toEqual([
        {
          code: 'AFIP_CAE',
          severity: 'BLOCKED',
          message: `${DOC_LABEL} tiene CAE de AFIP y no se puede modificar, eliminar ni anular desde acá.`,
          action: 'Emití una nota de crédito para corregirla.',
        },
      ]);
    });

    it('FV de un punto de venta habilitado para AFIP → AFIP_CAE', async () => {
      const { id } = await confirmedInvoice({ pointOfSaleId: afipPointOfSaleId });
      expect((await impedimentsOf(id)).map((i) => i.code)).toEqual(['AFIP_CAE']);
    });
  });

  describe('writeSalesInvoiceDataTx', () => {
    it('cambia cliente, líneas y totales de una FV confirmada', async () => {
      const { id, input } = await confirmedInvoice();
      const before = await invoiceRow(id);
      const otherCustomerId = await newCustomer('NUEVO');

      await inTx((tx) =>
        writeSalesInvoiceDataTx(
          tx,
          companyId,
          id,
          createInvoiceSchema.parse(
            rawInput({
              customerId: otherCustomerId,
              notes: `${PREFIX}editada`,
              globalDiscountPercent: '10',
              lines: [
                line({ quantity: '2', unitPrice: '500', vatRate: '10.5', discountPercent: '10' }),
                line({
                  description: `${PREFIX}con centro`,
                  unitPrice: '300',
                  costCenterAllocations: [{ costCenterId, percentage: 100 }],
                }),
              ],
              perceptions: [{ type: 'IVA', baseAmount: '1000', amount: '30' }],
              internalTaxes: '20',
            })
          )
        )
      );
      expect(input.voucherType).toBe('FACTURA_A');

      const after = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id },
        select: {
          status: true,
          journalEntryId: true,
          fullNumber: true,
          customerId: true,
          subtotal: true,
          vatAmount: true,
          otherTaxes: true,
          internalTaxes: true,
          total: true,
          totalBeforeDiscount: true,
          discountTotal: true,
          notes: true,
          lines: {
            select: {
              subtotal: true,
              total: true,
              costCenterAllocations: { select: { costCenterId: true } },
            },
            orderBy: { total: 'desc' },
          },
          perceptions: { select: { amount: true } },
        },
      });
      // Línea 1: 2×500 − 10% = 900 + 10,5% = 994,50. Línea 2: 300 + 21% = 363.
      // Descuento global 10% de 1200 = 120, repartido por peso: IVA 85,05 + 56,70.
      expect({
        ...after,
        subtotal: Number(after.subtotal),
        vatAmount: Number(after.vatAmount),
        otherTaxes: Number(after.otherTaxes),
        internalTaxes: Number(after.internalTaxes),
        total: Number(after.total),
        totalBeforeDiscount: Number(after.totalBeforeDiscount),
        discountTotal: Number(after.discountTotal),
        lines: after.lines.map((l) => ({
          subtotal: Number(l.subtotal),
          total: Number(l.total),
          costCenters: l.costCenterAllocations.map((a) => a.costCenterId),
        })),
        perceptions: after.perceptions.map((p) => Number(p.amount)),
      }).toEqual({
        status: 'CONFIRMED',
        journalEntryId: before.journalEntryId,
        fullNumber: before.fullNumber,
        customerId: otherCustomerId,
        subtotal: 1080,
        vatAmount: 141.75,
        otherTaxes: 50,
        internalTaxes: 20,
        total: 1271.75,
        totalBeforeDiscount: 1200,
        discountTotal: 220,
        notes: `${PREFIX}editada`,
        lines: [
          { subtotal: 900, total: 994.5, costCenters: [] },
          { subtotal: 300, total: 363, costCenters: [costCenterId] },
        ],
        perceptions: [30],
      });
    });

    const fixedFieldCases: [string, () => Partial<DataInput>][] = [
      ['el punto de venta', () => ({ pointOfSaleId: otherPointOfSaleId })],
      ['el tipo', () => ({ voucherType: 'NOTA_DEBITO_A' })],
      ['el número', () => ({ number: 99999 })],
    ];

    it.each(fixedFieldCases)('rechaza cambiar %s y la FV queda igual', async (_name, overrides) => {
      const { id, input } = await confirmedInvoice();
      const before = await invoiceRow(id);
      const linesBefore = await invoiceLines(id);

      const outcome = inTx((tx) =>
        writeSalesInvoiceDataTx(tx, companyId, id, {
          ...input,
          lines: [{ ...input.lines[0], quantity: 7 }],
          ...overrides(),
        })
      );
      await expect(outcome).rejects.toThrow(BusinessError);
      await expect(outcome).rejects.toThrow(FIXED_FIELDS_MESSAGE);

      expect(await invoiceRow(id)).toEqual(before);
      expect(await invoiceLines(id)).toEqual(linesBefore);
    });

    it('acepta el número que ya tiene', async () => {
      const { id, input } = await confirmedInvoice();
      const { number } = await invoiceRow(id);
      await expect(
        inTx((tx) => writeSalesInvoiceDataTx(tx, companyId, id, { ...input, number }))
      ).resolves.toBeUndefined();
    });

    describe('referencias de otra empresa (R10)', () => {
      const cases: [string, () => Partial<RawInput>, string][] = [
        ['cliente ajeno', () => ({ customerId: foreignCustomerId }), 'El cliente no existe en la empresa'],
        [
          'ítem ajeno',
          () => ({ lines: [line({ productId: foreignProductId })] }),
          'Alguno de los ítems no existe en la empresa',
        ],
        [
          'centro de costo ajeno',
          () => ({
            lines: [line({ costCenterAllocations: [{ costCenterId: foreignCostCenterId, percentage: 100 }] })],
          }),
          'Alguno de los centros de costo no existe en la empresa',
        ],
      ];

      it.each(cases)('%s → BusinessError y la FV queda igual', async (_name, overrides, message) => {
        const { id } = await confirmedInvoice();
        const before = await invoiceRow(id);
        const linesBefore = await invoiceLines(id);

        const outcome = inTx((tx) =>
          writeSalesInvoiceDataTx(tx, companyId, id, createInvoiceSchema.parse(rawInput(overrides())))
        );
        await expect(outcome).rejects.toThrow(BusinessError);
        await expect(outcome).rejects.toThrow(message);

        expect(await invoiceRow(id)).toEqual(before);
        expect(await invoiceLines(id)).toEqual(linesBefore);
      });

      it('factura de otra empresa → BusinessError', async () => {
        const { id, input } = await draftInvoice();
        await expect(
          inTx((tx) => writeSalesInvoiceDataTx(tx, otherCompanyId, id, input))
        ).rejects.toThrow(new BusinessError('Factura no encontrada'));
      });
    });
  });

  describe('validateSalesInvoiceForConfirmation', () => {
    it('dentro de la tx valida los datos recién escritos', async () => {
      const { id, input } = await draftInvoice();
      // Con los datos guardados la factura se puede confirmar.
      await expect(validateSalesInvoiceForConfirmation(id, companyId)).resolves.toBeUndefined();

      const outcome = await inTx(async (tx) => {
        await writeSalesInvoiceDataTx(tx, companyId, id, {
          ...input,
          lines: [{ ...input.lines[0], productId: badAccountProductId }],
        });
        return validateSalesInvoiceForConfirmation(id, companyId, tx).then(
          () => 'ok',
          (error: unknown) => (error instanceof BusinessError ? 'business' : String(error))
        );
      });
      expect(outcome).toBe('business');
    });

    it('no mira el estado: valida una FV ya confirmada', async () => {
      const { id } = await confirmedInvoice();
      await expect(validateSalesInvoiceForConfirmation(id, companyId)).resolves.toBeUndefined();
    });

    it('rechaza una factura de otra empresa', async () => {
      const { id } = await draftInvoice();
      await expect(validateSalesInvoiceForConfirmation(id, otherCompanyId)).rejects.toThrow(
        BusinessError
      );
    });
  });

  describe('updateInvoice (borrador)', () => {
    it('edita un borrador y rechaza una FV confirmada', async () => {
      const { id } = await draftInvoice();
      await updateInvoice(id, rawInput({ lines: [line({ unitPrice: '2000' })] }));
      expect(Number((await invoiceRow(id)).total)).toBe(2420);

      const confirmed = await confirmedInvoice();
      await expect(updateInvoice(confirmed.id, rawInput())).rejects.toThrow(
        'Factura no encontrada o no está en borrador'
      );
    });

    it('un borrador puede cambiar el tipo y el punto de venta se ignora, como antes (R11)', async () => {
      const { id } = await draftInvoice();
      const before = await invoiceRow(id);

      await updateInvoice(
        id,
        rawInput({ voucherType: 'NOTA_DEBITO_A', pointOfSaleId: otherPointOfSaleId })
      );

      expect(await invoiceRow(id)).toMatchObject({
        status: 'DRAFT',
        voucherType: 'NOTA_DEBITO_A',
        pointOfSaleId: before.pointOfSaleId,
        number: before.number,
        fullNumber: before.fullNumber,
      });
    });

    it('el mismo cambio de tipo en una FV confirmada → mensaje de campos fijos y queda igual', async () => {
      const { id, input } = await confirmedInvoice();
      const before = await invoiceRow(id);

      await expect(
        inTx((tx) =>
          writeSalesInvoiceDataTx(tx, companyId, id, { ...input, voucherType: 'NOTA_DEBITO_A' })
        )
      ).rejects.toThrow(new BusinessError(FIXED_FIELDS_MESSAGE));
      expect(await invoiceRow(id)).toEqual(before);
    });
  });
});
