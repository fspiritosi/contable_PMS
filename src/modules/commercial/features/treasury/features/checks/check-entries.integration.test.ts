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

import { closeMonthForTest } from '@/modules/accounting/shared/test-utils/period-test-helpers';
import { cleanupAccountingCompany } from '@/modules/accounting/shared/test-utils/cleanup-accounting-company';
import { UNEXPECTED_ERROR_MESSAGE } from '@/shared/lib/action-result';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

// Código real de producción.
import { postJournalEntryTx } from '@/modules/accounting/features/integrations/core';
import { confirmPaymentOrder, createPaymentOrder } from '../payment-orders/actions.server';
import { confirmReceipt, createReceipt } from '../receipts/actions.server';
import {
  createCheck,
  debitCheck,
  deleteCheck,
  depositCheck,
  endorseCheck,
  getChecksPaginated,
  rejectCheck,
  voidCheck,
} from './actions.server';

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

  async function confirmedReceiptCheck(
    checkNumber: string,
    method: 'CHECK' | 'ECHEQ' = 'CHECK'
  ): Promise<string> {
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
          paymentMethod: method,
          amount: '1000',
          checkNumber,
          bankAccountId: method === 'ECHEQ' ? bankAccountId : undefined,
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

  /** Cheque cargado a mano en Tesorería (sin RC/OP ni cuenta). */
  async function manualThirdPartyCheck(checkNumber: string): Promise<string> {
    const created = await createCheck({
      type: 'THIRD_PARTY',
      checkNumber,
      bankName: 'Banco Emisor',
      amount: '700',
      issueDate: DOC_DATE,
      dueDate: new Date('2026-04-10'),
      drawerName: 'Librador a mano',
      customerId,
    });
    return created.id;
  }

  async function listedCheck(checkId: string) {
    const { checkNumber } = await prisma.check.findUniqueOrThrow({
      where: { id: checkId },
      select: { checkNumber: true },
    });
    const { data } = await getChecksPaginated({ checkNumber });
    const row = data.find((c) => c.id === checkId);
    if (!row) throw new Error('El cheque no aparece en el listado');
    return row;
  }

  const bankBalance = async () =>
    Number((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } })).balance);

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
      await prisma.salesInvoice.deleteMany({ where: { companyId } });
      await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
      await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
      await prisma.contractor.deleteMany({ where: { companyId } });
      await prisma.supplier.deleteMany({ where: { companyId } });
      // Hay asientos REGISTRADOS/ANULADOS (F11): el trigger no deja borrarlos directo.
      await cleanupAccountingCompany(companyId);
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

  it('Review Focus 2: cheque cargado a mano → depósito y rechazo salen bien con aviso y sin asiento', async () => {
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

    // Rechazarlo tampoco asienta: su depósito no debitó el banco en los libros.
    const rejected = await rejectCheck(created.id, 'Sin fondos');
    expect(rejected).toEqual({
      success: true,
      warnings: [
        'El cheque N° T735C-MAN-1 se cargó a mano: registrá el asiento en Contabilidad si corresponde.',
      ],
    });
    const afterReject = await readCheck(created.id);
    expect(afterReject.status).toBe('REJECTED');
    expect(afterReject.rejectionEntryId).toBeNull();
    expect(afterReject.bankMovementId).toBeNull();
    expect(await bankBalance()).toBe(before);
  });

  it('histórico físico depositado antes de TSK-735 (sin asiento de depósito) → el rechazo reclasifica Cobrar sin tocar Banco', async () => {
    // Cheque de RC llevado a su forma histórica: sin cuenta registrada y depositado sin asiento.
    const checkId = await confirmedReceiptCheck('T735C-RC-HIST');
    const movement = await prisma.bankMovement.create({
      data: {
        companyId,
        bankAccountId,
        type: 'CHECK',
        amount: 1000,
        date: DEPOSIT_DATE,
        description: `${PREFIX}depósito histórico`,
        reconciled: false,
        createdBy: 'test',
      },
    });
    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: { balance: { increment: 1000 } },
    });
    await prisma.check.update({
      where: { id: checkId },
      data: {
        accountId: null,
        status: 'DEPOSITED',
        bankAccountId,
        bankMovementId: movement.id,
        depositedAt: DEPOSIT_DATE,
      },
    });
    const before = await bankBalance();

    const result = await rejectCheck(checkId, 'Sin fondos');
    expect(result).toEqual({ success: true, warnings: [] });

    const check = await readCheck(checkId);
    expect(check.status).toBe('REJECTED');
    const lines = await entryLines(check.rejectionEntryId);
    expect(lines).toEqual([
      { accountId: rechazadosId, debit: 1000, credit: 0, customerId, supplierId: null },
      { accountId: cobrarId, debit: 0, credit: 1000, customerId, supplierId: null },
    ]);
    expect(lines.some((l) => l.accountId === bancoId)).toBe(false);
    // Tesorería sí deshace el depósito: movimiento borrado y saldo descontado.
    expect(check.bankMovementId).toBeNull();
    expect(await bankBalance()).toBe(before - 1000);
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

  // ==========================================================================
  // Revisión final de TSK-735
  // ==========================================================================

  it('F3: un cheque nacido de un RC no se elimina (y el listado no ofrece "Eliminar"); uno cargado a mano sí', async () => {
    const checkId = await confirmedReceiptCheck('T735C-F3-RC');
    const { receiptPayment } = await prisma.check.findUniqueOrThrow({
      where: { id: checkId },
      select: { receiptPayment: { select: { receipt: { select: { fullNumber: true } } } } },
    });

    expect((await listedCheck(checkId)).fromDocument).toBe(true);
    expect(await deleteCheck(checkId)).toEqual({
      success: false,
      error: `El cheque N° T735C-F3-RC lo generó el recibo ${receiptPayment?.receipt.fullNumber}: anulalo o corregí el comprobante.`,
    });
    expect((await readCheck(checkId)).status).toBe('PORTFOLIO');

    const manualId = await manualThirdPartyCheck('T735C-F3-MAN');
    expect((await listedCheck(manualId)).fromDocument).toBe(false);
    expect(await deleteCheck(manualId)).toEqual({ success: true });
    expect(await prisma.check.count({ where: { id: manualId } })).toBe(0);
  });

  it('F3: un cheque propio nacido de una OP tampoco se elimina', async () => {
    const checkId = await confirmedOrderCheck('T735C-F3-OP');
    const result = await deleteCheck(checkId);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(
      /^El cheque N° T735C-F3-OP lo generó la orden de pago OP-\d+: anulalo o corregí el comprobante\.$/
    );
    expect((await readCheck(checkId)).status).toBe('DELIVERED');
  });

  it('F4: endoso manual de un cheque registrado en Valores a depositar → bloqueado; uno cargado a mano → endosado con aviso', async () => {
    const endorse = (checkId: string) =>
      endorseCheck({
        checkId,
        endorsedToName: 'Proveedor a mano',
        endorsedToTaxId: null,
        supplierId: null,
        endorsedDate: DEPOSIT_DATE,
      });

    const registeredId = await confirmedReceiptCheck('T735C-F4-RC');
    expect(await endorse(registeredId)).toEqual({
      success: false,
      error:
        `El cheque N° T735C-F4-RC está registrado en T735C-VAD - ${PREFIX}Valores a depositar: ` +
        'endosalo desde una orden de pago para que el asiento lo descargue.',
    });
    expect((await readCheck(registeredId)).status).toBe('PORTFOLIO');

    const manualId = await manualThirdPartyCheck('T735C-F4-MAN');
    expect(await endorse(manualId)).toEqual({
      success: true,
      warnings: [
        'El endoso manual no genera asiento: el endoso contable se hace con una orden de pago.',
      ],
    });
    expect((await readCheck(manualId)).status).toBe('ENDORSED');
  });

  it('F7: e-cheq propio → solo se debita en el banco en que se registró; el listado fija ese banco', async () => {
    const checkId = await confirmedOrderCheck('T735C-F7-OP', 'ECHEQ');
    const otherBank = await prisma.bankAccount.create({
      data: {
        companyId,
        bankName: `${PREFIX}Otro banco`,
        accountNumber: 'T735C-0002',
        accountType: 'CHECKING',
        balance: 100000,
        status: 'ACTIVE',
        accountId: bancoId,
      },
      select: { id: true },
    });
    expect((await listedCheck(checkId)).lockedBankAccountId).toBe(bankAccountId);

    const wrong = await debitCheck({ checkId, date: DEPOSIT_DATE, bankAccountId: otherBank.id });
    expect(wrong).toEqual({
      success: false,
      error: `El e-cheq N° T735C-F7-OP se registró en ${PREFIX}Banco T735C-0001: debitalo en esa cuenta.`,
    });
    expect((await readCheck(checkId)).status).toBe('DELIVERED');

    const right = await debitCheck({ checkId, date: DEPOSIT_DATE, bankAccountId });
    expect(right.success).toBe(true);
    expect((await readCheck(checkId)).status).toBe('CASHED');
  });

  it('F7: e-cheq histórico de un RC → solo se deposita en su banco; uno con cuenta se deposita en cualquiera', async () => {
    const historicId = await confirmedReceiptCheck('T735C-F7-RC', 'ECHEQ');
    await prisma.check.update({ where: { id: historicId }, data: { accountId: null } });
    const otherBank = await prisma.bankAccount.findFirstOrThrow({
      where: { companyId, accountNumber: 'T735C-0002' },
      select: { id: true },
    });
    expect((await listedCheck(historicId)).lockedBankAccountId).toBe(bankAccountId);

    const wrong = await depositCheck({
      checkId: historicId,
      bankAccountId: otherBank.id,
      depositDate: DEPOSIT_DATE,
    });
    expect(wrong).toEqual({
      success: false,
      error: `El e-cheq N° T735C-F7-RC se registró en ${PREFIX}Banco T735C-0001: depositalo en esa cuenta.`,
    });
    expect((await readCheck(historicId)).status).toBe('PORTFOLIO');

    // Registrado en Valores a depositar: el depósito asienta, el banco es libre.
    const registeredId = await confirmedReceiptCheck('T735C-F7-RC2', 'ECHEQ');
    expect((await listedCheck(registeredId)).lockedBankAccountId).toBeNull();
    const ok = await depositCheck({
      checkId: registeredId,
      bankAccountId: otherBank.id,
      depositDate: DEPOSIT_DATE,
    });
    expect(ok).toEqual({ success: true, warnings: [] });
  });

  it('F11: anular un depositado con el depósito REGISTRADO → reversa del depósito + asiento de anulación', async () => {
    const checkId = await confirmedReceiptCheck('T735C-F11-DEP');
    expect(
      (await depositCheck({ checkId, bankAccountId, depositDate: DEPOSIT_DATE })).success
    ).toBe(true);
    const { depositEntryId } = await readCheck(checkId);
    if (!depositEntryId) throw new Error('El depósito no generó asiento');
    await postJournalEntryTx(prisma, { companyId, entryId: depositEntryId, userId: 'test-user' });
    const before = await bankBalance();

    const result = await voidCheck(checkId);
    expect(result).toEqual({ success: true, warnings: [] });

    const check = await readCheck(checkId);
    expect(check.status).toBe('VOIDED');
    const deposit = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: depositEntryId },
      select: { status: true, reversalEntryId: true },
    });
    expect(deposit.status).toBe('REVERSED');
    const reversal = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: deposit.reversalEntryId ?? '' },
      select: { status: true, originalEntryId: true },
    });
    expect(reversal).toEqual({ status: 'POSTED', originalEntryId: depositEntryId });
    expect(await entryLines(deposit.reversalEntryId)).toEqual([
      { accountId: valoresId, debit: 1000, credit: 0, customerId: null, supplierId: null },
      { accountId: bancoId, debit: 0, credit: 1000, customerId: null, supplierId: null },
    ]);
    expect(await entryLines(check.voidEntryId)).toEqual([
      { accountId: cobrarId, debit: 1000, credit: 0, customerId, supplierId: null },
      { accountId: valoresId, debit: 0, credit: 1000, customerId: null, supplierId: null },
    ]);
    expect(await bankBalance()).toBe(before - 1000);
  });

  it('F11: anular un propio entregado con cuenta → Debe Valores diferidos / Haber Cuentas por Pagar con el proveedor', async () => {
    const checkId = await confirmedOrderCheck('T735C-F11-OWN');
    const result = await voidCheck(checkId);
    expect(result).toEqual({ success: true, warnings: [] });

    const check = await readCheck(checkId);
    expect(check.status).toBe('VOIDED');
    expect(await entryLines(check.voidEntryId)).toEqual([
      { accountId: diferidosId, debit: 1000, credit: 0, customerId: null, supplierId: null },
      { accountId: pagarId, debit: 0, credit: 1000, customerId: null, supplierId },
    ]);
  });

  it('F11: anular un e-cheq propio entregado → Debe Banco / Haber Cuentas por Pagar con el proveedor', async () => {
    const checkId = await confirmedOrderCheck('T735C-F11-ECH', 'ECHEQ');
    const result = await voidCheck(checkId);
    expect(result).toEqual({ success: true, warnings: [] });

    const check = await readCheck(checkId);
    expect(check.status).toBe('VOIDED');
    expect(await entryLines(check.voidEntryId)).toEqual([
      { accountId: bancoId, debit: 1000, credit: 0, customerId: null, supplierId: null },
      { accountId: pagarId, debit: 0, credit: 1000, customerId: null, supplierId },
    ]);
  });
});
