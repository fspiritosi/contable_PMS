/**
 * Tests de integración del motor de corrección en cadena (TSK-792, Tarea 12), contra
 * la base real: `previewCorrection` y `applyCorrection` sobre FC, FV, OP, RC y MF
 * confirmados con los server actions reales.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createJournalEntryTx,
  postJournalEntryTx,
} from '@/modules/accounting/features/integrations/core';
import { prisma } from '@/shared/lib/prisma';

import type { PurchaseInvoiceFormInput } from '@/modules/commercial/features/purchases/features/invoices/shared/validators';
import type { FundMovementFormInput } from '@/modules/commercial/features/treasury/features/fund-movements/shared/validators';
import type {
  CreatePaymentOrderFormData,
  CreateReceiptFormData,
} from '@/modules/commercial/features/treasury/shared/validators';

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

import {
  confirmPurchaseInvoice,
  createPurchaseInvoice,
} from '@/modules/commercial/features/purchases/features/invoices/list/actions.server';
import { createFundMovement } from '@/modules/commercial/features/treasury/features/fund-movements/list/actions.server';
import {
  confirmPaymentOrder,
  createPartnerRepaymentOrder,
  createPaymentOrder,
} from '@/modules/commercial/features/treasury/features/payment-orders/actions.server';
import {
  confirmReceipt,
  createReceipt,
} from '@/modules/commercial/features/treasury/features/receipts/actions.server';
import type { EffectsCtx } from '../effects/types';
import { applyCorrection, previewCorrection } from './engine.server';
import type { CorrectableKind, CorrectionRequest, PaymentChoices } from './types';

const PREFIX = 'TSK792-ENG-';
const DATE = new Date('2026-03-10');

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type OpPayment = CreatePaymentOrderFormData['payments'][number];
type RcPayment = CreateReceiptFormData['payments'][number];

describe.skipIf(!dbAvailable)('integración: motor de corrección en cadena (TSK-792)', () => {
  let companyId: string;
  let ctx: EffectsCtx;
  let supplierId: string;
  let otherSupplierId: string;
  let customerId: string;
  let pointOfSaleId: string;
  let bankAId: string;
  let bankBId: string;
  let cashId: string;
  let sessionId: string;
  let closingCashId: string;
  let closingSessionId: string;
  let chargeConceptId: string;
  let warehouseId: string;
  let partnerId: string;
  let partnerCardId: string;
  let accounts: { ivaDf: string; ivaCf: string };
  let seq = 1;

  // --- Armado ----------------------------------------------------------------

  const fcInput = (total: number, overrides: Partial<PurchaseInvoiceFormInput> = {}) =>
    ({
      supplierId,
      voucherType: 'FACTURA_A',
      pointOfSale: '0001',
      number: String(seq++).padStart(8, '0'),
      issueDate: DATE,
      lines: [
        {
          description: `${PREFIX}servicio`,
          quantity: '1',
          unitCost: total.toFixed(2),
          vatRate: '0',
        },
      ],
      internalTaxes: '',
      ...overrides,
    }) satisfies PurchaseInvoiceFormInput;

  const withTotal = (input: PurchaseInvoiceFormInput, total: number): PurchaseInvoiceFormInput => ({
    ...input,
    lines: input.lines.map((line) => ({ ...line, unitCost: total.toFixed(2) })),
  });

  async function confirmedFC(total: number, overrides: Partial<PurchaseInvoiceFormInput> = {}) {
    const input = fcInput(total, overrides);
    const { id } = await createPurchaseInvoice(input);
    const result = await confirmPurchaseInvoice(id);
    if (!result.success) throw new Error(`No se pudo confirmar la FC: ${result.error}`);
    return { id, input };
  }

  const transfer = (amount: number, bankAccountId = bankAId): OpPayment => ({
    paymentMethod: 'TRANSFER',
    amount: amount.toFixed(2),
    bankAccountId,
  });
  const cash = (amount: number, cashRegisterId = cashId): OpPayment => ({
    paymentMethod: 'CASH',
    amount: amount.toFixed(2),
    cashRegisterId,
  });

  async function confirmedOP(
    items: { invoiceId: string; amount: number }[],
    payments: OpPayment[]
  ) {
    const created = await createPaymentOrder({
      supplierId,
      date: DATE,
      notes: `${PREFIX}orden`,
      items: items.map((i) => ({ invoiceId: i.invoiceId, amount: i.amount.toFixed(2) })),
      payments,
      withholdings: [],
    });
    const result = await confirmPaymentOrder(created.id);
    if (!result.success) throw new Error(`No se pudo confirmar la OP: ${result.error}`);
    return created.id;
  }

  async function confirmedFV(total: number, extra: { cae?: string } = {}) {
    const number = 9000 + seq++;
    return (
      await prisma.salesInvoice.create({
        data: {
          companyId,
          customerId,
          pointOfSaleId,
          voucherType: 'FACTURA_A',
          number,
          fullNumber: `0099-${String(number).padStart(8, '0')}`,
          issueDate: DATE,
          subtotal: total,
          netTaxed: total,
          total,
          totalBeforeDiscount: total,
          status: 'CONFIRMED',
          cae: extra.cae ?? null,
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;
  }

  const rcCheck = (amount: number, checkNumber: string): RcPayment => ({
    paymentMethod: 'CHECK',
    amount: amount.toFixed(2),
    checkNumber,
    checkBankName: `${PREFIX}Banco Emisor`,
    checkIssueDate: DATE,
    checkDueDate: new Date('2026-04-10'),
    checkDrawerName: 'Cliente Librador',
  });

  async function confirmedRC(invoiceId: string, payments: RcPayment[]) {
    const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const created = await createReceipt({
      customerId,
      date: DATE,
      notes: `${PREFIX}recibo`,
      items: [{ invoiceId, amount: total.toFixed(2) }],
      payments,
      withholdings: [],
    });
    const result = await confirmReceipt(created.id);
    if (!result.success) throw new Error(`No se pudo confirmar el RC: ${result.error}`);
    return created.id;
  }

  const bankCharges = (
    amounts: string[],
    sourceFund = `BANK:${bankAId}`
  ): FundMovementFormInput => ({
    type: 'BANK_CHARGES',
    date: '2026-03-10',
    description: `${PREFIX}Gastos bancarios`,
    sourceFund,
    destinationFund: '',
    partnerId: '',
    lines: amounts.map((amount) => ({ conceptId: chargeConceptId, description: '', amount })),
  });

  async function confirmedMF(input: FundMovementFormInput): Promise<string> {
    const result = await createFundMovement(input, true);
    if (!result.success || !result.id) {
      throw new Error(`No se pudo confirmar el MF: ${result.success ? 'sin id' : result.error}`);
    }
    return result.id;
  }

  // --- Corrección ------------------------------------------------------------

  const ref = (kind: CorrectableKind, id: string) => ({ kind, id });
  const editFC = (
    id: string,
    data: PurchaseInvoiceFormInput,
    choices?: PaymentChoices
  ): CorrectionRequest => ({
    mode: 'EDIT',
    ref: ref('PURCHASE_INVOICE', id),
    data,
    choices,
  });

  /** Vista previa sin impedimentos y aplicación con su huella. */
  async function previewAndApply(request: CorrectionRequest) {
    const proposal = await previewCorrection(ctx, request);
    expect(proposal.impediments).toEqual([]);
    expect(proposal.pendingChoices).toEqual([]);
    expect(proposal.fingerprint).not.toBe('');
    expect(await applyCorrection(ctx, request, proposal.fingerprint)).toEqual({ applied: true });
    return proposal;
  }

  const impedimentsOf = async (request: CorrectionRequest) =>
    (await previewCorrection(ctx, request)).impediments;

  // --- Lecturas --------------------------------------------------------------

  const bankBalance = async (id: string) =>
    Number(
      (await prisma.bankAccount.findUniqueOrThrow({ where: { id }, select: { balance: true } }))
        .balance
    );
  const cashExpected = async (id: string) =>
    Number(
      (
        await prisma.cashRegisterSession.findUniqueOrThrow({
          where: { id },
          select: { expectedBalance: true },
        })
      ).expectedBalance
    );
  const fcRow = (id: string) =>
    prisma.purchaseInvoice.findUniqueOrThrow({
      where: { id },
      select: { status: true, total: true, fullNumber: true, journalEntryId: true },
    });
  const opRow = (id: string) =>
    prisma.paymentOrder.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        totalAmount: true,
        journalEntryId: true,
        updatedAt: true,
        items: { select: { invoiceId: true, amount: true }, orderBy: { amount: 'desc' } },
        payments: {
          select: { id: true, paymentMethod: true, amount: true },
          orderBy: { amount: 'desc' },
        },
      },
    });
  const entryRow = (id: string) =>
    prisma.journalEntry.findUniqueOrThrow({
      where: { id },
      select: {
        number: true,
        status: true,
        date: true,
        reversalEntryId: true,
        lines: { select: { debit: true, credit: true } },
      },
    });
  const entryDebits = (entry: { lines: { debit: { toString(): string } }[] }) =>
    entry.lines.reduce((sum, line) => sum + Number(line.debit), 0);

  /** Foto completa de lo que la corrección puede tocar en la empresa. */
  async function companyState() {
    const where = { companyId };
    const state = await Promise.all([
      prisma.purchaseInvoice.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.salesInvoice.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.paymentOrder.findMany({
        where,
        orderBy: { id: 'asc' },
        include: { items: { orderBy: { id: 'asc' } }, payments: { orderBy: { id: 'asc' } } },
      }),
      prisma.receipt.findMany({
        where,
        orderBy: { id: 'asc' },
        include: { items: { orderBy: { id: 'asc' } }, payments: { orderBy: { id: 'asc' } } },
      }),
      prisma.fundMovement.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.bankAccount.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.bankMovement.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.cashRegisterSession.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.cashMovement.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.check.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.journalEntry.findMany({
        where,
        orderBy: { id: 'asc' },
        include: { lines: { orderBy: { id: 'asc' } } },
      }),
      prisma.accountingSettings.findUniqueOrThrow({ where: { companyId } }),
    ]);
    return JSON.parse(JSON.stringify(state)) as unknown;
  }

  // --- Empresa ---------------------------------------------------------------

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;
    ctx = { companyId, userId: 'test-user' };

    const mk = (
      code: string,
      type: 'ASSET' | 'LIABILITY' | 'EXPENSE' | 'REVENUE',
      nature: 'DEBIT' | 'CREDIT'
    ) =>
      prisma.account.create({
        data: { companyId, code: `T792E-${code}`, name: `${PREFIX}${code}`, type, nature },
        select: { id: true },
      });
    const [compras, pagar, ivaCf, ventas, cobrar, ivaDf, banco, caja, gasto] = await Promise.all([
      mk('COMPRAS', 'EXPENSE', 'DEBIT'),
      mk('PAGAR', 'LIABILITY', 'CREDIT'),
      mk('IVACF', 'ASSET', 'DEBIT'),
      mk('VENTAS', 'REVENUE', 'CREDIT'),
      mk('COBRAR', 'ASSET', 'DEBIT'),
      mk('IVADF', 'LIABILITY', 'CREDIT'),
      mk('BANCO', 'ASSET', 'DEBIT'),
      mk('CAJA', 'ASSET', 'DEBIT'),
      mk('GASTO', 'EXPENSE', 'DEBIT'),
    ]);
    accounts = { ivaDf: ivaDf.id, ivaCf: ivaCf.id };

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        purchasesAccountId: compras.id,
        payablesAccountId: pagar.id,
        vatCreditAccountId: ivaCf.id,
        salesAccountId: ventas.id,
        receivablesAccountId: cobrar.id,
        vatDebitAccountId: ivaDf.id,
        requireCostCenter: false,
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
        select: { id: true },
      });
    supplierId = (await mkSupplier('A', '30500000002')).id;
    otherSupplierId = (await mkSupplier('B', '30500000003')).id;

    customerId = (
      await prisma.contractor.create({
        data: { companyId, name: `${PREFIX}Cliente` },
        select: { id: true },
      })
    ).id;
    pointOfSaleId = (
      await prisma.salesPointOfSale.create({
        data: { companyId, number: 9799, name: `${PREFIX}PDV`, createdBy: 'test' },
        select: { id: true },
      })
    ).id;

    const mkBank = (accountNumber: string) =>
      prisma.bankAccount.create({
        data: {
          companyId,
          bankName: `${PREFIX}Banco ${accountNumber}`,
          accountNumber,
          accountType: 'CHECKING',
          balance: 10_000_000,
          status: 'ACTIVE',
          accountId: banco.id,
        },
        select: { id: true },
      });
    bankAId = (await mkBank('T792E-A')).id;
    bankBId = (await mkBank('T792E-B')).id;

    const mkCash = async (code: string) => {
      const register = await prisma.cashRegister.create({
        data: {
          companyId,
          code,
          name: `${PREFIX}Caja ${code}`,
          accountId: caja.id,
          createdBy: 'test',
        },
        select: { id: true },
      });
      const session = await prisma.cashRegisterSession.create({
        data: {
          companyId,
          cashRegisterId: register.id,
          sessionNumber: 1,
          status: 'OPEN',
          openingBalance: 100_000,
          expectedBalance: 100_000,
          openedBy: 'test',
        },
        select: { id: true },
      });
      return { registerId: register.id, sessionId: session.id };
    };
    ({ registerId: cashId, sessionId } = await mkCash('T792E-C1'));
    ({ registerId: closingCashId, sessionId: closingSessionId } = await mkCash('T792E-C2'));

    chargeConceptId = (
      await prisma.movementConcept.create({
        data: {
          companyId,
          name: `${PREFIX}Comisión`,
          usages: ['FUND_BANK_CHARGES'],
          accountMode: 'OWN_ACCOUNT',
          accountId: gasto.id,
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;

    // La NC de compra exige un depósito principal; los remitos, uno cualquiera.
    warehouseId = (
      await prisma.warehouse.create({
        data: { companyId, code: 'T792E-MAIN', name: `${PREFIX}Depósito`, type: 'MAIN' },
        select: { id: true },
      })
    ).id;
    partnerId = (
      await prisma.partner.create({
        data: { companyId, name: `${PREFIX}Socia`, createdBy: 'test' },
        select: { id: true },
      })
    ).id;
    partnerCardId = (
      await prisma.card.create({
        data: {
          companyId,
          name: `${PREFIX}Débito Socia`,
          cardType: 'DEBIT',
          ownerType: 'PARTNER',
          partnerId,
          createdBy: 'test',
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
      await prisma.projectionDocumentLink.deleteMany({ where: { companyId } });
      await prisma.cashflowProjection.deleteMany({ where: { companyId } });
      await prisma.paymentOrderInstallment.deleteMany({ where: { companyId } });
      await prisma.deliveryNote.deleteMany({ where: { companyId } });
      await prisma.check.deleteMany({ where: { companyId } });
      await prisma.cashMovement.deleteMany({ where: { companyId } });
      await prisma.bankMovement.deleteMany({ where: { companyId } });
      // Ítems, pagos y líneas caen en cascada.
      await prisma.paymentOrder.deleteMany({ where: { companyId } });
      await prisma.receipt.deleteMany({ where: { companyId } });
      await prisma.fundMovement.deleteMany({ where: { companyId } });
      await prisma.card.deleteMany({ where: { companyId } });
      await prisma.partner.deleteMany({ where: { companyId } });
      await prisma.purchaseCreditNoteApplication.deleteMany({ where: { companyId } });
      await prisma.salesCreditNoteApplication.deleteMany({ where: { companyId } });
      await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
      await prisma.salesInvoice.deleteMany({ where: { companyId } });
      await prisma.warehouse.deleteMany({ where: { companyId } });
      await prisma.cashRegisterSession.deleteMany({ where: { companyId } });
      await prisma.cashRegister.deleteMany({ where: { companyId } });
      await prisma.bankAccount.deleteMany({ where: { companyId } });
      await cleanupAccountingCompany(companyId);
      await prisma.movementConcept.deleteMany({ where: { companyId } });
      await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
      await prisma.contractor.deleteMany({ where: { companyId } });
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    await prisma.$disconnect();
  });

  // --- 1 a 5: propagación y acciones ------------------------------------------

  it('FC 1.000.000 → 800.000 pagada por OP de transferencia: OP, banco y asientos bajan; números de asiento iguales', async () => {
    const fc = await confirmedFC(1_000_000);
    const opId = await confirmedOP(
      [{ invoiceId: fc.id, amount: 1_000_000 }],
      [transfer(1_000_000)]
    );
    const bankBefore = await bankBalance(bankAId);
    const fcBefore = await fcRow(fc.id);
    const opBefore = await opRow(opId);
    const fcEntryNumber = (await entryRow(fcBefore.journalEntryId!)).number;
    const opEntryNumber = (await entryRow(opBefore.journalEntryId!)).number;
    const lastNumber = await readLastEntryNumber(companyId);

    const proposal = await previewAndApply(editFC(fc.id, withTotal(fc.input, 800_000)));

    // La propuesta muestra la cadena (§7): FC, su asiento, la OP, su asiento, el banco.
    const actions = Object.fromEntries(proposal.cards.map((c) => [c.key, c.action]));
    expect(actions[`PURCHASE_INVOICE:${fc.id}`]).toBe('MODIFY');
    expect(actions[`ENTRY:${fcEntryNumber}`]).toBe('REWRITE');
    expect(actions[`PAYMENT_ORDER:${opId}`]).toBe('MODIFY');
    expect(actions[`ENTRY:${opEntryNumber}`]).toBe('REWRITE');
    expect(actions[`BANK_ACCOUNT:${bankAId}`]).toBe('MODIFY');
    expect(proposal.cards[0].key).toBe(`PURCHASE_INVOICE:${fc.id}`);

    const fcAfter = await fcRow(fc.id);
    expect(Number(fcAfter.total)).toBe(800_000);
    expect(fcAfter.status).toBe('PAID');
    expect(fcAfter.journalEntryId).toBe(fcBefore.journalEntryId);

    const opAfter = await opRow(opId);
    expect(Number(opAfter.totalAmount)).toBe(800_000);
    expect(opAfter.items.map((i) => Number(i.amount))).toEqual([800_000]);
    expect(opAfter.payments.map((p) => Number(p.amount))).toEqual([800_000]);
    expect(opAfter.journalEntryId).toBe(opBefore.journalEntryId);

    expect(await bankBalance(bankAId)).toBe(bankBefore + 200_000);
    const movements = await prisma.bankMovement.findMany({
      where: { paymentOrderId: opId },
      select: { amount: true, documentLink: true },
    });
    expect(movements.map((m) => [Number(m.amount), m.documentLink])).toEqual([
      [800_000, 'CREATED_BY_DOCUMENT'],
    ]);

    const fcEntry = await entryRow(fcAfter.journalEntryId!);
    const opEntry = await entryRow(opAfter.journalEntryId!);
    expect([fcEntry.number, opEntry.number]).toEqual([fcEntryNumber, opEntryNumber]);
    expect([entryDebits(fcEntry), entryDebits(opEntry)]).toEqual([800_000, 800_000]);
    expect(await readLastEntryNumber(companyId)).toBe(lastNumber);
  });

  it('FC pagada por una OP de varias facturas: solo baja su imputación', async () => {
    const fc1 = await confirmedFC(600);
    const fc2 = await confirmedFC(400);
    const opId = await confirmedOP(
      [
        { invoiceId: fc1.id, amount: 600 },
        { invoiceId: fc2.id, amount: 400 },
      ],
      [transfer(1000)]
    );
    const fc2Before = await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: fc2.id } });

    const proposal = await previewAndApply(editFC(fc1.id, withTotal(fc1.input, 500)));
    expect(proposal.cards.some((c) => c.key === `PURCHASE_INVOICE:${fc2.id}`)).toBe(false);

    const op = await opRow(opId);
    expect(op.items.map((i) => [i.invoiceId, Number(i.amount)])).toEqual([
      [fc1.id, 500],
      [fc2.id, 400],
    ]);
    expect(op.payments.map((p) => Number(p.amount))).toEqual([900]);
    expect(Number(op.totalAmount)).toBe(900);
    expect(await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: fc2.id } })).toEqual(
      fc2Before
    );
    expect((await fcRow(fc1.id)).status).toBe('PAID');
  });

  it('subir el monto no toca la OP y la FC queda PARTIAL_PAID', async () => {
    const fc = await confirmedFC(1000);
    const opId = await confirmedOP([{ invoiceId: fc.id, amount: 1000 }], [transfer(1000)]);
    const opBefore = await opRow(opId);

    const proposal = await previewAndApply(editFC(fc.id, withTotal(fc.input, 1200)));
    expect(proposal.cards.some((c) => c.key === `PAYMENT_ORDER:${opId}`)).toBe(false);

    expect(await opRow(opId)).toEqual(opBefore);
    const fcAfter = await fcRow(fc.id);
    expect([Number(fcAfter.total), fcAfter.status]).toEqual([1200, 'PARTIAL_PAID']);
  });

  it('eliminar FC cuya OP solo la pagaba elimina la OP y devuelve el saldo del banco', async () => {
    const fc = await confirmedFC(3000);
    const bankBefore = await bankBalance(bankAId);
    const opId = await confirmedOP([{ invoiceId: fc.id, amount: 3000 }], [transfer(3000)]);
    const fcEntryId = (await fcRow(fc.id)).journalEntryId!;
    const opEntryId = (await opRow(opId)).journalEntryId!;
    expect(await bankBalance(bankAId)).toBe(bankBefore - 3000);

    const proposal = await previewAndApply({ mode: 'DELETE', ref: ref('PURCHASE_INVOICE', fc.id) });
    const actions = Object.fromEntries(proposal.cards.map((c) => [c.key, c.action]));
    expect(actions[`PURCHASE_INVOICE:${fc.id}`]).toBe('DELETE');
    expect(actions[`PAYMENT_ORDER:${opId}`]).toBe('DELETE');

    expect(await prisma.purchaseInvoice.count({ where: { id: fc.id } })).toBe(0);
    expect(await prisma.paymentOrder.count({ where: { id: opId } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { id: { in: [fcEntryId, opEntryId] } } })).toBe(
      0
    );
    expect(await prisma.bankMovement.count({ where: { paymentOrderId: opId } })).toBe(0);
    expect(await bankBalance(bankAId)).toBe(bankBefore);
  });

  it('anular FC con asiento POSTED genera contraasiento con la fecha de la FC y la deja CANCELLED', async () => {
    const fc = await confirmedFC(700, { issueDate: new Date('2026-03-05') });
    const entryId = (await fcRow(fc.id)).journalEntryId!;
    await prisma.$transaction((tx) =>
      postJournalEntryTx(tx, { companyId, entryId, userId: 'test' })
    );

    const proposal = await previewAndApply({ mode: 'CANCEL', ref: ref('PURCHASE_INVOICE', fc.id) });
    expect(proposal.cards.find((c) => c.key === `PURCHASE_INVOICE:${fc.id}`)?.action).toBe(
      'CANCEL'
    );

    const fcAfter = await fcRow(fc.id);
    expect(fcAfter.status).toBe('CANCELLED');
    expect(fcAfter.journalEntryId).toBe(entryId);
    const original = await entryRow(entryId);
    expect(original.status).toBe('REVERSED');
    const reversal = await entryRow(original.reversalEntryId!);
    expect(reversal.status).toBe('POSTED');
    expect(reversal.date.toISOString().slice(0, 10)).toBe('2026-03-05');
    expect(entryDebits(reversal)).toBe(700);
    expect(proposal.cards.find((c) => c.key === `ENTRY:${reversal.number}`)?.action).toBe(
      'REVERSE'
    );
  });

  // --- 6 a 9: Review Focus ----------------------------------------------------

  it('preview no cambia nada ni consume numeración', async () => {
    const fc = await confirmedFC(5000);
    const opId = await confirmedOP(
      [{ invoiceId: fc.id, amount: 5000 }],
      [transfer(3000), cash(2000)]
    );
    const cashPaymentId = (await opRow(opId)).payments.find((p) => p.paymentMethod === 'CASH')!.id;
    const posted = await confirmedFC(900);
    const postedEntryId = (await fcRow(posted.id)).journalEntryId!;
    await prisma.$transaction((tx) =>
      postJournalEntryTx(tx, { companyId, entryId: postedEntryId, userId: 'test' })
    );

    const stateBefore = await companyState();
    const lastBefore = await readLastEntryNumber(companyId);

    const edited = await previewCorrection(
      ctx,
      editFC(fc.id, withTotal(fc.input, 4000), { [opId]: cashPaymentId })
    );
    expect(edited.cards.length).toBeGreaterThan(0);
    expect(edited.fingerprint).not.toBe('');
    // Anular con asiento registrado crea el contraasiento dentro de la simulación.
    const cancelled = await previewCorrection(ctx, {
      mode: 'CANCEL',
      ref: ref('PURCHASE_INVOICE', posted.id),
    });
    expect(cancelled.cards.some((c) => c.action === 'REVERSE')).toBe(true);
    const deleted = await previewCorrection(ctx, {
      mode: 'DELETE',
      ref: ref('PURCHASE_INVOICE', fc.id),
    });
    expect(deleted.cards.length).toBeGreaterThan(0);

    expect(await companyState()).toEqual(stateBefore);
    expect(await readLastEntryNumber(companyId)).toBe(lastBefore);
  });

  it('apply con huella vieja no aplica y devuelve propuesta nueva', async () => {
    const fc = await confirmedFC(2000);
    const opId = await confirmedOP([{ invoiceId: fc.id, amount: 2000 }], [transfer(2000)]);
    const request = editFC(fc.id, withTotal(fc.input, 1500));
    const seen = await previewCorrection(ctx, request);
    expect(seen.fingerprint).not.toBe('');

    // Otro usuario cambia la fecha de la OP entre la vista previa y el Confirmar.
    await prisma.paymentOrder.update({
      where: { id: opId },
      data: { date: new Date('2026-03-12') },
    });

    const result = await applyCorrection(ctx, request, seen.fingerprint);
    expect(result.applied).toBe(false);
    if (result.applied) return;
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('STALE');
    expect(result.proposal.fingerprint).not.toBe('');
    expect(result.proposal.fingerprint).not.toBe(seen.fingerprint);
    expect(Number((await fcRow(fc.id)).total)).toBe(2000);
    expect(Number((await opRow(opId)).totalAmount)).toBe(2000);

    // Con la huella nueva sí se aplica.
    expect(await applyCorrection(ctx, request, result.proposal.fingerprint)).toEqual({
      applied: true,
    });
    expect(Number((await opRow(opId)).totalAmount)).toBe(1500);
  });

  it('cambiar solo el número no toca la OP y conserva el número de asiento', async () => {
    const fc = await confirmedFC(1100);
    const opId = await confirmedOP([{ invoiceId: fc.id, amount: 1100 }], [transfer(1100)]);
    const opBefore = await opRow(opId);
    const fcBefore = await fcRow(fc.id);
    const entryNumber = (await entryRow(fcBefore.journalEntryId!)).number;

    const proposal = await previewAndApply(editFC(fc.id, { ...fc.input, number: '00099999' }));
    expect(proposal.cards.map((c) => c.key)).toEqual(
      expect.not.arrayContaining([`PAYMENT_ORDER:${opId}`, `BANK_ACCOUNT:${bankAId}`])
    );
    const fcCard = proposal.cards.find((c) => c.key === `PURCHASE_INVOICE:${fc.id}`);
    expect(fcCard?.rows).toEqual([
      { label: 'Comprobante', before: `FC A ${fcBefore.fullNumber}`, after: 'FC A 0001-00099999' },
    ]);

    expect(await opRow(opId)).toEqual(opBefore);
    const fcAfter = await fcRow(fc.id);
    expect(fcAfter.fullNumber).toBe('0001-00099999');
    expect(fcAfter.journalEntryId).toBe(fcBefore.journalEntryId);
    expect((await entryRow(fcAfter.journalEntryId!)).number).toBe(entryNumber);
  });

  it('caja cerrada bloquea y no aplica nada', async () => {
    const fc = await confirmedFC(800);
    await confirmedOP([{ invoiceId: fc.id, amount: 800 }], [cash(800, closingCashId)]);
    await prisma.cashRegisterSession.update({
      where: { id: closingSessionId },
      data: { status: 'CLOSED', closedAt: new Date(), closedBy: 'test' },
    });
    const stateBefore = await companyState();

    const request = editFC(fc.id, withTotal(fc.input, 600));
    const proposal = await previewCorrection(ctx, request);
    expect(proposal.impediments.map((i) => [i.code, i.severity])).toEqual([
      ['CASH_SESSION_CLOSED', 'BLOCKED'],
    ]);
    expect(proposal.cards).toEqual([]);
    expect(proposal.fingerprint).toBe('');

    const result = await applyCorrection(ctx, request, proposal.fingerprint);
    expect(result).toMatchObject({ applied: false, stale: true, reason: 'IMPEDIMENTS' });
    expect(await companyState()).toEqual(stateBefore);
  });

  // --- 10 a 17 --------------------------------------------------------------

  it('OP con dos medios pide elección; con choice aplica sobre ese medio', async () => {
    const fc = await confirmedFC(1000);
    const opId = await confirmedOP(
      [{ invoiceId: fc.id, amount: 1000 }],
      [transfer(600), cash(400)]
    );
    const cashPaymentId = (await opRow(opId)).payments.find((p) => p.paymentMethod === 'CASH')!.id;
    const cashBefore = await cashExpected(sessionId);

    const pending = await previewCorrection(ctx, editFC(fc.id, withTotal(fc.input, 800)));
    expect(pending.impediments).toEqual([]);
    expect(pending.fingerprint).toBe('');
    expect(pending.pendingChoices).toHaveLength(1);
    expect(pending.pendingChoices[0].documentId).toBe(opId);
    expect(pending.pendingChoices[0].options.map((o) => o.paymentId)).toContain(cashPaymentId);
    expect(pending.cards.length).toBeGreaterThan(0);
    expect(await applyCorrection(ctx, editFC(fc.id, withTotal(fc.input, 800)), '')).toMatchObject({
      applied: false,
      reason: 'PENDING_CHOICES',
    });

    await previewAndApply(editFC(fc.id, withTotal(fc.input, 800), { [opId]: cashPaymentId }));
    const op = await opRow(opId);
    expect(op.payments.map((p) => [p.paymentMethod, Number(p.amount)])).toEqual([
      ['TRANSFER', 600],
      ['CASH', 200],
    ]);
    expect(await cashExpected(sessionId)).toBe(cashBefore + 200);
  });

  it('asiento de la OP registrado → ENTRY_POSTED MANUAL con href a Asientos', async () => {
    const fc = await confirmedFC(1300);
    const opId = await confirmedOP([{ invoiceId: fc.id, amount: 1300 }], [transfer(1300)]);
    const entryId = (await opRow(opId)).journalEntryId!;
    await prisma.$transaction((tx) =>
      postJournalEntryTx(tx, { companyId, entryId, userId: 'test' })
    );

    const found = await impedimentsOf(editFC(fc.id, withTotal(fc.input, 1000)));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: 'ENTRY_POSTED',
      severity: 'MANUAL',
      href: '/dashboard/company/accounting/entries',
    });
  });

  it('liquidación de IVA del mes → MONTHLY_PROCESS', async () => {
    // Otro mes: la liquidación registrada bloquearía los demás tests de marzo.
    const fc = await confirmedFC(450, { issueDate: new Date('2026-05-10') });
    await prisma.$transaction((tx) =>
      createJournalEntryTx(tx, {
        companyId,
        date: new Date('2026-05-31'),
        description: `${PREFIX}Liquidación de IVA 05/2026`,
        lines: [
          { accountId: accounts.ivaDf, debit: 100, credit: 0 },
          { accountId: accounts.ivaCf, debit: 0, credit: 100 },
        ],
        status: 'POSTED',
        createdBy: 'test',
        process: 'VAT_SETTLEMENT',
      })
    );

    const found = await impedimentsOf(editFC(fc.id, withTotal(fc.input, 400)));
    expect(found.map((i) => [i.code, i.severity])).toEqual([['MONTHLY_PROCESS', 'MANUAL']]);
    // Un MF del mes no es una factura: la liquidación de IVA no lo afecta.
    const mfId = await confirmedMF({ ...bankCharges(['10.00']), date: '2026-05-12' });
    expect(await impedimentsOf({ mode: 'DELETE', ref: ref('FUND_MOVEMENT', mfId) })).toEqual([]);
  });

  it('FV con CAE → AFIP_CAE', async () => {
    const fvId = await confirmedFV(1000, { cae: '12345678901234' });
    const found = await impedimentsOf({ mode: 'DELETE', ref: ref('SALES_INVOICE', fvId) });
    expect(found.map((i) => [i.code, i.severity])).toEqual([['AFIP_CAE', 'BLOCKED']]);
  });

  it('cambiar proveedor con OP vinculada → PARTY_CHANGED_WITH_PAYMENTS', async () => {
    const fc = await confirmedFC(950);
    await confirmedOP([{ invoiceId: fc.id, amount: 950 }], [transfer(950)]);
    const found = await impedimentsOf(editFC(fc.id, { ...fc.input, supplierId: otherSupplierId }));
    expect(found.map((i) => [i.code, i.severity])).toEqual([
      ['PARTY_CHANGED_WITH_PAYMENTS', 'MANUAL'],
    ]);
  });

  it('eliminar RC con cheque en cartera borra el cheque; con cheque endosado → impedimento', async () => {
    const fvId = await confirmedFV(600);
    const cashBefore = await cashExpected(sessionId);
    const rcId = await confirmedRC(fvId, [
      { paymentMethod: 'CASH', amount: '100.00', cashRegisterId: cashId },
      rcCheck(500, 'T792E-CH-1'),
    ]);
    expect(await prisma.check.count({ where: { companyId, checkNumber: 'T792E-CH-1' } })).toBe(1);

    const proposal = await previewAndApply({ mode: 'DELETE', ref: ref('RECEIPT', rcId) });
    expect(
      proposal.cards.find((c) => c.key === `CHECK:${PREFIX}Banco Emisor:T792E-CH-1`)?.action
    ).toBe('DELETE');
    // La factura que cobraba se recalcula aunque el RC desaparezca de la foto.
    expect(proposal.cards.find((c) => c.key === `SALES_INVOICE:${fvId}`)?.action).toBe(
      'RECALCULATE'
    );
    expect(await prisma.receipt.count({ where: { id: rcId } })).toBe(0);
    expect(await prisma.check.count({ where: { companyId, checkNumber: 'T792E-CH-1' } })).toBe(0);
    expect(await cashExpected(sessionId)).toBe(cashBefore);
    expect(
      (
        await prisma.salesInvoice.findUniqueOrThrow({
          where: { id: fvId },
          select: { status: true },
        })
      ).status
    ).toBe('CONFIRMED');

    // Cheque del RC endosado en una OP confirmada.
    const fv2Id = await confirmedFV(600);
    const rc2Id = await confirmedRC(fv2Id, [
      { paymentMethod: 'CASH', amount: '100.00', cashRegisterId: cashId },
      rcCheck(500, 'T792E-CH-2'),
    ]);
    const checkId = (
      await prisma.check.findFirstOrThrow({ where: { companyId, checkNumber: 'T792E-CH-2' } })
    ).id;
    const fc = await confirmedFC(600);
    await confirmedOP(
      [{ invoiceId: fc.id, amount: 600 }],
      [
        cash(100),
        {
          paymentMethod: 'CHECK',
          amount: '500.00',
          checkOwnership: 'THIRD_PARTY',
          endorsedCheckId: checkId,
        },
      ]
    );
    const found = await impedimentsOf({ mode: 'DELETE', ref: ref('RECEIPT', rc2Id) });
    expect(found.map((i) => [i.code, i.severity])).toEqual([
      ['CHECK_ENDORSED_IN_OTHER_OP', 'MANUAL'],
    ]);
  });

  it('editar MF de gastos bancarios cambia el banco y reescribe el asiento', async () => {
    const bankABefore = await bankBalance(bankAId);
    const bankBBefore = await bankBalance(bankBId);
    const mfId = await confirmedMF(bankCharges(['120.50', '25.30']));
    const before = await prisma.fundMovement.findUniqueOrThrow({ where: { id: mfId } });
    const entryNumber = (await entryRow(before.journalEntryId!)).number;
    expect(await bankBalance(bankAId)).toBe(bankABefore - 145.8);

    const proposal = await previewAndApply({
      mode: 'EDIT',
      ref: ref('FUND_MOVEMENT', mfId),
      data: bankCharges(['200.00'], `BANK:${bankBId}`),
    });
    expect(proposal.cards.find((c) => c.key === `ENTRY:${entryNumber}`)?.action).toBe('REWRITE');
    const movementCard = proposal.cards.find((c) => c.key === `BANK:FUND_MOVEMENT:${mfId}:1`);
    expect(movementCard?.rows.map((r) => r.label)).toEqual(['Cuenta', 'Importe']);

    expect(await bankBalance(bankAId)).toBe(bankABefore);
    expect(await bankBalance(bankBId)).toBe(bankBBefore - 200);
    const after = await prisma.fundMovement.findUniqueOrThrow({ where: { id: mfId } });
    expect(after.journalEntryId).toBe(before.journalEntryId);
    expect(after.journalEntryNumber).toBe(entryNumber);
    expect(Number(after.amount)).toBe(200);
    const entry = await entryRow(after.journalEntryId!);
    expect([entry.number, entry.status, entryDebits(entry)]).toEqual([entryNumber, 'DRAFT', 200]);
  });

  it('anular OP confirmada la deja CANCELLED y la factura vuelve a CONFIRMED', async () => {
    const fc = await confirmedFC(1700);
    const bankBefore = await bankBalance(bankAId);
    const opId = await confirmedOP([{ invoiceId: fc.id, amount: 1700 }], [transfer(1700)]);
    const entryId = (await opRow(opId)).journalEntryId!;
    expect((await fcRow(fc.id)).status).toBe('PAID');

    const proposal = await previewAndApply({ mode: 'CANCEL', ref: ref('PAYMENT_ORDER', opId) });
    const actions = Object.fromEntries(proposal.cards.map((c) => [c.key, c.action]));
    expect(actions[`PAYMENT_ORDER:${opId}`]).toBe('CANCEL');
    expect(actions[`PURCHASE_INVOICE:${fc.id}`]).toBe('RECALCULATE');

    const op = await opRow(opId);
    expect([op.status, op.journalEntryId]).toEqual(['CANCELLED', null]);
    expect(await prisma.journalEntry.count({ where: { id: entryId } })).toBe(0);
    expect((await fcRow(fc.id)).status).toBe('CONFIRMED');
    expect(await bankBalance(bankAId)).toBe(bankBefore);
  });

  it('FC con NC aplicada: al bajar el monto se reduce la aplicación de la NC', async () => {
    // Proveedor propio: la NC compensa FIFO contra todo lo pendiente del proveedor. Sin
    // factura original: las NC históricas compensadas solo por `originalInvoiceId` (sin
    // aplicación explícita) no entran en la cadena, y reaplicar una NC así puede crear
    // la aplicación explícita que le faltaba (no duplica el efecto).
    const ownSupplierId = (
      await prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}NC`,
          businessName: `${PREFIX}Proveedor NC`,
          taxId: '30500000004',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;
    const fc = await confirmedFC(1000, { supplierId: ownSupplierId });
    const nc = await confirmedFC(300, { supplierId: ownSupplierId, voucherType: 'NOTA_CREDITO_A' });
    const application = await prisma.purchaseCreditNoteApplication.findFirstOrThrow({
      where: { creditNoteId: nc.id, invoiceId: fc.id },
    });
    expect(Number(application.amount)).toBe(300);
    expect([(await fcRow(fc.id)).status, (await fcRow(nc.id)).status]).toEqual([
      'PARTIAL_PAID',
      'PAID',
    ]);

    const proposal = await previewAndApply(editFC(fc.id, withTotal(fc.input, 200)));
    const ncCard = proposal.cards.find((c) => c.key === `PURCHASE_INVOICE:${nc.id}`);
    expect(ncCard?.action).toBe('MODIFY');
    expect(ncCard?.rows.map((r) => r.label)).toEqual([
      `Aplicación FC A ${(await fcRow(fc.id)).fullNumber}`,
      'Estado',
    ]);

    const after = await prisma.purchaseCreditNoteApplication.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(Number(after.amount)).toBe(200);
    expect([(await fcRow(fc.id)).status, (await fcRow(nc.id)).status]).toEqual([
      'PAID',
      'PARTIAL_PAID',
    ]);
  });

  // --- Ronda de revisión 1: visibilidad, NC de origen, motivos y concurrencia ----

  it('anular OP de devolución a socio: las cuotas vuelven a pendientes y se ven en la propuesta', async () => {
    const fc = await confirmedFC(1000);
    const originId = await confirmedOP(
      [{ invoiceId: fc.id, amount: 1000 }],
      [
        {
          paymentMethod: 'DEBIT_CARD',
          amount: '400.00',
          cardId: partnerCardId,
          bankAccountId: bankAId,
        },
        cash(600),
      ]
    );
    const installment = await prisma.paymentOrderInstallment.findFirstOrThrow({
      where: { paymentOrderId: originId },
      select: { id: true },
    });
    const repayment = await createPartnerRepaymentOrder({
      partnerId,
      date: DATE,
      notes: `${PREFIX}devolución`,
      installmentIds: [installment.id],
      payments: [cash(400)],
    });
    expect((await confirmPaymentOrder(repayment.id)).success).toBe(true);
    const { fullNumber } = await prisma.paymentOrder.findUniqueOrThrow({
      where: { id: repayment.id },
      select: { fullNumber: true },
    });

    const proposal = await previewAndApply({
      mode: 'CANCEL',
      ref: ref('PAYMENT_ORDER', repayment.id),
    });
    const card = proposal.cards.find((c) => c.key === `PARTNER_INSTALLMENT:${installment.id}`);
    expect(card?.action).toBe('UNLINK');
    expect(card?.rows).toEqual(
      expect.arrayContaining([
        { label: 'Vinculado a', before: fullNumber, after: '—' },
        { label: 'Estado', before: 'Pagada', after: 'Pendiente' },
      ])
    );
    expect(
      await prisma.paymentOrderInstallment.findUniqueOrThrow({
        where: { id: installment.id },
        select: { status: true, settledByPaymentOrderId: true },
      })
    ).toEqual({ status: 'PENDING', settledByPaymentOrderId: null });
  });

  it('eliminar FV con remito y proyección: el remito vuelve a pendiente de facturar y la proyección se desvincula, con tarjetas', async () => {
    const fvId = await confirmedFV(600);
    const number = 9500 + seq++;
    const note = await prisma.deliveryNote.create({
      data: {
        companyId,
        customerId,
        warehouseId,
        number,
        fullNumber: `RE-${number}`,
        deliveryDate: DATE,
        status: 'INVOICED',
        salesInvoiceId: fvId,
        createdBy: 'test',
      },
      select: { id: true },
    });
    const projection = await prisma.cashflowProjection.create({
      data: {
        companyId,
        type: 'INCOME',
        category: 'SALES',
        description: `${PREFIX}Cobro esperado`,
        amount: 600,
        date: DATE,
        status: 'CONFIRMED',
        confirmedAmount: 600,
        createdBy: 'test',
      },
      select: { id: true },
    });
    await prisma.projectionDocumentLink.create({
      data: {
        companyId,
        projectionId: projection.id,
        amount: 600,
        salesInvoiceId: fvId,
        createdBy: 'test',
      },
    });

    const proposal = await previewAndApply({ mode: 'DELETE', ref: ref('SALES_INVOICE', fvId) });
    const noteCard = proposal.cards.find((c) => c.key === `DELIVERY_NOTE:${note.id}`);
    expect(noteCard?.action).toBe('UNLINK');
    expect(noteCard?.rows).toEqual(
      expect.arrayContaining([
        { label: 'Estado', before: 'Facturado', after: 'Pendiente de facturar' },
        expect.objectContaining({ label: 'Vinculado a', after: '—' }),
      ])
    );
    const projectionCard = proposal.cards.find((c) => c.key === `PROJECTION:${projection.id}`);
    expect(projectionCard?.action).toBe('UNLINK');
    expect(projectionCard?.rows.map((r) => r.label)).toEqual([
      'Confirmado',
      'Vinculado a',
      'Estado',
    ]);

    expect(
      await prisma.deliveryNote.findUniqueOrThrow({
        where: { id: note.id },
        select: { status: true, salesInvoiceId: true },
      })
    ).toEqual({ status: 'ACCEPTED', salesInvoiceId: null });
    const after = await prisma.cashflowProjection.findUniqueOrThrow({
      where: { id: projection.id },
      select: { status: true, confirmedAmount: true },
    });
    expect([after.status, Number(after.confirmedAmount)]).toEqual(['PENDING', 0]);
    expect(await prisma.salesInvoice.count({ where: { id: fvId } })).toBe(0);
  });

  it('NC de compra como origen: al bajarla se reaplica contra la factura que compensaba', async () => {
    const ownSupplierId = (
      await prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}NC2`,
          businessName: `${PREFIX}Proveedor NC2`,
          taxId: '30500000005',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;
    const fc = await confirmedFC(300, { supplierId: ownSupplierId });
    const nc = await confirmedFC(300, { supplierId: ownSupplierId, voucherType: 'NOTA_CREDITO_A' });
    expect([(await fcRow(fc.id)).status, (await fcRow(nc.id)).status]).toEqual(['PAID', 'PAID']);
    const fcNumber = (await fcRow(fc.id)).fullNumber;

    const proposal = await previewAndApply(editFC(nc.id, withTotal(nc.input, 200)));
    const ncCard = proposal.cards.find((c) => c.key === `PURCHASE_INVOICE:${nc.id}`);
    expect(ncCard?.rows).toEqual(
      expect.arrayContaining([
        {
          label: `Aplicación FC A ${fcNumber}`,
          before: expect.stringContaining('300,00'),
          after: expect.stringContaining('200,00'),
        },
      ])
    );
    const fcCard = proposal.cards.find((c) => c.key === `PURCHASE_INVOICE:${fc.id}`);
    expect(fcCard).toMatchObject({
      action: 'RECALCULATE',
      rows: [{ label: 'Estado', before: 'Pagada', after: 'Parcialmente pagada' }],
    });

    const applications = await prisma.purchaseCreditNoteApplication.findMany({
      where: { creditNoteId: nc.id },
      select: { invoiceId: true, amount: true },
    });
    expect(applications.map((a) => [a.invoiceId, Number(a.amount)])).toEqual([[fc.id, 200]]);
    expect([(await fcRow(fc.id)).status, (await fcRow(nc.id)).status]).toEqual([
      'PARTIAL_PAID',
      'PAID',
    ]);
  });

  it('eliminar factura referenciada por una NC anulada → REFERENCED_BY_NOTE BLOCKED', async () => {
    const fc = await confirmedFC(500);
    const number = String(seq++).padStart(8, '0');
    await prisma.purchaseInvoice.create({
      data: {
        companyId,
        supplierId,
        voucherType: 'NOTA_CREDITO_A',
        pointOfSale: '0002',
        number,
        fullNumber: `0002-${number}`,
        issueDate: DATE,
        total: 100,
        status: 'CANCELLED',
        originalInvoiceId: fc.id,
        createdBy: 'test',
      },
    });
    const found = await impedimentsOf({ mode: 'DELETE', ref: ref('PURCHASE_INVOICE', fc.id) });
    expect(found.map((i) => [i.code, i.severity])).toEqual([['REFERENCED_BY_NOTE', 'BLOCKED']]);
    // Anularla sí se puede.
    expect(await impedimentsOf({ mode: 'CANCEL', ref: ref('PURCHASE_INVOICE', fc.id) })).toEqual(
      []
    );
  });

  it('un error de la simulación no aplica nada y lo informa como SIMULATION_ERROR', async () => {
    const first = await confirmedFC(100);
    const second = await confirmedFC(100);
    // Número repetido del mismo proveedor: la escritura lo rechaza.
    const request = editFC(second.id, { ...second.input, number: first.input.number });
    const proposal = await previewCorrection(ctx, request);
    expect(proposal.impediments.map((i) => i.code)).toEqual(['SIMULATION_ERROR']);
    expect(await applyCorrection(ctx, request, '')).toMatchObject({
      applied: false,
      stale: true,
      reason: 'SIMULATION_ERROR',
    });
  });

  it('dos aplicaciones simultáneas del mismo origen: los efectos se aplican una sola vez', async () => {
    const fc = await confirmedFC(2500);
    const opId = await confirmedOP([{ invoiceId: fc.id, amount: 2500 }], [transfer(2500)]);
    const bankBefore = await bankBalance(bankAId);
    const request = editFC(fc.id, withTotal(fc.input, 2000));
    const { fingerprint } = await previewCorrection(ctx, request);

    const results = await Promise.all([
      applyCorrection(ctx, request, fingerprint),
      applyCorrection(ctx, request, fingerprint),
    ]);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.find((r) => !r.applied)).toMatchObject({ reason: 'STALE' });

    expect(await bankBalance(bankAId)).toBe(bankBefore + 500);
    const op = await opRow(opId);
    expect(Number(op.totalAmount)).toBe(2000);
    expect(op.payments.map((p) => Number(p.amount))).toEqual([2000]);
    const movements = await prisma.bankMovement.findMany({
      where: { paymentOrderId: opId },
      select: { amount: true },
    });
    expect(movements.map((m) => Number(m.amount))).toEqual([2000]);

    // Anular dos veces a la vez: la segunda espera el bloqueo del origen y lo ve anulado.
    const bankBeforeCancel = await bankBalance(bankAId);
    const cancel: CorrectionRequest = { mode: 'CANCEL', ref: ref('PAYMENT_ORDER', opId) };
    const cancelPreview = await previewCorrection(ctx, cancel);
    const cancels = await Promise.all([
      applyCorrection(ctx, cancel, cancelPreview.fingerprint),
      applyCorrection(ctx, cancel, cancelPreview.fingerprint),
    ]);
    expect(cancels.filter((r) => r.applied)).toHaveLength(1);
    const rejected = cancels.find((r) => !r.applied);
    expect(rejected).toMatchObject({ reason: 'IMPEDIMENTS' });
    if (rejected && !rejected.applied) {
      expect(rejected.proposal.impediments.map((i) => i.code)).toEqual(['INVALID_STATE']);
    }
    expect(await bankBalance(bankAId)).toBe(bankBeforeCancel + 2000);
    expect((await opRow(opId)).status).toBe('CANCELLED');
  });
});
