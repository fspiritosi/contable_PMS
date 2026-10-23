/**
 * Tests de integración de los efectos del recibo de cobro (TSK-792, Tarea 8),
 * contra la base real: `applyReceiptEffectsTx` (vía `confirmReceipt` y directo,
 * con `rewriteEntryId`), su inversa `revertReceiptEffectsTx`, los impedimentos
 * propios de los efectos (`receiptEffectImpedimentsTx`) y la edición de un
 * borrador (`updateReceipt`).
 *
 * Los borradores se crean con el server action real (`createReceipt`) y se
 * confirman con `confirmReceipt`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/modules/accounting/features/integrations/core';
import { prisma } from '@/shared/lib/prisma';

import type { CreateReceiptFormData } from '@/modules/commercial/features/treasury/shared/validators';

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

import { unlinkBankMovementFromDocument } from '@/modules/commercial/features/treasury/features/bank-movements/actions.server';
import {
  confirmReceipt,
  createReceipt,
  updateReceipt,
} from '@/modules/commercial/features/treasury/features/receipts/actions.server';
import {
  applyReceiptEffectsTx,
  receiptEffectImpedimentsTx,
  revertReceiptEffectsTx,
} from './receipt.server';
import type { EffectsCtx } from './types';

const PREFIX = 'TSK792-RCFX-';
const RECEIPT_DATE = new Date('2026-03-10');
const DOC_LABEL = 'el RC de prueba';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type PaymentInput = CreateReceiptFormData['payments'][number];

const inTx = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction((tx) => fn(tx));

describe.skipIf(!dbAvailable)('integración: efectos del recibo de cobro (TSK-792)', () => {
  let companyId: string;
  let ctx: EffectsCtx;
  let customerId: string;
  let supplierId: string;
  let pointOfSaleId: string;
  let cajaRegisterId: string;
  let sessionId: string;
  let bankAccountId: string;
  let seq = 1;

  const cash = (amount: string): PaymentInput => ({
    paymentMethod: 'CASH',
    amount,
    cashRegisterId: cajaRegisterId,
  });
  const transfer = (amount: string): PaymentInput => ({
    paymentMethod: 'TRANSFER',
    amount,
    bankAccountId,
  });
  const check = (amount: string, checkNumber: string): PaymentInput => ({
    paymentMethod: 'CHECK',
    amount,
    checkNumber,
    checkBankName: 'Banco Emisor',
    checkIssueDate: RECEIPT_DATE,
    checkDueDate: new Date('2026-04-10'),
    checkDrawerName: 'Cliente Librador',
  });
  const echeq = (amount: string, checkNumber: string): PaymentInput => ({
    ...check(amount, checkNumber),
    paymentMethod: 'ECHEQ',
    bankAccountId,
  });

  async function confirmedInvoice(total: number): Promise<string> {
    const number = seq++;
    const invoice = await prisma.salesInvoice.create({
      data: {
        companyId,
        customerId,
        pointOfSaleId,
        voucherType: 'FACTURA_A',
        number,
        fullNumber: `9792-${String(number).padStart(8, '0')}`,
        issueDate: new Date('2026-03-01'),
        subtotal: total,
        netTaxed: total,
        vatAmount: 0,
        total,
        totalBeforeDiscount: total,
        discountTotal: 0,
        status: 'CONFIRMED',
        createdBy: 'test',
      },
      select: { id: true },
    });
    return invoice.id;
  }

  /** RC en borrador por el `createReceipt` real, cobrando una factura por el total de los pagos. */
  async function draftReceipt(payments: PaymentInput[]) {
    const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const invoiceId = await confirmedInvoice(total);
    const created = await createReceipt({
      customerId,
      date: RECEIPT_DATE,
      notes: `${PREFIX}recibo`,
      items: [{ invoiceId, amount: String(total) }],
      payments,
      withholdings: [],
    });
    return { id: created.id, invoiceId };
  }

  /** RC confirmado por el `confirmReceipt` real. */
  async function confirmedReceipt(payments: PaymentInput[]) {
    const draft = await draftReceipt(payments);
    const result = await confirmReceipt(draft.id);
    if (!result.success) throw new Error(`No se pudo confirmar el RC: ${result.error}`);
    return draft;
  }

  const bankBalance = async () =>
    Number(
      (
        await prisma.bankAccount.findUniqueOrThrow({
          where: { id: bankAccountId },
          select: { balance: true },
        })
      ).balance
    );
  const expectedBalance = async () =>
    Number(
      (
        await prisma.cashRegisterSession.findUniqueOrThrow({
          where: { id: sessionId },
          select: { expectedBalance: true },
        })
      ).expectedBalance
    );
  const invoiceStatus = async (id: string) =>
    (await prisma.salesInvoice.findUniqueOrThrow({ where: { id }, select: { status: true } }))
      .status;
  const impedimentCodes = (id: string) =>
    inTx((tx) => receiptEffectImpedimentsTx(tx, id, DOC_LABEL)).then((list) =>
      list.map((i) => i.code)
    );
  const checksOf = (receiptId: string) =>
    prisma.check.findMany({
      where: { companyId, receiptPayment: { receiptId } },
      select: { id: true, checkNumber: true, status: true },
    });

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;
    ctx = { companyId, userId: 'test-user' };

    const mk = (code: string, name: string) =>
      prisma.account.create({
        data: { companyId, code, name: `${PREFIX}${name}`, type: 'ASSET', nature: 'DEBIT' },
      });
    const [cobrar, caja, banco] = await Promise.all([
      mk('T792R-COBRAR', 'Cuentas por Cobrar'),
      mk('T792R-CAJA', 'Caja'),
      mk('T792R-BANCO', 'Banco'),
    ]);

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        receivablesAccountId: cobrar.id,
        requireCostCenter: false,
      },
    });

    customerId = (
      await prisma.contractor.create({
        data: { companyId, name: `${PREFIX}Cliente` },
        select: { id: true },
      })
    ).id;
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
        select: { id: true },
      })
    ).id;
    pointOfSaleId = (
      await prisma.salesPointOfSale.create({
        data: { companyId, number: 9792, name: `${PREFIX}PDV`, createdBy: 'test' },
        select: { id: true },
      })
    ).id;

    cajaRegisterId = (
      await prisma.cashRegister.create({
        data: {
          companyId,
          code: 'T792R-CAJA1',
          name: `${PREFIX}Caja`,
          accountId: caja.id,
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;
    sessionId = (
      await prisma.cashRegisterSession.create({
        data: {
          companyId,
          cashRegisterId: cajaRegisterId,
          sessionNumber: 1,
          status: 'OPEN',
          openedBy: 'test',
        },
        select: { id: true },
      })
    ).id;

    bankAccountId = (
      await prisma.bankAccount.create({
        data: {
          companyId,
          bankName: `${PREFIX}Banco`,
          accountNumber: 'T792R-0001',
          accountType: 'CHECKING',
          balance: 100000,
          status: 'ACTIVE',
          accountId: banco.id,
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
      await prisma.check.deleteMany({ where: { companyId } });
      await prisma.cashMovement.deleteMany({ where: { companyId } });
      await prisma.cashRegisterSession.deleteMany({ where: { companyId } });
      await prisma.cashRegister.deleteMany({ where: { companyId } });
      await prisma.bankMovement.deleteMany({ where: { companyId } });
      await prisma.bankAccount.deleteMany({ where: { companyId } });
      // items/payments/withholdings caen en cascada con el recibo y la OP.
      await prisma.receipt.deleteMany({ where: { companyId } });
      await prisma.paymentOrder.deleteMany({ where: { companyId } });
      await cleanupAccountingCompany(companyId);
      await prisma.salesInvoice.deleteMany({ where: { companyId } });
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

  it('revert(apply) restaura banco, caja y cheques', async () => {
    const bankBefore = await bankBalance();
    const cashBefore = await expectedBalance();

    const { id } = await confirmedReceipt([
      transfer('300'),
      cash('200'),
      check('400', 'T792R-CH-1'),
      echeq('100', 'T792R-ECH-1'),
    ]);

    // apply movió todo (el e-cheq no acredita el banco hasta cobrarse)
    expect(await bankBalance()).toBe(bankBefore + 300);
    expect(await expectedBalance()).toBe(cashBefore + 200);
    expect((await checksOf(id)).map((c) => c.status)).toEqual(['PORTFOLIO', 'PORTFOLIO']);
    const receiptBefore = await prisma.receipt.findUniqueOrThrow({
      where: { id },
      select: { status: true, journalEntryId: true, fullNumber: true },
    });

    await inTx((tx) => revertReceiptEffectsTx(tx, ctx, id));

    expect(await bankBalance()).toBe(bankBefore);
    expect(await expectedBalance()).toBe(cashBefore);
    expect(await prisma.bankMovement.count({ where: { receiptId: id } })).toBe(0);
    expect(await prisma.cashMovement.count({ where: { receiptId: id } })).toBe(0);
    expect(
      await prisma.check.count({
        where: { companyId, checkNumber: { in: ['T792R-CH-1', 'T792R-ECH-1'] } },
      })
    ).toBe(0);

    // No toca el estado del RC ni su asiento (lo decide el motor).
    expect(
      await prisma.receipt.findUniqueOrThrow({
        where: { id },
        select: { status: true, journalEntryId: true, fullNumber: true },
      })
    ).toEqual(receiptBefore);
  });

  it('revert recalcula la factura a CONFIRMED', async () => {
    const { id, invoiceId } = await confirmedReceipt([cash('1000')]);
    expect(await invoiceStatus(invoiceId)).toBe('PAID');

    // Como hará el motor al eliminar o anular: el RC deja de contar en la misma
    // transacción en la que se revierten sus efectos.
    await inTx(async (tx) => {
      await tx.receipt.update({ where: { id }, data: { status: 'DRAFT' } });
      await revertReceiptEffectsTx(tx, ctx, id);
    });

    expect(await invoiceStatus(invoiceId)).toBe('CONFIRMED');
  });

  it('apply con rewriteEntryId conserva el número de asiento', async () => {
    const { id } = await confirmedReceipt([cash('500'), transfer('500')]);
    const { journalEntryId } = await prisma.receipt.findUniqueOrThrow({
      where: { id },
      select: { journalEntryId: true },
    });
    expect(journalEntryId).not.toBeNull();
    const entryBefore = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: journalEntryId! },
      select: { number: true },
    });
    const lastNumberBefore = await readLastEntryNumber(companyId);
    const bankBefore = await bankBalance();
    const cashBefore = await expectedBalance();

    const result = await inTx(async (tx) => {
      await revertReceiptEffectsTx(tx, ctx, id);
      return applyReceiptEffectsTx(tx, ctx, id, { rewriteEntryId: journalEntryId! });
    });

    expect(result).toEqual({ journalEntryId });
    const entryAfter = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: journalEntryId! },
      select: { number: true, status: true },
    });
    expect(entryAfter).toEqual({ number: entryBefore.number, status: 'DRAFT' });
    expect(await readLastEntryNumber(companyId)).toBe(lastNumberBefore);
    expect(await prisma.journalEntryLine.count({ where: { entryId: journalEntryId! } })).toBe(3);
    // Los efectos quedan una sola vez
    expect(await bankBalance()).toBe(bankBefore);
    expect(await expectedBalance()).toBe(cashBefore);
    expect(await prisma.cashMovement.count({ where: { receiptId: id } })).toBe(1);
    expect(
      await prisma.bankMovement.count({
        where: { receiptId: id, documentLink: 'CREATED_BY_DOCUMENT' },
      })
    ).toBe(1);
  });

  describe('impedimentos', () => {
    it('RC sin efectos usados → ninguno', async () => {
      const { id } = await confirmedReceipt([
        transfer('300'),
        cash('300'),
        check('200', 'T792R-CH-OK'),
        echeq('200', 'T792R-ECH-OK'),
      ]);
      expect(await impedimentCodes(id)).toEqual([]);
    });

    it('RC en borrador → ninguno', async () => {
      const { id } = await draftReceipt([transfer('500'), cash('500')]);
      expect(await impedimentCodes(id)).toEqual([]);
    });

    it('caja cerrada → cashSessionClosed', async () => {
      const { id } = await confirmedReceipt([cash('1000')]);
      await prisma.cashRegisterSession.update({
        where: { id: sessionId },
        data: { status: 'CLOSED', closedAt: new Date(), closedBy: 'test' },
      });
      try {
        const list = await inTx((tx) => receiptEffectImpedimentsTx(tx, id, DOC_LABEL));
        expect(list).toEqual([
          {
            code: 'CASH_SESSION_CLOSED',
            severity: 'BLOCKED',
            message: `${DOC_LABEL} tiene un pago en efectivo de una sesión ya cerrada de la caja ${PREFIX}Caja.`,
          },
        ]);
      } finally {
        await prisma.cashRegisterSession.update({
          where: { id: sessionId },
          data: { status: 'OPEN', closedAt: null, closedBy: null },
        });
      }
    });

    it('cheque depositado → checkUsed', async () => {
      const { id } = await confirmedReceipt([check('400', 'T792R-CH-DEP'), cash('600')]);
      await prisma.check.updateMany({
        where: { companyId, checkNumber: 'T792R-CH-DEP' },
        data: { status: 'DEPOSITED' },
      });
      const list = await inTx((tx) => receiptEffectImpedimentsTx(tx, id, DOC_LABEL));
      expect(list).toEqual([
        {
          code: 'CHECK_USED',
          severity: 'BLOCKED',
          message:
            'El cheque Banco Emisor T792R-CH-DEP ya fue utilizado (Depositado) y no se puede revertir.',
        },
      ]);
    });

    it.each(['CLEARED', 'REJECTED', 'VOIDED'] as const)('cheque %s → checkUsed', async (status) => {
      const checkNumber = `T792R-CH-${status}`;
      const { id } = await confirmedReceipt([check('400', checkNumber), cash('600')]);
      await prisma.check.updateMany({ where: { companyId, checkNumber }, data: { status } });
      expect(await impedimentCodes(id)).toEqual(['CHECK_USED']);
    });

    it('cheque endosado en OP → checkEndorsedInOtherOp con el número de OP', async () => {
      const { id } = await confirmedReceipt([check('400', 'T792R-CH-END'), cash('600')]);
      const order = await prisma.paymentOrder.create({
        data: {
          companyId,
          supplierId,
          number: 7921,
          fullNumber: 'OP-07921',
          date: RECEIPT_DATE,
          totalAmount: 400,
          status: 'CONFIRMED',
          createdBy: 'test',
          payments: { create: [{ paymentMethod: 'CHECK', amount: 400 }] },
        },
        select: { payments: { select: { id: true } } },
      });
      await prisma.check.updateMany({
        where: { companyId, checkNumber: 'T792R-CH-END' },
        data: {
          status: 'ENDORSED',
          endorsedToName: `${PREFIX}Proveedor`,
          endorsedAt: RECEIPT_DATE,
          supplierId,
          paymentOrderPaymentId: order.payments[0].id,
        },
      });
      const list = await inTx((tx) => receiptEffectImpedimentsTx(tx, id, DOC_LABEL));
      expect(list).toEqual([
        {
          code: 'CHECK_ENDORSED_IN_OTHER_OP',
          severity: 'MANUAL',
          message: 'El cheque Banco Emisor T792R-CH-END fue endosado en OP-07921.',
          action: 'Anulá o corregí OP-07921 para que el cheque vuelva a cartera y reintentá.',
        },
      ]);
    });

    it('cheque endosado fuera de una OP → checkUsed', async () => {
      const { id } = await confirmedReceipt([check('400', 'T792R-CH-END2'), cash('600')]);
      await prisma.check.updateMany({
        where: { companyId, checkNumber: 'T792R-CH-END2' },
        data: { status: 'ENDORSED', endorsedToName: 'Tercero', endorsedAt: RECEIPT_DATE },
      });
      expect(await impedimentCodes(id)).toEqual(['CHECK_USED']);
    });

    it('movimiento bancario vinculado a mano → bankMovementManualLink', async () => {
      const { id } = await confirmedReceipt([transfer('500'), cash('500')]);
      // Un movimiento ya existente que el usuario vinculó al RC (linkBankMovementToDocument);
      // el que creó el RC al confirmarse sigue en su lugar.
      await prisma.bankMovement.create({
        data: {
          companyId,
          bankAccountId,
          type: 'DEPOSIT',
          amount: 50,
          date: RECEIPT_DATE,
          description: `${PREFIX}vinculado a mano`,
          receiptId: id,
          documentLink: 'MANUAL_LINK',
          createdBy: 'test',
        },
      });
      expect(await impedimentCodes(id)).toEqual(['BANK_MOVEMENT_MANUAL_LINK']);

      // Si además el movimiento propio del RC es el que quedó marcado a mano, falta el
      // creado por el comprobante: también es intrazable.
      await prisma.bankMovement.updateMany({
        where: { receiptId: id, documentLink: 'CREATED_BY_DOCUMENT' },
        data: { documentLink: 'MANUAL_LINK' },
      });
      expect(await impedimentCodes(id)).toEqual([
        'BANK_MOVEMENT_MANUAL_LINK',
        'UNTRACEABLE_EFFECT',
      ]);
    });

    it('movimiento bancario sin documentLink → untraceable', async () => {
      const { id } = await confirmedReceipt([transfer('500'), cash('500')]);
      await prisma.bankMovement.updateMany({
        where: { receiptId: id },
        data: { documentLink: null },
      });
      expect(await impedimentCodes(id)).toEqual(['UNTRACEABLE_EFFECT']);
    });

    it('transferencia cuyo movimiento bancario se desvinculó → untraceable', async () => {
      const { id } = await confirmedReceipt([transfer('500'), cash('500')]);
      const movement = await prisma.bankMovement.findFirstOrThrow({
        where: { receiptId: id },
        select: { id: true },
      });
      await unlinkBankMovementFromDocument(movement.id);
      expect(
        await prisma.bankMovement.findUniqueOrThrow({
          where: { id: movement.id },
          select: { receiptId: true, documentLink: true },
        })
      ).toEqual({ receiptId: null, documentLink: null });
      expect(await impedimentCodes(id)).toEqual(['UNTRACEABLE_EFFECT']);
    });

    it('pago en efectivo sin CashMovement vinculado → untraceable', async () => {
      const { id } = await confirmedReceipt([transfer('500'), cash('500')]);
      await prisma.cashMovement.updateMany({
        where: { receiptId: id },
        data: { receiptId: null },
      });
      expect(await impedimentCodes(id)).toEqual(['UNTRACEABLE_EFFECT']);
    });

    it('cheque sin vínculo con su pago → untraceable', async () => {
      const { id } = await confirmedReceipt([check('400', 'T792R-CH-SUELTO'), cash('600')]);
      await prisma.check.updateMany({
        where: { companyId, checkNumber: 'T792R-CH-SUELTO' },
        data: { receiptPaymentId: null },
      });
      expect(await impedimentCodes(id)).toEqual(['UNTRACEABLE_EFFECT']);
    });
  });

  describe('updateReceipt', () => {
    it('edita un borrador y rechaza un confirmado', async () => {
      const { id } = await draftReceipt([cash('1000')]);
      const before = await prisma.receipt.findUniqueOrThrow({
        where: { id },
        select: { number: true, fullNumber: true, createdBy: true },
      });
      const otherInvoiceId = await confirmedInvoice(800);
      const newDate = new Date('2026-03-15');

      const result = await updateReceipt(id, {
        customerId,
        date: newDate,
        notes: `${PREFIX}editado`,
        items: [{ invoiceId: otherInvoiceId, amount: '750' }],
        payments: [transfer('700')],
        withholdings: [{ taxType: 'IIBB', rate: '2', amount: '50', certificateNumber: 'C-1' }],
      });
      expect(result).toEqual({ success: true, id });

      const after = await prisma.receipt.findUniqueOrThrow({
        where: { id },
        select: {
          number: true,
          fullNumber: true,
          createdBy: true,
          status: true,
          date: true,
          notes: true,
          totalAmount: true,
          items: { select: { invoiceId: true, amount: true } },
          payments: { select: { paymentMethod: true, amount: true, bankAccountId: true } },
          withholdings: { select: { taxType: true, amount: true, certificateNumber: true } },
        },
      });
      expect({
        ...after,
        totalAmount: Number(after.totalAmount),
        items: after.items.map((i) => ({ ...i, amount: Number(i.amount) })),
        payments: after.payments.map((p) => ({ ...p, amount: Number(p.amount) })),
        withholdings: after.withholdings.map((w) => ({ ...w, amount: Number(w.amount) })),
      }).toEqual({
        ...before,
        status: 'DRAFT',
        date: newDate,
        notes: `${PREFIX}editado`,
        totalAmount: 750,
        items: [{ invoiceId: otherInvoiceId, amount: 750 }],
        payments: [{ paymentMethod: 'TRANSFER', amount: 700, bankAccountId }],
        withholdings: [{ taxType: 'IIBB', amount: 50, certificateNumber: 'C-1' }],
      });
      // Editar un borrador no mueve fondos
      expect(await prisma.bankMovement.count({ where: { receiptId: id } })).toBe(0);

      // Confirmado: no se edita
      const confirmed = await confirmedReceipt([cash('1000')]);
      const snapshot = () =>
        prisma.receipt.findUniqueOrThrow({
          where: { id: confirmed.id },
          select: {
            notes: true,
            totalAmount: true,
            items: { select: { invoiceId: true, amount: true } },
            payments: { select: { paymentMethod: true, amount: true } },
          },
        });
      const confirmedBefore = await snapshot();
      const rejected = await updateReceipt(confirmed.id, {
        customerId,
        date: RECEIPT_DATE,
        notes: `${PREFIX}no debería`,
        items: [{ invoiceId: confirmed.invoiceId, amount: '500' }],
        payments: [cash('500')],
        withholdings: [],
      });
      expect(rejected).toEqual({
        success: false,
        error: 'Solo se pueden editar recibos en estado borrador',
      });
      expect(await snapshot()).toEqual(confirmedBefore);
    });

    it('rechaza datos inválidos sin tocar el borrador', async () => {
      const { id, invoiceId } = await draftReceipt([cash('1000')]);
      const rejected = await updateReceipt(id, {
        customerId,
        date: RECEIPT_DATE,
        notes: null,
        items: [{ invoiceId, amount: '1000' }],
        // pagos que no suman el total de facturas
        payments: [cash('400')],
        withholdings: [],
      });
      expect(rejected).toEqual({
        success: false,
        error: 'El total de facturas debe ser igual al total de pagos + retenciones',
      });
      const payments = await prisma.receiptPayment.findMany({
        where: { receiptId: id },
        select: { amount: true },
      });
      expect(payments.map((p) => Number(p.amount))).toEqual([1000]);
    });
  });
});
