/**
 * Tests de integración de la confirmación de una orden de pago cuando el
 * asiento no se puede generar (TSK-728), contra la base real. Espejo de
 * `receipts/receipt-journal-entry.integration.test.ts` con lo propio de OP:
 * retenciones emitidas, cheque propio y endosado, tarjeta de crédito, tarjeta
 * de un socio y OP de devolución a socio (sin asiento por diseño, con aviso).
 *
 * Se entra por los **server actions reales** (`createPaymentOrder`,
 * `createPartnerRepaymentOrder`, `confirmPaymentOrder`, `getPaymentOrderEntryPreview`).
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

import type { CreatePaymentOrderFormData } from '../../shared/validators';

// Frontera aislada: sesión, permisos, empresa activa, caché de Next y el
// marcador `server-only` que importa el loader de pre-validación.
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

// Código real de producción.
import {
  confirmPaymentOrder,
  createPartnerRepaymentOrder,
  createPaymentOrder,
  getPaymentOrderEntryPreview,
} from './actions.server';

const PREFIX = 'TSK728-OP-';
const ORDER_DATE = new Date('2026-03-10');

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type PaymentInput = CreatePaymentOrderFormData['payments'][number];
type WithholdingInput = CreatePaymentOrderFormData['withholdings'][number];

interface JournalLineRow {
  accountId: string;
  debit: number;
  credit: number;
}

describe.skipIf(!dbAvailable)(
  'integración e2e: asiento al confirmar una orden de pago (TSK-728)',
  () => {
    let companyId: string;
    let supplierId: string;
    let partnerId: string;

    let pagarId: string;
    let cajaId: string;
    let bancoId: string;
    let retIibbId: string;

    let cajaPrincipalId: string;
    let cajaPrincipalSessionId: string;
    let bancoConCuentaId: string;
    let bancoSinCuentaId: string;
    const BANCO_SIN_CUENTA_NUMBER = 'T728O-0002';

    let creditCardEmpresaId: string;
    let debitCardEmpresaId: string;
    let debitCardSocioId: string;
    let chequeTerceroId: string;
    /** Cuota del socio generada en el caso 8 y devuelta en el caso 10. */
    let partnerInstallmentId: string;

    let nextInvoiceNumber = 1;

    const cashPayment = (amount: string): PaymentInput => ({
      paymentMethod: 'CASH',
      amount,
      cashRegisterId: cajaPrincipalId,
    });
    const transferPayment = (amount: string, bankAccountId: string): PaymentInput => ({
      paymentMethod: 'TRANSFER',
      amount,
      bankAccountId,
    });
    const ownCheckPayment = (amount: string, checkNumber: string): PaymentInput => ({
      paymentMethod: 'CHECK',
      amount,
      checkOwnership: 'OWN',
      checkNumber,
      checkBankName: 'Banco Propio',
      checkIssueDate: ORDER_DATE,
      checkDueDate: new Date('2026-04-10'),
    });

    /** Factura de compra CONFIRMED de $1000 creada directo con Prisma (una por caso). */
    async function createConfirmedInvoice(): Promise<string> {
      const number = String(nextInvoiceNumber++).padStart(8, '0');
      const invoice = await prisma.purchaseInvoice.create({
        data: {
          companyId,
          supplierId,
          voucherType: 'FACTURA_A',
          pointOfSale: '9728',
          number,
          fullNumber: `9728-${number}`,
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
      return invoice.id;
    }

    /** OP en borrador por el `createPaymentOrder` real, pagando una factura de $1000. */
    async function createDraft(payments: PaymentInput[], withholdings: WithholdingInput[] = []) {
      const invoiceId = await createConfirmedInvoice();
      const result = await createPaymentOrder({
        supplierId,
        date: ORDER_DATE,
        notes: `${PREFIX}orden`,
        items: [{ invoiceId, amount: '1000' }],
        payments,
        withholdings,
      });
      return { id: result.id, invoiceId };
    }

    async function readOrder(id: string) {
      return prisma.paymentOrder.findUniqueOrThrow({
        where: { id },
        select: { status: true, journalEntryId: true, fullNumber: true },
      });
    }

    async function fetchEntryLines(orderId: string): Promise<JournalLineRow[]> {
      const order = await readOrder(orderId);
      if (!order.journalEntryId) throw new Error('La orden de pago no tiene asiento generado');
      const rows = await prisma.journalEntryLine.findMany({
        where: { entryId: order.journalEntryId },
        select: { accountId: true, debit: true, credit: true },
      });
      return rows.map((r) => ({
        accountId: r.accountId,
        debit: Number(r.debit),
        credit: Number(r.credit),
      }));
    }

    const setSettings = (data: {
      payablesAccountId?: string | null;
      lockedUntilDate?: Date | null;
    }) => prisma.accountingSettings.update({ where: { companyId }, data });

    beforeAll(async () => {
      const company = await prisma.company.create({
        data: { name: `${PREFIX}Empresa`, isActive: true },
      });
      companyId = company.id;

      const mk = (
        code: string,
        name: string,
        type: 'ASSET' | 'LIABILITY',
        nature: 'DEBIT' | 'CREDIT'
      ) =>
        prisma.account.create({
          data: { companyId, code, name: `${PREFIX}${name}`, type, nature },
        });

      const [pagar, caja, banco, retIibb] = await Promise.all([
        mk('T728O-PAGAR', 'Cuentas por Pagar', 'LIABILITY', 'CREDIT'),
        mk('T728O-CAJA', 'Caja', 'ASSET', 'DEBIT'),
        mk('T728O-BANCO', 'Banco', 'ASSET', 'DEBIT'),
        mk('T728O-RET-IIBB', 'Ret IIBB Emitida', 'LIABILITY', 'CREDIT'),
      ]);
      pagarId = pagar.id;
      cajaId = caja.id;
      bancoId = banco.id;
      retIibbId = retIibb.id;

      await prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01'),
          fiscalYearEnd: new Date('2026-12-31'),
          payablesAccountId: pagarId,
          withholdingIibbEmittedAccountId: retIibbId,
          // "Caja por Defecto" y "Banco por Defecto" vacías a propósito.
          requireCostCenter: false,
        },
      });

      const supplier = await prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}PROV`,
          businessName: `${PREFIX}Proveedor`,
          taxId: '30500000001',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
        select: { id: true },
      });
      supplierId = supplier.id;

      const register = await prisma.cashRegister.create({
        data: {
          companyId,
          code: 'T728O-CAJA1',
          name: `${PREFIX}Caja principal`,
          accountId: cajaId,
          createdBy: 'test',
        },
        select: { id: true },
      });
      cajaPrincipalId = register.id;
      const session = await prisma.cashRegisterSession.create({
        data: {
          companyId,
          cashRegisterId: register.id,
          sessionNumber: 1,
          status: 'OPEN',
          openedBy: 'test',
        },
        select: { id: true },
      });
      cajaPrincipalSessionId = session.id;

      const mkBank = (bankName: string, accountNumber: string, accountId: string | null) =>
        prisma.bankAccount.create({
          data: {
            companyId,
            bankName: `${PREFIX}${bankName}`,
            accountNumber,
            accountType: 'CHECKING',
            balance: 100000,
            status: 'ACTIVE',
            accountId,
          },
          select: { id: true },
        });
      const [conCuenta, sinCuenta] = await Promise.all([
        mkBank('Banco con cuenta', 'T728O-0001', bancoId),
        mkBank('Banco sin cuenta', BANCO_SIN_CUENTA_NUMBER, null),
      ]);
      bancoConCuentaId = conCuenta.id;
      bancoSinCuentaId = sinCuenta.id;

      const partner = await prisma.partner.create({
        data: { companyId, name: `${PREFIX}Socia`, createdBy: 'test' },
        select: { id: true },
      });
      partnerId = partner.id;

      const mkCard = (
        name: string,
        cardType: 'DEBIT' | 'CREDIT',
        ownerType: 'COMPANY' | 'PARTNER'
      ) =>
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
      const [creditEmpresa, debitEmpresa, debitSocio] = await Promise.all([
        mkCard('Visa Empresa', 'CREDIT', 'COMPANY'),
        mkCard('Débito Empresa', 'DEBIT', 'COMPANY'),
        mkCard('Débito Socia', 'DEBIT', 'PARTNER'),
      ]);
      creditCardEmpresaId = creditEmpresa.id;
      debitCardEmpresaId = debitEmpresa.id;
      debitCardSocioId = debitSocio.id;

      const cheque = await prisma.check.create({
        data: {
          companyId,
          type: 'THIRD_PARTY',
          status: 'PORTFOLIO',
          checkNumber: 'T728O-CH-001',
          bankName: 'Banco del Cliente',
          amount: 1000,
          issueDate: new Date('2026-02-01'),
          dueDate: new Date('2026-05-01'),
          drawerName: `${PREFIX}Cliente librador`,
          createdBy: 'test',
        },
        select: { id: true },
      });
      chequeTerceroId = cheque.id;

      vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
      vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
    });

    afterAll(async () => {
      // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
      if (companyId) {
        await prisma.paymentOrderInstallment.deleteMany({ where: { companyId } });
        await prisma.cashflowProjection.deleteMany({ where: { companyId } });
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
        await prisma.journalEntry.deleteMany({ where: { companyId } });
        await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
        await prisma.supplier.deleteMany({ where: { companyId } });
        await prisma.accountingSettings.deleteMany({ where: { companyId } });
        await prisma.account.deleteMany({ where: { companyId } });
        await prisma.company.deleteMany({ where: { id: companyId } });
      }

      const [remainingCompanies, remainingAccounts, remainingOrders] = await Promise.all([
        prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
        prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
        prisma.paymentOrder.count({ where: { notes: { startsWith: PREFIX } } }),
      ]);
      expect(remainingCompanies).toBe(0);
      expect(remainingAccounts).toBe(0);
      expect(remainingOrders).toBe(0);

      await prisma.$disconnect();
    });

    it('caso 1: efectivo → confirma sin avisos; Debe Pagar / Haber Caja; factura PAID; egreso de caja', async () => {
      const { id, invoiceId } = await createDraft([cashPayment('1000')]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.id).toBe(id);
      expect(result.warnings).toEqual([]);

      const order = await readOrder(id);
      expect(order.status).toBe('CONFIRMED');
      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(1000);
      expect(lines.find((l) => l.accountId === cajaId)?.credit).toBe(1000);

      const invoice = await prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true },
      });
      expect(invoice.status).toBe('PAID');

      const movement = await prisma.cashMovement.findFirst({
        where: { cashRegisterId: cajaPrincipalId, reference: order.fullNumber },
        select: { type: true, amount: true },
      });
      expect(movement?.type).toBe('EXPENSE');
      expect(Number(movement?.amount)).toBe(1000);
    });

    it('caso 2: transferencia a banco sin cuenta ni "Banco por Defecto" → bloqueado sin mover el banco', async () => {
      const { id } = await createDraft([transferPayment('1000', bancoSinCuentaId)]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain(
        `la cuenta bancaria "${PREFIX}Banco sin cuenta ${BANCO_SIN_CUENTA_NUMBER}"`
      );
      expect(result.error).toContain('"Banco por Defecto"');

      const order = await readOrder(id);
      expect(order.status).toBe('DRAFT');
      expect(order.journalEntryId).toBeNull();
      const bank = await prisma.bankAccount.findUniqueOrThrow({
        where: { id: bancoSinCuentaId },
        select: { balance: true, movements: { select: { id: true } } },
      });
      expect(Number(bank.balance)).toBe(100000);
      expect(bank.movements).toHaveLength(0);
    });

    it('caso 3: sin "Cuentas por Pagar" en Ajustes → bloqueado con el label exacto', async () => {
      const { id } = await createDraft([cashPayment('1000')]);
      await setSettings({ payablesAccountId: null });
      try {
        const result = await confirmPaymentOrder(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain('falta configurar "Cuentas por Pagar"');
        expect(result.error).toContain('en Contabilidad → Configuración');
        expect((await readOrder(id)).status).toBe('DRAFT');
      } finally {
        await setSettings({ payablesAccountId: pagarId });
      }
    });

    it('caso 4: retención sin cuenta emitida → bloqueado; con la configurada → Haber Ret + Haber Caja / Debe Pagar', async () => {
      const withholding = (taxType: 'GANANCIAS' | 'IIBB'): WithholdingInput => ({
        taxType,
        rate: '10',
        amount: '100',
      });

      const sinCuenta = await createDraft([cashPayment('900')], [withholding('GANANCIAS')]);
      const blocked = await confirmPaymentOrder(sinCuenta.id);
      expect(blocked.success).toBe(false);
      if (blocked.success) return;
      expect(blocked.error).toContain('"Ret. Ganancias Emitida"');
      expect((await readOrder(sinCuenta.id)).status).toBe('DRAFT');

      const conCuenta = await createDraft([cashPayment('900')], [withholding('IIBB')]);
      const ok = await confirmPaymentOrder(conCuenta.id);
      expect(ok.success).toBe(true);
      const lines = await fetchEntryLines(conCuenta.id);
      expect(lines).toHaveLength(3);
      expect(lines.find((l) => l.accountId === retIibbId)?.credit).toBe(100);
      expect(lines.find((l) => l.accountId === cajaId)?.credit).toBe(900);
      expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(1000);
    });

    it('caso 5: cheque propio + efectivo → confirma con aviso; asiento de dos líneas por el importe contabilizable; cheque OWN entregado', async () => {
      const { id } = await createDraft([ownCheckPayment('400', 'T728O-OWN-1'), cashPayment('600')]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Cheque N° T728O-OWN-1');
      expect(result.warnings[0]).toContain('no genera línea');
      expect(result.warnings[0]).toContain('Cuentas por Pagar');

      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(600);
      expect(lines.find((l) => l.accountId === cajaId)?.credit).toBe(600);

      const check = await prisma.check.findFirst({
        where: { companyId, checkNumber: 'T728O-OWN-1' },
        select: { type: true, status: true },
      });
      expect(check?.type).toBe('OWN');
      expect(check?.status).toBe('DELIVERED');
    });

    it('caso 6: solo cheque de tercero endosado → bloqueado por una sola línea; el cheque sigue en cartera', async () => {
      const { id } = await createDraft([
        {
          paymentMethod: 'CHECK',
          amount: '1000',
          checkOwnership: 'THIRD_PARTY',
          endorsedCheckId: chequeTerceroId,
        },
      ]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('una sola línea');

      expect((await readOrder(id)).status).toBe('DRAFT');
      const check = await prisma.check.findUniqueOrThrow({
        where: { id: chequeTerceroId },
        select: { status: true },
      });
      expect(check.status).toBe('PORTFOLIO');
    });

    it('caso 7: solo tarjeta de crédito de la empresa en 3 cuotas → bloqueado; sin cuotas generadas', async () => {
      const { id } = await createDraft([
        {
          paymentMethod: 'CREDIT_CARD',
          amount: '1000',
          cardId: creditCardEmpresaId,
          installmentsCount: 3,
        },
      ]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('una sola línea');
      expect(result.error).toContain(`Tarjeta de Crédito (${PREFIX}Visa Empresa)`);

      expect((await readOrder(id)).status).toBe('DRAFT');
      const installments = await prisma.paymentOrderInstallment.count({
        where: { paymentOrderId: id },
      });
      expect(installments).toBe(0);
    });

    it('caso 8: tarjeta de débito de un socio (con banco cargado) + efectivo → aviso; el asiento no toca el banco; cuota del socio creada', async () => {
      const { id } = await createDraft([
        {
          paymentMethod: 'DEBIT_CARD',
          amount: '400',
          cardId: debitCardSocioId,
          bankAccountId: bancoConCuentaId,
        },
        cashPayment('600'),
      ]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('tarjeta es de un socio');

      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(600);
      expect(lines.find((l) => l.accountId === cajaId)?.credit).toBe(600);
      expect(lines.find((l) => l.accountId === bancoId)).toBeUndefined();

      const installment = await prisma.paymentOrderInstallment.findFirstOrThrow({
        where: { paymentOrderId: id },
        select: { id: true, partnerId: true, status: true, amount: true },
      });
      expect(installment.partnerId).toBe(partnerId);
      expect(installment.status).toBe('PENDING');
      expect(Number(installment.amount)).toBe(400);
      partnerInstallmentId = installment.id;

      const bankMovements = await prisma.bankMovement.count({
        where: { bankAccountId: bancoConCuentaId },
      });
      expect(bankMovements).toBe(0);
    });

    it('caso 9: tarjeta de débito de la empresa sin banco → bloqueado por la pre-validación', async () => {
      const { id } = await createDraft([
        { paymentMethod: 'DEBIT_CARD', amount: '1000', cardId: debitCardEmpresaId },
      ]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('no tiene cuenta bancaria asignada');
      expect((await readOrder(id)).status).toBe('DRAFT');
    });

    it('caso 10: OP de devolución a socio en efectivo → confirma con el aviso, sin asiento; egreso de caja; cuota PAID', async () => {
      const created = await createPartnerRepaymentOrder({
        partnerId,
        date: ORDER_DATE,
        notes: `${PREFIX}devolución`,
        installmentIds: [partnerInstallmentId],
        payments: [cashPayment('400')],
      });

      const result = await confirmPaymentOrder(created.id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.warnings).toContain(
        'Las órdenes de pago a socios no generan asiento contable.'
      );

      const order = await readOrder(created.id);
      expect(order.status).toBe('CONFIRMED');
      expect(order.journalEntryId).toBeNull();

      const movement = await prisma.cashMovement.findFirst({
        where: { cashRegisterId: cajaPrincipalId, reference: order.fullNumber },
        select: { type: true, amount: true },
      });
      expect(movement?.type).toBe('EXPENSE');
      expect(Number(movement?.amount)).toBe(400);

      const installment = await prisma.paymentOrderInstallment.findUniqueOrThrow({
        where: { id: partnerInstallmentId },
        select: { status: true },
      });
      expect(installment.status).toBe('PAID');
    });

    it('caso 11: caja sin sesión abierta → error legible con el nombre de la caja', async () => {
      const { id } = await createDraft([cashPayment('1000')]);
      await prisma.cashRegisterSession.update({
        where: { id: cajaPrincipalSessionId },
        data: { status: 'CLOSED', closedAt: new Date(), closedBy: 'test' },
      });
      try {
        const result = await confirmPaymentOrder(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toBe(`No hay sesión abierta para la caja "${PREFIX}Caja principal"`);
        expect((await readOrder(id)).status).toBe('DRAFT');
      } finally {
        await prisma.cashRegisterSession.update({
          where: { id: cajaPrincipalSessionId },
          data: { status: 'OPEN', closedAt: null, closedBy: null },
        });
      }
    });

    it('caso 12: período cerrado → error legible y transacción revertida', async () => {
      const { id } = await createDraft([cashPayment('1000')]);
      await setSettings({ lockedUntilDate: new Date('2026-12-31') });
      try {
        const result = await confirmPaymentOrder(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain('período está cerrado');

        const order = await readOrder(id);
        expect(order.status).toBe('DRAFT');
        const movements = await prisma.cashMovement.count({
          where: { cashRegisterId: cajaPrincipalId, reference: order.fullNumber },
        });
        expect(movements).toBe(0);
      } finally {
        await setSettings({ lockedUntilDate: null });
      }
    });

    it('caso 13: confirmar dos veces → "Orden de pago no encontrada o ya confirmada"', async () => {
      const { id } = await createDraft([cashPayment('1000')]);
      expect((await confirmPaymentOrder(id)).success).toBe(true);

      const again = await confirmPaymentOrder(id);
      expect(again.success).toBe(false);
      if (again.success) return;
      expect(again.error).toBe('Orden de pago no encontrada o ya confirmada');
    });

    it('caso 14: getPaymentOrderEntryPreview anticipa el aviso del cheque y el error del banco', async () => {
      const conCheque = await createDraft([
        ownCheckPayment('400', 'T728O-OWN-2'),
        cashPayment('600'),
      ]);
      const preview = await getPaymentOrderEntryPreview(conCheque.id);
      expect(preview.error).toBeNull();
      expect(preview.warnings).toHaveLength(1);
      expect(preview.warnings[0]).toMatch(/Cheque N° T728O-OWN-2/);
      expect(preview.accounts.map((a) => a.concept)).toEqual([
        'Cuentas por Pagar',
        `Caja "${PREFIX}Caja principal"`,
      ]);
      expect((await readOrder(conCheque.id)).status).toBe('DRAFT');

      const sinCuenta = await createDraft([transferPayment('1000', bancoSinCuentaId)]);
      const blocked = await getPaymentOrderEntryPreview(sinCuenta.id);
      expect(blocked.error).toMatch(/Banco sin cuenta/);
      expect(blocked.warnings).toEqual([]);
      expect(blocked.accounts).toEqual([]);
    });
  }
);
