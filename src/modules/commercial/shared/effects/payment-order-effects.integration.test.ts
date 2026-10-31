/**
 * Tests de integración de los efectos de la orden de pago (TSK-792, Tarea 7),
 * contra la base real: `applyPaymentOrderEffectsTx` (vía `confirmPaymentOrder`
 * y directo, con `rewriteEntryId`), su inversa `revertPaymentOrderEffectsTx` y
 * los impedimentos propios de los efectos (`paymentOrderEffectImpedimentsTx`).
 *
 * Los borradores se crean con los server actions reales (`createPaymentOrder`,
 * `createPartnerRepaymentOrder`) y se confirman con `confirmPaymentOrder`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/modules/accounting/features/integrations/core';
import { prisma } from '@/shared/lib/prisma';

import type { CreatePaymentOrderFormData } from '@/modules/commercial/features/treasury/shared/validators';

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
  confirmPaymentOrder,
  createPartnerRepaymentOrder,
  createPaymentOrder,
} from '@/modules/commercial/features/treasury/features/payment-orders/actions.server';
import {
  applyPaymentOrderEffectsTx,
  paymentOrderEffectImpedimentsTx,
  revertPaymentOrderEffectsTx,
} from './payment-order.server';
import type { EffectsCtx } from './types';

const PREFIX = 'TSK792-OPFX-';
const ORDER_DATE = new Date('2026-03-10');
const DOC_LABEL = 'la OP de prueba';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type PaymentInput = CreatePaymentOrderFormData['payments'][number];

const inTx = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction((tx) => fn(tx));

describe.skipIf(!dbAvailable)('integración: efectos de la orden de pago (TSK-792)', () => {
  let companyId: string;
  let ctx: EffectsCtx;
  let supplierId: string;
  let partnerId: string;
  let cajaRegisterId: string;
  let sessionId: string;
  let bankAccountId: string;
  let creditCardId: string;
  let partnerDebitCardId: string;
  /** TSK-735: cuentas en las que quedan el cheque propio y las cuotas. */
  let diferidosId: string;
  let tarjetasId: string;
  let sociosId: string;
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
  const ownCheck = (amount: string, checkNumber: string): PaymentInput => ({
    paymentMethod: 'CHECK',
    amount,
    checkOwnership: 'OWN',
    checkNumber,
    checkBankName: 'Banco Propio',
    checkIssueDate: ORDER_DATE,
    checkDueDate: new Date('2026-04-10'),
  });
  const endorsed = (amount: string, endorsedCheckId: string): PaymentInput => ({
    paymentMethod: 'CHECK',
    amount,
    checkOwnership: 'THIRD_PARTY',
    endorsedCheckId,
  });
  const creditCard = (amount: string, installmentsCount: number): PaymentInput => ({
    paymentMethod: 'CREDIT_CARD',
    amount,
    cardId: creditCardId,
    installmentsCount,
  });

  async function thirdPartyCheck(amount: number) {
    const check = await prisma.check.create({
      data: {
        companyId,
        type: 'THIRD_PARTY',
        status: 'PORTFOLIO',
        checkNumber: `T792F-CH-${seq++}`,
        bankName: 'Banco del Cliente',
        amount,
        issueDate: new Date('2026-02-01'),
        dueDate: new Date('2026-05-01'),
        drawerName: `${PREFIX}Cliente librador`,
        createdBy: 'test',
      },
      select: { id: true },
    });
    return check.id;
  }

  async function confirmedInvoice(total: number): Promise<string> {
    const number = String(seq++).padStart(8, '0');
    const invoice = await prisma.purchaseInvoice.create({
      data: {
        companyId,
        supplierId,
        voucherType: 'FACTURA_A',
        pointOfSale: '9792',
        number,
        fullNumber: `9792-${number}`,
        issueDate: new Date('2026-03-01'),
        subtotal: total,
        netTaxed: total,
        vatAmount: 0,
        total,
        status: 'CONFIRMED',
        createdBy: 'test',
      },
      select: { id: true },
    });
    return invoice.id;
  }

  /** OP confirmada por el `confirmPaymentOrder` real, pagando una factura por el total de los pagos. */
  async function confirmedOrder(payments: PaymentInput[]) {
    const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const invoiceId = await confirmedInvoice(total);
    const created = await createPaymentOrder({
      supplierId,
      date: ORDER_DATE,
      notes: `${PREFIX}orden`,
      items: [{ invoiceId, amount: String(total) }],
      payments,
      withholdings: [],
    });
    const result = await confirmPaymentOrder(created.id);
    if (!result.success) throw new Error(`No se pudo confirmar la OP: ${result.error}`);
    return { id: created.id, invoiceId };
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
    (await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id }, select: { status: true } }))
      .status;
  const impedimentCodes = (id: string) =>
    inTx((tx) => paymentOrderEffectImpedimentsTx(tx, id, DOC_LABEL)).then((list) =>
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
      type: 'ASSET' | 'LIABILITY',
      nature: 'DEBIT' | 'CREDIT'
    ) =>
      prisma.account.create({ data: { companyId, code, name: `${PREFIX}${name}`, type, nature } });
    const [pagar, caja, banco, cobrar, valores, diferidos, tarjetas, socios] = await Promise.all([
      mk('T792F-PAGAR', 'Cuentas por Pagar', 'LIABILITY', 'CREDIT'),
      mk('T792F-CAJA', 'Caja', 'ASSET', 'DEBIT'),
      mk('T792F-BANCO', 'Banco', 'ASSET', 'DEBIT'),
      // Endoso de cheques históricos (sin cuenta): van contra Cuentas por Cobrar.
      mk('T792F-COBRAR', 'Cuentas por Cobrar', 'ASSET', 'DEBIT'),
      // TSK-735: cuentas de cheques y tarjetas (hojas).
      mk('T735-VAD', 'Valores a depositar', 'ASSET', 'DEBIT'),
      mk('T735-VDP', 'Valores diferidos a pagar', 'LIABILITY', 'CREDIT'),
      mk('T735-TCP', 'Tarjetas de crédito a pagar', 'LIABILITY', 'CREDIT'),
      mk('T735-DSO', 'Deudas con socios', 'LIABILITY', 'CREDIT'),
    ]);
    diferidosId = diferidos.id;
    tarjetasId = tarjetas.id;
    sociosId = socios.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        payablesAccountId: pagar.id,
        receivablesAccountId: cobrar.id,
        checksReceivedAccountId: valores.id,
        checksPayableAccountId: diferidos.id,
        creditCardsPayableAccountId: tarjetas.id,
        partnerDebtsAccountId: socios.id,
        requireCostCenter: false,
      },
    });

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

    cajaRegisterId = (
      await prisma.cashRegister.create({
        data: {
          companyId,
          code: 'T792F-CAJA1',
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
          accountNumber: 'T792F-0001',
          accountType: 'CHECKING',
          balance: 100000,
          status: 'ACTIVE',
          accountId: banco.id,
        },
        select: { id: true },
      })
    ).id;

    partnerId = (
      await prisma.partner.create({
        data: { companyId, name: `${PREFIX}Socia`, createdBy: 'test' },
        select: { id: true },
      })
    ).id;

    const mkCard = (name: string, cardType: 'DEBIT' | 'CREDIT', ownerType: 'COMPANY' | 'PARTNER') =>
      prisma.card.create({
        data: {
          companyId,
          name: `${PREFIX}${name}`,
          cardType,
          ownerType,
          partnerId: ownerType === 'PARTNER' ? partnerId : null,
          createdBy: 'test',
        },
        select: { id: true },
      });
    creditCardId = (await mkCard('Visa Empresa', 'CREDIT', 'COMPANY')).id;
    partnerDebitCardId = (await mkCard('Débito Socia', 'DEBIT', 'PARTNER')).id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
    if (companyId) {
      await prisma.projectionDocumentLink.deleteMany({ where: { companyId } });
      await prisma.cashflowProjection.deleteMany({ where: { companyId } });
      await prisma.paymentOrderInstallment.deleteMany({ where: { companyId } });
      await prisma.check.deleteMany({ where: { companyId } });
      await prisma.cashMovement.deleteMany({ where: { companyId } });
      await prisma.cashRegisterSession.deleteMany({ where: { companyId } });
      await prisma.cashRegister.deleteMany({ where: { companyId } });
      await prisma.bankMovement.deleteMany({ where: { companyId } });
      await prisma.bankAccount.deleteMany({ where: { companyId } });
      // items/payments/withholdings caen en cascada con la OP.
      await prisma.paymentOrder.deleteMany({ where: { companyId } });
      await prisma.card.deleteMany({ where: { companyId } });
      await prisma.partner.deleteMany({ where: { companyId } });
      await cleanupAccountingCompany(companyId);
      await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    await prisma.$disconnect();
  });

  it('dos confirmaciones simultáneas aplican los efectos una sola vez (TSK-812)', async () => {
    const invoiceId = await confirmedInvoice(500);
    const created = await createPaymentOrder({
      supplierId,
      date: ORDER_DATE,
      notes: `${PREFIX}orden`,
      items: [{ invoiceId, amount: '500' }],
      payments: [cash('200'), transfer('300')],
      withholdings: [],
    });
    const bankBefore = await bankBalance();
    const cashBefore = await expectedBalance();
    const lastNumberBefore = await readLastEntryNumber(companyId);

    const results = await Promise.all([
      confirmPaymentOrder(created.id),
      confirmPaymentOrder(created.id),
    ]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => !r.success)).toEqual([
      { success: false, error: 'Orden de pago no encontrada o ya confirmada' },
    ]);
    expect(await bankBalance()).toBe(bankBefore - 300);
    expect(await expectedBalance()).toBe(cashBefore - 200);
    expect(await prisma.cashMovement.count({ where: { paymentOrderId: created.id } })).toBe(1);
    expect(await prisma.bankMovement.count({ where: { paymentOrderId: created.id } })).toBe(1);
    expect(await invoiceStatus(invoiceId)).toBe('PAID');
    expect(await readLastEntryNumber(companyId)).toBe(lastNumberBefore + 1);
  });

  it('revert(apply) deja saldos de banco y caja, cheques y cuotas como antes', async () => {
    const endorsedCheckId = await thirdPartyCheck(150);
    const bankBefore = await bankBalance();
    const cashBefore = await expectedBalance();

    const { id } = await confirmedOrder([
      transfer('300'),
      cash('200'),
      ownCheck('100', 'T792F-OWN-1'),
      endorsed('150', endorsedCheckId),
      creditCard('250', 3),
    ]);

    // apply movió todo
    expect(await bankBalance()).toBe(bankBefore - 300);
    expect(await expectedBalance()).toBe(cashBefore - 200);
    const ownChecks = await prisma.check.findMany({
      where: { companyId, checkNumber: 'T792F-OWN-1' },
      select: { accountId: true },
    });
    // TSK-735: el cheque propio queda en Valores diferidos a pagar y las cuotas en Tarjetas a pagar.
    expect(ownChecks).toEqual([{ accountId: diferidosId }]);
    const installments = await prisma.paymentOrderInstallment.findMany({
      where: { paymentOrderId: id },
      select: { id: true, accountId: true },
    });
    expect(installments.map((i) => i.accountId)).toEqual([tarjetasId, tarjetasId, tarjetasId]);
    const orderBefore = await prisma.paymentOrder.findUniqueOrThrow({
      where: { id },
      select: { status: true, journalEntryId: true, fullNumber: true },
    });

    await inTx((tx) => revertPaymentOrderEffectsTx(tx, ctx, id));

    expect(await bankBalance()).toBe(bankBefore);
    expect(await expectedBalance()).toBe(cashBefore);
    expect(await prisma.bankMovement.count({ where: { paymentOrderId: id } })).toBe(0);
    expect(await prisma.cashMovement.count({ where: { paymentOrderId: id } })).toBe(0);
    expect(await prisma.check.count({ where: { companyId, checkNumber: 'T792F-OWN-1' } })).toBe(0);

    const check = await prisma.check.findUniqueOrThrow({
      where: { id: endorsedCheckId },
      select: {
        status: true,
        endorsedToName: true,
        endorsedToTaxId: true,
        endorsedAt: true,
        supplierId: true,
        paymentOrderPaymentId: true,
      },
    });
    expect(check).toEqual({
      status: 'PORTFOLIO',
      endorsedToName: null,
      endorsedToTaxId: null,
      endorsedAt: null,
      supplierId: null,
      paymentOrderPaymentId: null,
    });

    expect(await prisma.paymentOrderInstallment.count({ where: { paymentOrderId: id } })).toBe(0);
    // Por descripción también: si se borrara la cuota sin su proyección, el FK quedaría en null.
    const projections = await prisma.cashflowProjection.count({
      where: {
        companyId,
        OR: [
          { paymentOrderInstallmentId: { in: installments.map((i) => i.id) } },
          { description: { contains: `${orderBefore.fullNumber} ` } },
        ],
      },
    });
    expect(projections).toBe(0);

    // No toca el estado de la OP ni su asiento (lo decide el motor).
    expect(
      await prisma.paymentOrder.findUniqueOrThrow({
        where: { id },
        select: { status: true, journalEntryId: true, fullNumber: true },
      })
    ).toEqual(orderBefore);
  });

  it('revert recalcula la factura a CONFIRMED', async () => {
    const { id, invoiceId } = await confirmedOrder([cash('1000')]);
    expect(await invoiceStatus(invoiceId)).toBe('PAID');

    // Como hará el motor al eliminar o anular: la OP deja de contar (deja de estar
    // CONFIRMED) en la misma transacción en la que se revierten sus efectos. El
    // recálculo del final del revert ya ve la factura sin ese pago.
    await inTx(async (tx) => {
      await tx.paymentOrder.update({ where: { id }, data: { status: 'DRAFT' } });
      await revertPaymentOrderEffectsTx(tx, ctx, id);
    });

    expect(await invoiceStatus(invoiceId)).toBe('CONFIRMED');
  });

  it('OP de socio: revert devuelve las cuotas saldadas a PENDING', async () => {
    const { id: originId } = await confirmedOrder([
      { paymentMethod: 'DEBIT_CARD', amount: '400', cardId: partnerDebitCardId, bankAccountId },
      cash('600'),
    ]);
    const installment = await prisma.paymentOrderInstallment.findFirstOrThrow({
      where: { paymentOrderId: originId },
      select: { id: true },
    });

    const repayment = await createPartnerRepaymentOrder({
      partnerId,
      date: ORDER_DATE,
      notes: `${PREFIX}devolución`,
      installmentIds: [installment.id],
      payments: [cash('400')],
    });
    const cashBefore = await expectedBalance();
    const confirmed = await confirmPaymentOrder(repayment.id);
    expect(confirmed.success).toBe(true);
    expect(await expectedBalance()).toBe(cashBefore - 400);
    // TSK-735: la devolución genera asiento (Deudas con socios / Caja).
    const { journalEntryId } = await prisma.paymentOrder.findUniqueOrThrow({
      where: { id: repayment.id },
      select: { journalEntryId: true },
    });
    expect(journalEntryId).not.toBeNull();
    const entryNumber = (
      await prisma.journalEntry.findUniqueOrThrow({
        where: { id: journalEntryId! },
        select: { number: true },
      })
    ).number;
    expect(
      (
        await prisma.paymentOrderInstallment.findUniqueOrThrow({
          where: { id: installment.id },
          select: { status: true },
        })
      ).status
    ).toBe('PAID');

    await inTx((tx) => revertPaymentOrderEffectsTx(tx, ctx, repayment.id));

    const after = await prisma.paymentOrderInstallment.findUniqueOrThrow({
      where: { id: installment.id },
      select: { status: true, paidAt: true, settledByPaymentOrderId: true },
    });
    expect(after).toEqual({
      status: 'PENDING',
      paidAt: null,
      settledByPaymentOrderId: repayment.id,
    });
    expect(await expectedBalance()).toBe(cashBefore);
    expect(await prisma.cashMovement.count({ where: { paymentOrderId: repayment.id } })).toBe(0);

    // Reaplicar como el motor (reescribiendo el asiento) conserva asiento y número.
    const result = await inTx((tx) =>
      applyPaymentOrderEffectsTx(tx, ctx, repayment.id, { rewriteEntryId: journalEntryId! })
    );
    expect(result).toEqual({ journalEntryId });
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: journalEntryId! },
      select: { number: true, lines: { select: { accountId: true, debit: true, credit: true } } },
    });
    expect(entry.number).toBe(entryNumber);
    expect(entry.lines).toHaveLength(2);
    const debit = entry.lines.find((l) => Number(l.debit) > 0);
    expect([debit?.accountId, Number(debit?.debit)]).toEqual([sociosId, 400]);
    expect(entry.lines.find((l) => Number(l.credit) > 0)?.credit.toString()).toBe('400');
    expect(
      (
        await prisma.paymentOrderInstallment.findUniqueOrThrow({
          where: { id: installment.id },
          select: { status: true },
        })
      ).status
    ).toBe('PAID');
  });

  it('apply con rewriteEntryId conserva el número de asiento', async () => {
    const { id } = await confirmedOrder([cash('500'), transfer('500')]);
    const { journalEntryId } = await prisma.paymentOrder.findUniqueOrThrow({
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
      await revertPaymentOrderEffectsTx(tx, ctx, id);
      return applyPaymentOrderEffectsTx(tx, ctx, id, { rewriteEntryId: journalEntryId! });
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
    expect(await prisma.cashMovement.count({ where: { paymentOrderId: id } })).toBe(1);
    expect(
      await prisma.bankMovement.count({
        where: { paymentOrderId: id, documentLink: 'CREATED_BY_DOCUMENT' },
      })
    ).toBe(1);
  });

  describe('impedimentos', () => {
    it('OP sin efectos usados → ninguno', async () => {
      const endorsedCheckId = await thirdPartyCheck(100);
      const { id } = await confirmedOrder([
        transfer('300'),
        cash('300'),
        ownCheck('100', 'T792F-OWN-OK'),
        endorsed('100', endorsedCheckId),
        creditCard('200', 2),
      ]);
      expect(await impedimentCodes(id)).toEqual([]);
    });

    it('caja cerrada → cashSessionClosed', async () => {
      const { id } = await confirmedOrder([cash('1000')]);
      await prisma.cashRegisterSession.update({
        where: { id: sessionId },
        data: { status: 'CLOSED', closedAt: new Date(), closedBy: 'test' },
      });
      try {
        const list = await inTx((tx) => paymentOrderEffectImpedimentsTx(tx, id, DOC_LABEL));
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

    it('cheque propio CASHED → checkUsed', async () => {
      const { id } = await confirmedOrder([ownCheck('400', 'T792F-OWN-CASHED'), cash('600')]);
      await prisma.check.updateMany({
        where: { companyId, checkNumber: 'T792F-OWN-CASHED' },
        data: { status: 'CASHED' },
      });
      const list = await inTx((tx) => paymentOrderEffectImpedimentsTx(tx, id, DOC_LABEL));
      expect(list).toEqual([
        {
          code: 'CHECK_USED',
          severity: 'BLOCKED',
          message:
            'El cheque Banco Propio T792F-OWN-CASHED ya fue utilizado (Cobrado) y no se puede revertir.',
        },
      ]);
    });

    it('cheque endosado que ya no está ENDORSED → checkUsed', async () => {
      const endorsedCheckId = await thirdPartyCheck(400);
      const { id } = await confirmedOrder([endorsed('400', endorsedCheckId), cash('600')]);
      await prisma.check.update({ where: { id: endorsedCheckId }, data: { status: 'REJECTED' } });
      expect(await impedimentCodes(id)).toEqual(['CHECK_USED']);
    });

    it('cuota PAID → installmentPaid (una sola vez)', async () => {
      const { id } = await confirmedOrder([transfer('400'), creditCard('600', 3)]);
      await prisma.paymentOrderInstallment.updateMany({
        where: { paymentOrderId: id, number: { in: [1, 2] } },
        data: { status: 'PAID', paidAt: ORDER_DATE },
      });
      expect(await impedimentCodes(id)).toEqual(['INSTALLMENT_PAID']);
    });

    it('proyección de cuota vinculada a un documento o ya no PENDING → installmentPaid', async () => {
      const linked = await confirmedOrder([transfer('400'), creditCard('600', 2)]);
      const projection = await prisma.cashflowProjection.findFirstOrThrow({
        where: { paymentOrderInstallment: { paymentOrderId: linked.id } },
        select: { id: true },
      });
      await prisma.projectionDocumentLink.create({
        data: { companyId, projectionId: projection.id, amount: 300, createdBy: 'test' },
      });
      expect(await impedimentCodes(linked.id)).toEqual(['INSTALLMENT_PAID']);

      const confirmedProjection = await confirmedOrder([transfer('400'), creditCard('600', 2)]);
      await prisma.cashflowProjection.updateMany({
        where: { paymentOrderInstallment: { paymentOrderId: confirmedProjection.id } },
        data: { status: 'CONFIRMED' },
      });
      expect(await impedimentCodes(confirmedProjection.id)).toEqual(['INSTALLMENT_PAID']);
    });

    it('movimiento bancario vinculado a mano → bankMovementManualLink', async () => {
      const { id } = await confirmedOrder([transfer('500'), cash('500')]);
      // Un movimiento ya existente que el usuario vinculó a la OP (linkBankMovementToDocument);
      // el que creó la OP al confirmarse sigue en su lugar.
      await prisma.bankMovement.create({
        data: {
          companyId,
          bankAccountId,
          type: 'WITHDRAWAL',
          amount: 50,
          date: ORDER_DATE,
          description: `${PREFIX}vinculado a mano`,
          paymentOrderId: id,
          documentLink: 'MANUAL_LINK',
          createdBy: 'test',
        },
      });
      expect(await impedimentCodes(id)).toEqual(['BANK_MOVEMENT_MANUAL_LINK']);

      // Si además el movimiento propio de la OP es el que quedó marcado a mano, falta el
      // creado por el comprobante: también es intrazable.
      await prisma.bankMovement.updateMany({
        where: { paymentOrderId: id, documentLink: 'CREATED_BY_DOCUMENT' },
        data: { documentLink: 'MANUAL_LINK' },
      });
      expect(await impedimentCodes(id)).toEqual([
        'BANK_MOVEMENT_MANUAL_LINK',
        'UNTRACEABLE_EFFECT',
      ]);
    });

    it('movimiento bancario sin documentLink → untraceable', async () => {
      const { id } = await confirmedOrder([transfer('500'), cash('500')]);
      await prisma.bankMovement.updateMany({
        where: { paymentOrderId: id },
        data: { documentLink: null },
      });
      expect(await impedimentCodes(id)).toEqual(['UNTRACEABLE_EFFECT']);
    });

    it('transferencia cuyo movimiento bancario se desvinculó → untraceable', async () => {
      const { id } = await confirmedOrder([transfer('500'), cash('500')]);
      const movement = await prisma.bankMovement.findFirstOrThrow({
        where: { paymentOrderId: id },
        select: { id: true },
      });
      await unlinkBankMovementFromDocument(movement.id);
      expect(
        await prisma.bankMovement.findUniqueOrThrow({
          where: { id: movement.id },
          select: { paymentOrderId: true, documentLink: true },
        })
      ).toEqual({ paymentOrderId: null, documentLink: null });
      expect(await impedimentCodes(id)).toEqual(['UNTRACEABLE_EFFECT']);
    });

    it('pago en efectivo sin CashMovement vinculado → untraceable', async () => {
      const { id } = await confirmedOrder([transfer('500'), cash('500')]);
      await prisma.cashMovement.updateMany({
        where: { paymentOrderId: id },
        data: { paymentOrderId: null },
      });
      expect(await impedimentCodes(id)).toEqual(['UNTRACEABLE_EFFECT']);
    });

    it('cuota pendiente sin proyección vinculada → untraceable (revert + apply la duplicaría)', async () => {
      const { id } = await confirmedOrder([transfer('400'), creditCard('600', 2)]);
      expect(await impedimentCodes(id)).toEqual([]);
      // Proyección anterior a la trazabilidad: existe, pero sin FK a la cuota.
      await prisma.cashflowProjection.updateMany({
        where: { paymentOrderInstallment: { paymentOrderId: id, number: 1 } },
        data: { paymentOrderInstallmentId: null },
      });
      expect(await impedimentCodes(id)).toEqual(['UNTRACEABLE_EFFECT']);
    });
  });
});
