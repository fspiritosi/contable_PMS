/**
 * Tests de integración de los asientos del ciclo de vida del cheque (TSK-735), contra
 * la base real.
 *
 * El recibo deja el cheque recibido en "Valores a depositar" y la OP el propio físico
 * en "Valores diferidos a pagar". Depositar, rechazar, debitar y anular en Tesorería →
 * Cheques descargan esas cuentas con un asiento en borrador (`system`). Si el asiento
 * falla (mes cerrado), la acción entera se revierte.
 *
 * Se entra por los **server actions reales** (`confirmReceipt`, `confirmPaymentOrder`,
 * `depositCheck`, `rejectCheck`, `debitCheck`, `voidCheck`, `createCheck`). Molde:
 * `receipt-journal-entry.integration.test.ts`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { UNEXPECTED_ERROR_MESSAGE } from '@/shared/lib/action-result';
import { closeMonthForTest } from '@/modules/accounting/shared/test-utils/period-test-helpers';

// Código real de producción.
import { confirmReceipt, createReceipt } from '../receipts/actions.server';
import { confirmPaymentOrder, createPaymentOrder } from '../payment-orders/actions.server';
import { createCheck, debitCheck, depositCheck, rejectCheck, voidCheck } from './actions.server';

const PREFIX = 'TSK735-CHK-';
const DOC_DATE = new Date('2026-03-10');
const DEPOSIT_DATE = new Date('2026-03-15');

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

interface JournalLineRow {
  accountId: string;
  debit: number;
  credit: number;
  customerId: string | null;
  supplierId: string | null;
}

describe.skipIf(!dbAvailable)('integración e2e: asientos del ciclo del cheque (TSK-735)', () => {
  let companyId: string;
  let customerId: string;
  let supplierId: string;
  let pointOfSaleId: string;
  let bankAccountId: string;

  let cobrarId: string;
  let pagarId: string;
  let bancoId: string;
  let valoresId: string;
  let diferidosId: string;
  let rechazadosId: string;

  let nextNumber = 1;
  let depositedCheckId: string;

  async function confirmedReceiptCheck(checkNumber: string): Promise<string> {
    const number = nextNumber++;
    const invoice = await prisma.salesInvoice.create({
      data: {
        companyId,
        customerId,
        pointOfSaleId,
        voucherType: 'FACTURA_A',
        number,
        fullNumber: `9735-${String(number).padStart(8, '0')}`,
        issueDate: new Date('2026-03-01'),
        subtotal: 1000,
        netTaxed: 1000,
        vatAmount: 0,
        total: 1000,
        totalBeforeDiscount: 1000,
        discountTotal: 0,
        status: 'CONFIRMED',
        createdBy: 'test',
      },
      select: { id: true },
    });
    const draft = await createReceipt({
      customerId,
      date: DOC_DATE,
      notes: `${PREFIX}recibo`,
      items: [{ invoiceId: invoice.id, amount: '1000' }],
      payments: [
        {
          paymentMethod: 'CHECK',
          amount: '1000',
          checkNumber,
          checkBankName: 'Banco Emisor',
          checkIssueDate: DOC_DATE,
          checkDueDate: new Date('2026-04-10'),
          checkDrawerName: 'Cliente Librador',
        },
      ],
      withholdings: [],
    });
    const confirmed = await confirmReceipt(draft.id);
    expect(confirmed.success).toBe(true);
    const check = await prisma.check.findFirstOrThrow({
      where: { companyId, checkNumber },
      select: { id: true, accountId: true, status: true },
    });
    expect(check).toMatchObject({ accountId: valoresId, status: 'PORTFOLIO' });
    return check.id;
  }

  async function confirmedOrderCheck(
    checkNumber: string,
    method: 'CHECK' | 'ECHEQ' = 'CHECK'
  ): Promise<string> {
    const number = String(nextNumber++).padStart(8, '0');
    const invoice = await prisma.purchaseInvoice.create({
      data: {
        companyId,
        supplierId,
        voucherType: 'FACTURA_A',
        pointOfSale: '9735',
        number,
        fullNumber: `9735-${number}`,
        issueDate: new Date('2026-03-01'),
        subtotal: 1000,
        netTaxed: 1000,
        vatAmount: 0,
        total: 1000,
        status: 'CONFIRMED',
        createdBy: 'test',
      },
      select: { id: true },
    });
    const draft = await createPaymentOrder({
      supplierId,
      date: DOC_DATE,
      notes: `${PREFIX}orden`,
      items: [{ invoiceId: invoice.id, amount: '1000' }],
      payments: [
        {
          paymentMethod: method,
          amount: '1000',
          checkOwnership: 'OWN',
          checkNumber,
          checkBankName: 'Banco Propio',
          checkIssueDate: DOC_DATE,
          checkDueDate: new Date('2026-04-10'),
          bankAccountId: method === 'ECHEQ' ? bankAccountId : undefined,
        },
      ],
      withholdings: [],
    });
    const confirmed = await confirmPaymentOrder(draft.id);
    expect(confirmed.success).toBe(true);
    const check = await prisma.check.findFirstOrThrow({
      where: { companyId, checkNumber },
      select: { id: true, status: true },
    });
    expect(check.status).toBe('DELIVERED');
    return check.id;
  }

  async function entryLines(entryId: string | null): Promise<JournalLineRow[]> {
    if (!entryId) throw new Error('El cheque no tiene asiento del evento');
    const rows = await prisma.journalEntryLine.findMany({
      where: { entryId },
      select: { accountId: true, debit: true, credit: true, customerId: true, supplierId: true },
      orderBy: { debit: 'desc' },
    });
    return rows.map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
  }

  const readCheck = (id: string) =>
    prisma.check.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        bankMovementId: true,
        depositEntryId: true,
        rejectionEntryId: true,
        debitEntryId: true,
        voidEntryId: true,
      },
    });

  const bankBalance = async () =>
    Number(
      (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } })).balance
    );

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const mk = (code: string, name: string, type: 'ASSET' | 'LIABILITY') =>
      prisma.account.create({
        data: {
          companyId,
          code,
          name: `${PREFIX}${name}`,
          type,
          nature: type === 'ASSET' ? 'DEBIT' : 'CREDIT',
        },
      });
    const [cobrar, pagar, banco, valores, diferidos, rechazados] = await Promise.all([
      mk('T735C-COBRAR', 'Cuentas por Cobrar', 'ASSET'),
      mk('T735C-PAGAR', 'Cuentas por Pagar', 'LIABILITY'),
      mk('T735C-BANCO', 'Banco', 'ASSET'),
      mk('T735C-VAD', 'Valores a depositar', 'ASSET'),
      mk('T735C-VDP', 'Valores diferidos a pagar', 'LIABILITY'),
      mk('T735C-RECH', 'Cheques rechazados', 'ASSET'),
    ]);
    cobrarId = cobrar.id;
    pagarId = pagar.id;
    bancoId = banco.id;
    valoresId = valores.id;
    diferidosId = diferidos.id;
    rechazadosId = rechazados.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        receivablesAccountId: cobrarId,
        payablesAccountId: pagarId,
        checksReceivedAccountId: valoresId,
        checksPayableAccountId: diferidosId,
        checksRejectedAccountId: rechazadosId,
        requireCostCenter: false,
      },
    });

    const [customer, supplier, pos, bank] = await Promise.all([
      prisma.contractor.create({ data: { companyId, name: `${PREFIX}Cliente` } }),
      prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}PROV`,
          businessName: `${PREFIX}Proveedor`,
          taxId: '30500000001',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
      }),
      prisma.salesPointOfSale.create({
        data: { companyId, number: 9735, name: `${PREFIX}PDV`, createdBy: 'test' },
      }),
      prisma.bankAccount.create({
        data: {
          companyId,
          bankName: `${PREFIX}Banco`,
          accountNumber: 'T735C-0001',
          accountType: 'CHECKING',
          balance: 100000,
          status: 'ACTIVE',
          accountId: banco.id,
        },
      }),
    ]);
    customerId = customer.id;
    supplierId = supplier.id;
    pointOfSaleId = pos.id;
    bankAccountId = bank.id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
    if (companyId) {
      await prisma.check.deleteMany({ where: { companyId } });
      await prisma.cashflowProjection.deleteMany({ where: { companyId } });
      await prisma.bankMovement.deleteMany({ where: { companyId } });
      await prisma.bankAccount.deleteMany({ where: { companyId } });
      await prisma.receipt.deleteMany({ where: { companyId } });
      await prisma.paymentOrder.deleteMany({ where: { companyId } });
      await prisma.journalEntry.deleteMany({ where: { companyId } });
      await prisma.salesInvoice.deleteMany({ where: { companyId } });
      await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
      await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
      await prisma.contractor.deleteMany({ where: { companyId } });
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.accountingPeriod.deleteMany({ where: { fiscalYear: { companyId } } });
      await prisma.fiscalYear.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    const [companies, accounts] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
    ]);
    expect(companies).toBe(0);
    expect(accounts).toBe(0);
  });

  it('depositar un cheque recibido por RC → Debe Banco / Haber Valores a depositar, en borrador de sistema', async () => {
    depositedCheckId = await confirmedReceiptCheck('T735C-RC-1');
    const before = await bankBalance();

    const result = await depositCheck({
      checkId: depositedCheckId,
      bankAccountId,
      depositDate: DEPOSIT_DATE,
    });
    expect(result).toEqual({ success: true, warnings: [] });

    const check = await readCheck(depositedCheckId);
    expect(check.status).toBe('DEPOSITED');
    expect(await entryLines(check.depositEntryId)).toEqual([
      { accountId: bancoId, debit: 1000, credit: 0, customerId: null, supplierId: null },
      { accountId: valoresId, debit: 0, credit: 1000, customerId: null, supplierId: null },
    ]);
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: check.depositEntryId ?? '' },
      select: { status: true, createdBy: true, date: true },
    });
    expect(entry).toEqual({ status: 'DRAFT', createdBy: 'system', date: DEPOSIT_DATE });
    expect(await bankBalance()).toBe(before + 1000);
  });

  it('rechazar ese cheque → Debe Cheques rechazados (cliente) / Haber Banco; el saldo vuelve', async () => {
    const before = await bankBalance();

    const result = await rejectCheck(depositedCheckId, 'Sin fondos');
    expect(result).toEqual({ success: true, warnings: [] });

    const check = await readCheck(depositedCheckId);
    expect(check.status).toBe('REJECTED');
    expect(check.bankMovementId).toBeNull();
    expect(await entryLines(check.rejectionEntryId)).toEqual([
      { accountId: rechazadosId, debit: 1000, credit: 0, customerId, supplierId: null },
      { accountId: bancoId, debit: 0, credit: 1000, customerId: null, supplierId: null },
    ]);
    expect(await bankBalance()).toBe(before - 1000);
  });

  it('debitar un cheque propio de OP → Debe Valores diferidos / Haber Banco, CASHED y el saldo baja', async () => {
    const checkId = await confirmedOrderCheck('T735C-OP-1');
    const before = await bankBalance();

    const result = await debitCheck({ checkId, date: DEPOSIT_DATE, bankAccountId });
    expect(result).toEqual({ success: true, warnings: [] });

    const check = await readCheck(checkId);
    expect(check.status).toBe('CASHED');
    expect(await entryLines(check.debitEntryId)).toEqual([
      { accountId: diferidosId, debit: 1000, credit: 0, customerId: null, supplierId: null },
      { accountId: bancoId, debit: 0, credit: 1000, customerId: null, supplierId: null },
    ]);
    const movement = await prisma.bankMovement.findUniqueOrThrow({
      where: { id: check.bankMovementId ?? '' },
      select: { type: true, amount: true },
    });
    expect({ type: movement.type, amount: Number(movement.amount) }).toEqual({
      type: 'WITHDRAWAL',
      amount: 1000,
    });
    expect(await bankBalance()).toBe(before - 1000);
  });

  it('debitar un e-cheq propio → CASHED y el saldo baja, sin asiento (la OP ya acreditó el banco), con aviso', async () => {
    const checkId = await confirmedOrderCheck('T735C-OP-E1', 'ECHEQ');
    const before = await bankBalance();

    const result = await debitCheck({ checkId, date: DEPOSIT_DATE, bankAccountId });
    expect(result).toEqual({
      success: true,
      warnings: [
        'El e-cheq N° T735C-OP-E1 ya se registró en el banco al confirmar la orden de pago: el débito no genera asiento.',
      ],
    });

    const check = await readCheck(checkId);
    expect(check.status).toBe('CASHED');
    expect(check.debitEntryId).toBeNull();
    expect(await bankBalance()).toBe(before - 1000);
  });

  it('anular un depositado → se borra el borrador del depósito y queda el asiento de anulación', async () => {
    const checkId = await confirmedReceiptCheck('T735C-RC-2');
    const deposited = await depositCheck({ checkId, bankAccountId, depositDate: DEPOSIT_DATE });
    expect(deposited.success).toBe(true);
    const { depositEntryId, bankMovementId } = await readCheck(checkId);
    const before = await bankBalance();

    const result = await voidCheck(checkId);
    expect(result).toEqual({ success: true, warnings: [] });

    const check = await readCheck(checkId);
    expect(check.status).toBe('VOIDED');
    expect(check.depositEntryId).toBeNull();
    expect(await prisma.journalEntry.count({ where: { id: depositEntryId ?? '' } })).toBe(0);
    expect(await prisma.bankMovement.count({ where: { id: bankMovementId ?? '' } })).toBe(0);
    expect(await entryLines(check.voidEntryId)).toEqual([
      { accountId: cobrarId, debit: 1000, credit: 0, customerId, supplierId: null },
      { accountId: valoresId, debit: 0, credit: 1000, customerId: null, supplierId: null },
    ]);
    expect(await bankBalance()).toBe(before - 1000);
  });

  it('Review Focus 2: cheque cargado a mano → el depósito sale bien con aviso y sin asiento', async () => {
    const created = await createCheck({
      type: 'THIRD_PARTY',
      checkNumber: 'T735C-MAN-1',
      bankName: 'Banco Emisor',
      amount: '700',
      issueDate: DOC_DATE,
      dueDate: new Date('2026-04-10'),
      drawerName: 'Librador a mano',
      customerId,
    });
    const before = await bankBalance();

    const result = await depositCheck({
      checkId: created.id,
      bankAccountId,
      depositDate: DEPOSIT_DATE,
    });
    expect(result).toEqual({
      success: true,
      warnings: [
        'El cheque N° T735C-MAN-1 se cargó a mano: registrá el asiento en Contabilidad si corresponde.',
      ],
    });

    const check = await readCheck(created.id);
    expect(check.status).toBe('DEPOSITED');
    expect(check.depositEntryId).toBeNull();
    expect(await bankBalance()).toBe(before + 700);
  });

  it('Review Focus 3: mes cerrado → error legible; el cheque sigue en cartera y el saldo no cambia', async () => {
    const checkId = await confirmedReceiptCheck('T735C-RC-3');
    const before = await bankBalance();
    const movementsBefore = await prisma.bankMovement.count({ where: { companyId } });
    const reopen = await closeMonthForTest(companyId, DEPOSIT_DATE);

    try {
      const result = await depositCheck({ checkId, bankAccountId, depositDate: DEPOSIT_DATE });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).not.toBe(UNEXPECTED_ERROR_MESSAGE);
      expect(result.error).toMatch(/cerrad/i);
    } finally {
      await reopen();
    }

    const check = await readCheck(checkId);
    expect(check.status).toBe('PORTFOLIO');
    expect(check.depositEntryId).toBeNull();
    expect(check.bankMovementId).toBeNull();
    expect(await bankBalance()).toBe(before);
    expect(await prisma.bankMovement.count({ where: { companyId } })).toBe(movementsBefore);
  });
});
