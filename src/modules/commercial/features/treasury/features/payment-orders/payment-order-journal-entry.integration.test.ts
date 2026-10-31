/**
 * Tests de integración de la confirmación de una orden de pago cuando el
 * asiento no se puede generar (TSK-728), contra la base real. Espejo de
 * `receipts/receipt-journal-entry.integration.test.ts` con lo propio de OP:
 * retenciones emitidas, cheque propio y endosado, tarjeta de crédito, tarjeta
 * de un socio y OP de devolución a socio. Desde TSK-735 cheques y tarjetas tienen
 * cuenta (asiento completo, sin avisos) y la devolución a socio genera asiento.
 *
 * Se entra por los **server actions reales** (`createPaymentOrder`,
 * `createPartnerRepaymentOrder`, `confirmPaymentOrder`, `getPaymentOrderEntryPreview`).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
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

import {
  closeMonthForTest,
  readEntryPeriod,
  readLastEntryNumber,
} from '@/modules/accounting/shared/test-utils/period-test-helpers';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

// Código real de producción.
import { paymentOrderEffectImpedimentsTx } from '@/modules/commercial/shared/effects/payment-order.server';
import { debitCheck, voidCheck } from '../checks/actions.server';
import {
  confirmPaymentOrder,
  createPartnerRepaymentOrder,
  createPaymentOrder,
  getPaymentOrder,
  getPaymentOrderEntryPreview,
  updatePaymentOrder,
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
  customerId: string | null;
  supplierId: string | null;
}

describe.skipIf(!dbAvailable)(
  'integración e2e: asiento al confirmar una orden de pago (TSK-728)',
  () => {
    let companyId: string;
    let supplierId: string;
    let partnerId: string;
    let customerId: string;

    let pagarId: string;
    let cajaId: string;
    let bancoId: string;
    let retIibbId: string;
    let cobrarId: string;
    /** TSK-735: Valores a depositar, Valores diferidos a pagar, Tarjetas a pagar, Deudas con socios. */
    let valoresId: string;
    let diferidosId: string;
    let tarjetasId: string;
    let sociosId: string;

    let cajaPrincipalId: string;
    let cajaPrincipalSessionId: string;
    let bancoConCuentaId: string;
    let bancoSinCuentaId: string;
    const BANCO_SIN_CUENTA_NUMBER = 'T728O-0002';

    let creditCardEmpresaId: string;
    let debitCardEmpresaId: string;
    let debitCardSocioId: string;
    let chequeTerceroId: string;
    /** Cheques de tercero de antes de TSK-735 (sin cuenta registrada). */
    let chequeHistoricoId: string;
    let echeqHistoricoId: string;
    let chequeConCajaId: string;
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

    let nextReceiptNumber = 1;
    /** Pago de $1000 de un RC histórico (confirmado sin asiento), con la caja/banco que guardó. */
    async function historicReceiptPayment(payment: {
      paymentMethod: 'CHECK' | 'ECHEQ';
      cashRegisterId?: string;
      bankAccountId?: string;
    }): Promise<string> {
      const number = nextReceiptNumber++;
      const receipt = await prisma.receipt.create({
        data: {
          companyId,
          customerId,
          number,
          fullNumber: `R-9735${number}`,
          date: new Date('2026-02-01'),
          totalAmount: 1000,
          status: 'CONFIRMED',
          notes: `${PREFIX}recibo histórico`,
          createdBy: 'test',
          payments: { create: { amount: 1000, ...payment } },
        },
        select: { payments: { select: { id: true } } },
      });
      return receipt.payments[0].id;
    }

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
        select: { accountId: true, debit: true, credit: true, customerId: true, supplierId: true },
      });
      return rows.map((r) => ({
        accountId: r.accountId,
        debit: Number(r.debit),
        credit: Number(r.credit),
        customerId: r.customerId,
        supplierId: r.supplierId,
      }));
    }

    const setSettings = (data: {
      payablesAccountId?: string | null;
      partnerDebtsAccountId?: string | null;
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

      const [pagar, caja, banco, retIibb, cobrar, valores, diferidos, tarjetas, socios] =
        await Promise.all([
          mk('T728O-PAGAR', 'Cuentas por Pagar', 'LIABILITY', 'CREDIT'),
          mk('T728O-CAJA', 'Caja', 'ASSET', 'DEBIT'),
          mk('T728O-BANCO', 'Banco', 'ASSET', 'DEBIT'),
          mk('T728O-RET-IIBB', 'Ret IIBB Emitida', 'LIABILITY', 'CREDIT'),
          mk('T728O-COBRAR', 'Cuentas por Cobrar', 'ASSET', 'DEBIT'),
          // TSK-735: cuentas de cheques y tarjetas (hojas).
          mk('T735-VAD', 'Valores a depositar', 'ASSET', 'DEBIT'),
          mk('T735-VDP', 'Valores diferidos a pagar', 'LIABILITY', 'CREDIT'),
          mk('T735-TCP', 'Tarjetas de crédito a pagar', 'LIABILITY', 'CREDIT'),
          mk('T735-DSO', 'Deudas con socios', 'LIABILITY', 'CREDIT'),
        ]);
      pagarId = pagar.id;
      cajaId = caja.id;
      bancoId = banco.id;
      retIibbId = retIibb.id;
      cobrarId = cobrar.id;
      valoresId = valores.id;
      diferidosId = diferidos.id;
      tarjetasId = tarjetas.id;
      sociosId = socios.id;

      await prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01'),
          fiscalYearEnd: new Date('2026-12-31'),
          payablesAccountId: pagarId,
          receivablesAccountId: cobrarId,
          withholdingIibbEmittedAccountId: retIibbId,
          checksReceivedAccountId: valoresId,
          checksPayableAccountId: diferidosId,
          creditCardsPayableAccountId: tarjetasId,
          partnerDebtsAccountId: sociosId,
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

      const customer = await prisma.contractor.create({
        data: { companyId, name: `${PREFIX}Cliente` },
        select: { id: true },
      });
      customerId = customer.id;

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

      const mkThirdPartyCheck = (
        checkNumber: string,
        extra: {
          accountId?: string;
          isElectronic?: boolean;
          bankAccountId?: string;
          receiptPaymentId?: string;
        } = {}
      ) =>
        prisma.check.create({
          data: {
            companyId,
            type: 'THIRD_PARTY',
            status: 'PORTFOLIO',
            checkNumber,
            bankName: 'Banco del Cliente',
            amount: 1000,
            issueDate: new Date('2026-02-01'),
            dueDate: new Date('2026-05-01'),
            drawerName: `${PREFIX}Cliente librador`,
            customerId,
            createdBy: 'test',
            ...extra,
          },
          select: { id: true },
        });
      // Ingresó por un RC de TSK-735: registrado en Valores a depositar.
      chequeTerceroId = (await mkThirdPartyCheck('T728O-CH-001', { accountId: valoresId })).id;
      // Históricos: ingresaron por un RC de antes de TSK-735 (sin cuenta registrada).
      chequeHistoricoId = (
        await mkThirdPartyCheck('T735-CH-HIST', {
          receiptPaymentId: await historicReceiptPayment({ paymentMethod: 'CHECK' }),
        })
      ).id;
      echeqHistoricoId = (
        await mkThirdPartyCheck('T735-ECH-HIST', {
          isElectronic: true,
          bankAccountId: bancoConCuentaId,
          receiptPaymentId: await historicReceiptPayment({
            paymentMethod: 'ECHEQ',
            bankAccountId: bancoConCuentaId,
          }),
        })
      ).id;
      // Revisión final: físico histórico cuyo pago del RC tenía la caja arrastrada de otro medio.
      chequeConCajaId = (
        await mkThirdPartyCheck('T735-CH-CAJA', {
          receiptPaymentId: await historicReceiptPayment({
            paymentMethod: 'CHECK',
            cashRegisterId: cajaPrincipalId,
          }),
        })
      ).id;

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
        // items/payments/withholdings caen en cascada con la OP (y los pagos con el RC).
        await prisma.paymentOrder.deleteMany({ where: { companyId } });
        await prisma.receipt.deleteMany({ where: { companyId } });
        await prisma.card.deleteMany({ where: { companyId } });
        await prisma.partner.deleteMany({ where: { companyId } });
        await prisma.journalEntry.deleteMany({ where: { companyId } });
        await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
        await prisma.supplier.deleteMany({ where: { companyId } });
        await prisma.contractor.deleteMany({ where: { companyId } });
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

    it('caso 5 (TSK-735): cheque propio + efectivo → sin avisos; Debe Pagar 1000 / Haber Valores diferidos a pagar 400 + Caja 600; cheque OWN con su cuenta', async () => {
      const { id } = await createDraft([ownCheckPayment('400', 'T728O-OWN-1'), cashPayment('600')]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.warnings).toEqual([]);

      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(3);
      expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(1000);
      expect(lines.find((l) => l.accountId === diferidosId)?.credit).toBe(400);
      expect(lines.find((l) => l.accountId === cajaId)?.credit).toBe(600);

      const check = await prisma.check.findFirst({
        where: { companyId, checkNumber: 'T728O-OWN-1' },
        select: { type: true, status: true, accountId: true },
      });
      expect(check?.type).toBe('OWN');
      expect(check?.status).toBe('DELIVERED');
      expect(check?.accountId).toBe(diferidosId);
    });

    it('caso 6 (TSK-735): solo cheque de tercero endosado con cuenta → confirma; Debe Pagar / Haber Valores a depositar', async () => {
      const { id } = await createDraft([
        {
          paymentMethod: 'CHECK',
          amount: '1000',
          checkOwnership: 'THIRD_PARTY',
          endorsedCheckId: chequeTerceroId,
        },
      ]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.warnings).toEqual([]);

      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(1000);
      expect(lines.find((l) => l.accountId === valoresId)).toMatchObject({
        credit: 1000,
        customerId: null,
      });
      const check = await prisma.check.findUniqueOrThrow({
        where: { id: chequeTerceroId },
        select: { status: true, accountId: true },
      });
      expect(check).toEqual({ status: 'ENDORSED', accountId: valoresId });
    });

    it('TSK-735: endoso de un cheque histórico (sin cuenta) → Haber Cuentas por Cobrar con el cliente del cheque', async () => {
      const { id } = await createDraft([
        {
          paymentMethod: 'CHECK',
          amount: '1000',
          checkOwnership: 'THIRD_PARTY',
          endorsedCheckId: chequeHistoricoId,
        },
      ]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.warnings).toEqual([]);

      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(1000);
      expect(lines.find((l) => l.accountId === cobrarId)).toMatchObject({
        credit: 1000,
        customerId,
      });
    });

    it('TSK-735: e-cheq histórico endosado → la vista previa nombra el banco del cheque, no un banco vacío', async () => {
      const { id } = await createDraft([
        {
          paymentMethod: 'ECHEQ',
          amount: '1000',
          checkOwnership: 'THIRD_PARTY',
          endorsedCheckId: echeqHistoricoId,
        },
      ]);

      const preview = await getPaymentOrderEntryPreview(id);
      expect(preview.error).toBeNull();
      expect(preview.accounts.map((a) => a.concept)).toEqual([
        'Cuentas por Pagar',
        `Banco "${PREFIX}Banco con cuenta T728O-0001"`,
      ]);
    });

    it('TSK-735: cheque endosado que ya no existe → bloqueado en la vista previa y al confirmar', async () => {
      const { id } = await createDraft([
        {
          paymentMethod: 'CHECK',
          amount: '1000',
          checkOwnership: 'THIRD_PARTY',
          endorsedCheckId: randomUUID(),
        },
      ]);
      const expected = `No se puede confirmar la orden de pago ${(await readOrder(id)).fullNumber}: el cheque endosado ya no existe en Tesorería → Cheques.`;

      expect((await getPaymentOrderEntryPreview(id)).error).toBe(expected);
      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe(expected);
      expect((await readOrder(id)).status).toBe('DRAFT');
    });

    /** Cheque de tercero en cartera creado directo (cargado a mano si no se pasa recibo ni cuenta). */
    const portfolioCheck = (checkNumber: string, amount: number, accountId?: string) =>
      prisma.check.create({
        data: {
          companyId,
          type: 'THIRD_PARTY',
          status: 'PORTFOLIO',
          checkNumber,
          bankName: 'Banco del Cliente',
          amount,
          issueDate: new Date('2026-02-01'),
          dueDate: new Date('2026-05-01'),
          drawerName: `${PREFIX}Cliente librador`,
          customerId,
          accountId,
          createdBy: 'test',
        },
        select: { id: true },
      });

    const endorsedPayment = (amount: string, endorsedCheckId: string): PaymentInput => ({
      paymentMethod: 'CHECK',
      amount,
      checkOwnership: 'THIRD_PARTY',
      endorsedCheckId,
    });

    it('revisión final F1: endoso de un cheque cargado a mano → omitido con aviso; Proveedores queda abierto por ese importe', async () => {
      const manual = await portfolioCheck('T735-CH-MANUAL', 400);
      const { id } = await createDraft([endorsedPayment('400', manual.id), cashPayment('600')]);
      const warning =
        'Cheque N° T735-CH-MANUAL por $\u00a0400,00 no genera línea en el asiento contable: el ' +
        'cheque se cargó a mano en Tesorería y no tiene asiento de origen. Ese importe queda ' +
        'pendiente en Cuentas por Pagar hasta que se regularice.';

      const preview = await getPaymentOrderEntryPreview(id);
      expect(preview.error).toBeNull();
      expect(preview.warnings).toEqual([warning]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.warnings).toEqual([warning]);

      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(600);
      expect(lines.find((l) => l.accountId === cajaId)?.credit).toBe(600);
      expect(lines.some((l) => l.accountId === cobrarId || l.accountId === valoresId)).toBe(false);
      const check = await prisma.check.findUniqueOrThrow({
        where: { id: manual.id },
        select: { status: true },
      });
      expect(check.status).toBe('ENDORSED');
    });

    it('revisión final F6: endoso de un físico histórico cuyo pago del RC tenía caja → Haber esa caja (el RC viejo la debitó)', async () => {
      const { id } = await createDraft([endorsedPayment('1000', chequeConCajaId)]);

      const preview = await getPaymentOrderEntryPreview(id);
      expect(preview.error).toBeNull();
      expect(preview.accounts.map((a) => a.concept)).toEqual([
        'Cuentas por Pagar',
        `Caja "${PREFIX}Caja principal"`,
      ]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.warnings).toEqual([]);
      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(1000);
      expect(lines.find((l) => l.accountId === cajaId)?.credit).toBe(1000);
    });

    it('revisión final F2: el pago con un cheque endosado por otro importe → bloqueado en la vista previa y al confirmar', async () => {
      const check = await portfolioCheck('T735-CH-F2', 1000, valoresId);
      const { id } = await createDraft([endorsedPayment('900', check.id), cashPayment('100')]);
      const expected =
        `No se puede confirmar la orden de pago ${(await readOrder(id)).fullNumber}: el pago con ` +
        'el cheque endosado N° T735-CH-F2 es de $\u00a0900,00 pero el cheque es de ' +
        '$\u00a01.000,00. Un cheque se endosa por su importe completo.';

      expect((await getPaymentOrderEntryPreview(id)).error).toBe(expected);
      const result = await confirmPaymentOrder(id);
      expect(result).toEqual({ success: false, error: expected });
      expect((await readOrder(id)).status).toBe('DRAFT');
      const after = await prisma.check.findUniqueOrThrow({
        where: { id: check.id },
        select: { status: true },
      });
      expect(after.status).toBe('PORTFOLIO');
    });

    it('revisión final F9: borrador viejo con un cheque propio sin número → bloqueado, no se crea un cheque fantasma', async () => {
      const { id } = await createDraft([ownCheckPayment('400', 'T735-F9-OWN'), cashPayment('600')]);
      await prisma.paymentOrderPayment.updateMany({
        where: { paymentOrderId: id, paymentMethod: 'CHECK' },
        data: { checkNumber: null },
      });
      const expected =
        `No se puede confirmar la orden de pago ${(await readOrder(id)).fullNumber}: el pago con ` +
        'cheque de $\u00a0400,00 no tiene número de cheque. Editá el comprobante y cargalo.';

      expect((await getPaymentOrderEntryPreview(id)).error).toBe(expected);
      expect(await confirmPaymentOrder(id)).toEqual({ success: false, error: expected });
      expect((await readOrder(id)).status).toBe('DRAFT');
    });

    it('revisión final F6: crear y editar una OP no guarda la caja/banco arrastrados de otro medio', async () => {
      const dragged = { cashRegisterId: cajaPrincipalId, bankAccountId: bancoConCuentaId };
      const { id, invoiceId } = await createDraft([
        { ...ownCheckPayment('400', 'T735-F6-OWN'), ...dragged },
        {
          paymentMethod: 'CREDIT_CARD',
          amount: '600',
          cardId: creditCardEmpresaId,
          installmentsCount: 1,
          ...dragged,
        },
      ]);
      const funds = () =>
        prisma.paymentOrderPayment.findMany({
          where: { paymentOrderId: id },
          select: { paymentMethod: true, cashRegisterId: true, bankAccountId: true },
          orderBy: { paymentMethod: 'asc' },
        });
      expect(await funds()).toEqual([
        { paymentMethod: 'CHECK', cashRegisterId: null, bankAccountId: null },
        { paymentMethod: 'CREDIT_CARD', cashRegisterId: null, bankAccountId: null },
      ]);

      const updated = await updatePaymentOrder(id, {
        supplierId,
        date: ORDER_DATE,
        notes: `${PREFIX}orden`,
        items: [{ invoiceId, amount: '1000' }],
        payments: [
          { ...ownCheckPayment('400', 'T735-F6-OWN'), ...dragged },
          { ...transferPayment('600', bancoConCuentaId), cashRegisterId: cajaPrincipalId },
        ],
        withholdings: [],
      });
      expect(updated.success).toBe(true);
      expect(await funds()).toEqual([
        { paymentMethod: 'CHECK', cashRegisterId: null, bankAccountId: null },
        { paymentMethod: 'TRANSFER', cashRegisterId: null, bankAccountId: bancoConCuentaId },
      ]);
    });

    it('caso 7 (TSK-735): solo tarjeta de crédito de la empresa en 3 cuotas → confirma; Haber Tarjetas de crédito a pagar; 3 cuotas con su cuenta', async () => {
      const { id } = await createDraft([
        {
          paymentMethod: 'CREDIT_CARD',
          amount: '1000',
          cardId: creditCardEmpresaId,
          installmentsCount: 3,
        },
      ]);

      const result = await confirmPaymentOrder(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.warnings).toEqual([]);

      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(1000);
      expect(lines.find((l) => l.accountId === tarjetasId)?.credit).toBe(1000);

      const installments = await prisma.paymentOrderInstallment.findMany({
        where: { paymentOrderId: id },
        select: { accountId: true, amount: true, partnerId: true },
        orderBy: { number: 'asc' },
      });
      expect(installments.map((i) => [i.accountId, Number(i.amount), i.partnerId])).toEqual([
        [tarjetasId, 333.34, null],
        [tarjetasId, 333.33, null],
        [tarjetasId, 333.33, null],
      ]);
    });

    it('caso 8 (TSK-735): tarjeta de débito de un socio (con banco cargado) + efectivo → sin avisos; Haber Deudas con socios; el asiento no toca el banco; cuota del socio con su cuenta', async () => {
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
      expect(result.warnings).toEqual([]);

      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(3);
      expect(lines.find((l) => l.accountId === pagarId)?.debit).toBe(1000);
      expect(lines.find((l) => l.accountId === sociosId)?.credit).toBe(400);
      expect(lines.find((l) => l.accountId === cajaId)?.credit).toBe(600);
      expect(lines.find((l) => l.accountId === bancoId)).toBeUndefined();

      const installment = await prisma.paymentOrderInstallment.findFirstOrThrow({
        where: { paymentOrderId: id },
        select: { id: true, partnerId: true, status: true, amount: true, accountId: true },
      });
      expect(installment.partnerId).toBe(partnerId);
      expect(installment.status).toBe('PENDING');
      expect(Number(installment.amount)).toBe(400);
      expect(installment.accountId).toBe(sociosId);
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

    it('caso 10 (TSK-735): OP de devolución a socio en efectivo → asiento Debe Deudas con socios / Haber Caja, sin avisos; egreso de caja; cuota PAID', async () => {
      const created = await createPartnerRepaymentOrder({
        partnerId,
        date: ORDER_DATE,
        notes: `${PREFIX}devolución`,
        installmentIds: [partnerInstallmentId],
        payments: [cashPayment('400')],
      });

      const preview = await getPaymentOrderEntryPreview(created.id);
      expect(preview.error).toBeNull();
      expect(preview.accounts.map((a) => a.concept)).toEqual([
        'Cuotas devueltas al socio',
        `Caja "${PREFIX}Caja principal"`,
      ]);

      const result = await confirmPaymentOrder(created.id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.warnings).toEqual([]);

      const order = await readOrder(created.id);
      expect(order.status).toBe('CONFIRMED');
      expect(order.journalEntryId).not.toBeNull();
      const lines = await fetchEntryLines(created.id);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountId === sociosId)).toMatchObject({
        debit: 400,
        supplierId: null,
      });
      expect(lines.find((l) => l.accountId === cajaId)?.credit).toBe(400);
      const entry = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: order.journalEntryId! },
        select: { description: true, status: true, createdBy: true },
      });
      expect(entry).toEqual({
        description: `Devolución a socio ${PREFIX}Socia - ${order.fullNumber}`,
        status: 'DRAFT',
        createdBy: 'system',
      });

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

    it('TSK-735 (Review Focus 4): devolución de una cuota histórica más una nueva → dos líneas Debe, la histórica contra Proveedores con el proveedor de origen', async () => {
      // Cuota nueva: OP con débito de la socia (queda en Deudas con socios).
      const nueva = await createDraft([
        {
          paymentMethod: 'DEBIT_CARD',
          amount: '300',
          cardId: debitCardSocioId,
        },
        cashPayment('700'),
      ]);
      expect((await confirmPaymentOrder(nueva.id)).success).toBe(true);
      const cuotaNueva = await prisma.paymentOrderInstallment.findFirstOrThrow({
        where: { paymentOrderId: nueva.id },
        select: { id: true, accountId: true },
      });
      expect(cuotaNueva.accountId).toBe(sociosId);

      // Cuota histórica (anterior a TSK-735): sin cuenta, sobre una OP del proveedor.
      const cuotaHistorica = await prisma.paymentOrderInstallment.create({
        data: {
          companyId,
          paymentOrderId: nueva.id,
          cardId: debitCardSocioId,
          partnerId,
          number: 2,
          dueDate: ORDER_DATE,
          amount: 250,
          status: 'PENDING',
          accountId: null,
        },
        select: { id: true },
      });

      const created = await createPartnerRepaymentOrder({
        partnerId,
        date: ORDER_DATE,
        notes: `${PREFIX}devolución mixta`,
        installmentIds: [cuotaNueva.id, cuotaHistorica.id],
        payments: [cashPayment('550')],
      });
      const result = await confirmPaymentOrder(created.id);
      expect(result.success).toBe(true);

      const lines = await fetchEntryLines(created.id);
      expect(lines).toHaveLength(3);
      const debits = lines
        .filter((l) => l.debit > 0)
        .map((l) => [l.accountId, l.debit, l.supplierId])
        .sort((a, b) => Number(a[1]) - Number(b[1]));
      expect(debits).toEqual([
        [pagarId, 250, supplierId],
        [sociosId, 300, null],
      ]);
      expect(lines.find((l) => l.accountId === cajaId)?.credit).toBe(550);

      const settled = await prisma.paymentOrderInstallment.findMany({
        where: { id: { in: [cuotaNueva.id, cuotaHistorica.id] } },
        select: { status: true },
      });
      expect(settled.map((i) => i.status)).toEqual(['PAID', 'PAID']);
    });

    it('TSK-735: devolución de una cuota histórica sin "Cuentas por Pagar" en Ajustes → bloqueado, sigue en borrador', async () => {
      const origen = await createDraft([cashPayment('1000')]);
      expect((await confirmPaymentOrder(origen.id)).success).toBe(true);
      const historica = await prisma.paymentOrderInstallment.create({
        data: {
          companyId,
          paymentOrderId: origen.id,
          cardId: debitCardSocioId,
          partnerId,
          number: 1,
          dueDate: ORDER_DATE,
          amount: 100,
          status: 'PENDING',
        },
        select: { id: true },
      });
      const created = await createPartnerRepaymentOrder({
        partnerId,
        date: ORDER_DATE,
        notes: `${PREFIX}devolución histórica`,
        installmentIds: [historica.id],
        payments: [cashPayment('100')],
      });
      await setSettings({ payablesAccountId: null });
      try {
        const result = await confirmPaymentOrder(created.id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain('falta configurar "Cuentas por Pagar"');
        expect((await readOrder(created.id)).status).toBe('DRAFT');
      } finally {
        await setSettings({ payablesAccountId: pagarId });
      }
    });

    /** Cuota de la socia nueva (Deudas con socios), de una OP con su tarjeta de débito. */
    async function partnerInstallment(amount: string): Promise<{ id: string; originId: string }> {
      const origen = await createDraft([
        { paymentMethod: 'DEBIT_CARD', amount, cardId: debitCardSocioId },
        cashPayment(String(1000 - Number(amount))),
      ]);
      expect((await confirmPaymentOrder(origen.id)).success).toBe(true);
      const cuota = await prisma.paymentOrderInstallment.findFirstOrThrow({
        where: { paymentOrderId: origen.id },
        select: { id: true },
      });
      return { id: cuota.id, originId: origen.id };
    }

    it('revisión final F5: devolución a socio con cheque propio → anular está bloqueado; debitar asienta', async () => {
      const cuota = await partnerInstallment('300');
      const created = await createPartnerRepaymentOrder({
        partnerId,
        date: ORDER_DATE,
        notes: `${PREFIX}devolución con cheque`,
        installmentIds: [cuota.id],
        // F6: el banco arrastrado de otro medio no se guarda en el cheque propio.
        payments: [{ ...ownCheckPayment('300', 'T735-F5-OWN'), bankAccountId: bancoConCuentaId }],
      });
      const stored = await prisma.paymentOrderPayment.findFirstOrThrow({
        where: { paymentOrderId: created.id },
        select: { bankAccountId: true },
      });
      expect(stored.bankAccountId).toBeNull();

      const confirmed = await confirmPaymentOrder(created.id);
      expect(confirmed.success).toBe(true);
      const { fullNumber } = await readOrder(created.id);
      const check = await prisma.check.findFirstOrThrow({
        where: { companyId, checkNumber: 'T735-F5-OWN' },
        select: { id: true, type: true, status: true, accountId: true },
      });
      expect(check).toMatchObject({ type: 'OWN', status: 'DELIVERED', accountId: diferidosId });

      expect(await voidCheck(check.id)).toEqual({
        success: false,
        error: `El cheque N° T735-F5-OWN pagó la devolución al socio ${fullNumber}: para anularlo, corregí esa orden de pago.`,
      });
      const afterVoid = await prisma.check.findUniqueOrThrow({
        where: { id: check.id },
        select: { status: true, voidEntryId: true },
      });
      expect(afterVoid).toEqual({ status: 'DELIVERED', voidEntryId: null });

      const debited = await debitCheck({
        checkId: check.id,
        date: ORDER_DATE,
        bankAccountId: bancoConCuentaId,
      });
      expect(debited).toEqual({ success: true, warnings: [] });
      const { debitEntryId } = await prisma.check.findUniqueOrThrow({
        where: { id: check.id },
        select: { debitEntryId: true },
      });
      const debitLines = await prisma.journalEntryLine.findMany({
        where: { entryId: debitEntryId ?? '' },
        select: { accountId: true, debit: true, credit: true },
      });
      expect(
        debitLines.map((l) => [l.accountId, Number(l.debit), Number(l.credit)]).sort()
      ).toEqual(
        [
          [diferidosId, 300, 0],
          [bancoId, 0, 300],
        ].sort()
      );
    });

    it('revisión final F8: cuotas reservadas por una devolución en borrador → impedimento al corregir la OP de origen; cuotas ≠ pagos → error claro', async () => {
      const cuota = await partnerInstallment('100');
      const created = await createPartnerRepaymentOrder({
        partnerId,
        date: ORDER_DATE,
        notes: `${PREFIX}devolución en borrador`,
        installmentIds: [cuota.id],
        payments: [cashPayment('100')],
      });
      const { fullNumber } = await readOrder(created.id);

      const found = await paymentOrderEffectImpedimentsTx(
        prisma,
        cuota.originId,
        'la OP de origen'
      );
      expect(found).toContainEqual({
        code: 'INSTALLMENT_RESERVED',
        severity: 'MANUAL',
        message: `Las cuotas de esta orden de pago están reservadas por la devolución al socio ${fullNumber}: eliminá o editá esa devolución antes.`,
        action: `Eliminá o editá la devolución ${fullNumber} y reintentá.`,
      });

      // La cuota cambió después de armar la devolución: el asiento descuadraría.
      await prisma.paymentOrderInstallment.update({
        where: { id: cuota.id },
        data: { amount: 80 },
      });
      const expected =
        'El total de las cuotas a devolver ($\u00a080,00) no coincide con los pagos ($\u00a0100,00).';
      expect((await getPaymentOrderEntryPreview(created.id)).error).toBe(expected);
      expect(await confirmPaymentOrder(created.id)).toEqual({ success: false, error: expected });
      expect((await readOrder(created.id)).status).toBe('DRAFT');
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

    it('caso 14 (TSK-735): getPaymentOrderEntryPreview lista la cuenta del cheque sin aviso y anticipa el error del banco', async () => {
      const conCheque = await createDraft([
        ownCheckPayment('400', 'T728O-OWN-2'),
        cashPayment('600'),
      ]);
      const preview = await getPaymentOrderEntryPreview(conCheque.id);
      expect(preview.error).toBeNull();
      expect(preview.warnings).toEqual([]);
      expect(preview.accounts.map((a) => a.concept)).toEqual([
        'Cuentas por Pagar',
        'Valores diferidos a pagar',
        `Caja "${PREFIX}Caja principal"`,
      ]);
      expect((await readOrder(conCheque.id)).status).toBe('DRAFT');

      const sinCuenta = await createDraft([transferPayment('1000', bancoSinCuentaId)]);
      const blocked = await getPaymentOrderEntryPreview(sinCuenta.id);
      expect(blocked.error).toMatch(/Banco sin cuenta/);
      expect(blocked.warnings).toEqual([]);
      expect(blocked.accounts).toEqual([]);
    });

    it('caso 15a (TSK-760, B3): mes cerrado por período sin lockedUntilDate → error legible, sin número ni caja, sigue en borrador', async () => {
      const { id } = await createDraft([cashPayment('1000')]);
      const reopen = await closeMonthForTest(companyId, new Date('2026-03-10'));
      const counterBefore = await readLastEntryNumber(companyId);
      try {
        const result = await confirmPaymentOrder(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain(
          'No se puede registrar con fecha 10/03/2026: el período está cerrado (mes 03/2026 cerrado).'
        );

        const doc = await readOrder(id);
        expect(doc.status).toBe('DRAFT');
        expect(doc.journalEntryId).toBeNull();
        expect(await readLastEntryNumber(companyId)).toBe(counterBefore);
        const movements = await prisma.cashMovement.count({
          where: { cashRegisterId: cajaPrincipalId, reference: doc.fullNumber },
        });
        expect(movements).toBe(0);
      } finally {
        await reopen();
      }
    });

    it('caso 15b (TSK-760): el asiento de la orden de pago nace DRAFT con ejercicio y período del mes', async () => {
      const { id } = await createDraft([cashPayment('1000')]);
      expect((await confirmPaymentOrder(id)).success).toBe(true);

      const doc = await readOrder(id);
      const entry = await readEntryPeriod(doc.journalEntryId!);
      expect(entry.status).toBe('DRAFT');
      expect(entry.createdBy).toBe('system');
      expect(entry.fiscalYearId).not.toBeNull();
      expect(entry.period).toMatchObject({ year: 2026, month: 3, type: 'MONTHLY' });
      expect(entry.period?.fiscalYearId).toBe(entry.fiscalYearId);
    });

    it('vincula caja, banco y proyecciones a la OP (TSK-792)', async () => {
      const { id } = await createDraft([
        transferPayment('300', bancoConCuentaId),
        {
          paymentMethod: 'DEBIT_CARD',
          amount: '400',
          cardId: debitCardSocioId,
          bankAccountId: bancoConCuentaId,
        },
        cashPayment('300'),
      ]);
      expect((await confirmPaymentOrder(id)).success).toBe(true);

      const cash = await prisma.cashMovement.findMany({
        where: { paymentOrderId: id },
        select: { type: true },
      });
      expect(cash).toEqual([{ type: 'EXPENSE' }]);

      const bank = await prisma.bankMovement.findMany({
        where: { paymentOrderId: id },
        select: { documentLink: true },
      });
      expect(bank).toEqual([{ documentLink: 'CREATED_BY_DOCUMENT' }]);

      const installments = await prisma.paymentOrderInstallment.findMany({
        where: { paymentOrderId: id },
        select: { id: true },
      });
      expect(installments).toHaveLength(1);
      const projections = await prisma.cashflowProjection.findMany({
        where: { paymentOrderInstallmentId: { in: installments.map((i) => i.id) } },
        select: { paymentOrderInstallmentId: true },
      });
      expect(projections).toEqual([{ paymentOrderInstallmentId: installments[0].id }]);
    });

    it('la retención guarda régimen, base y jurisdicción; al editar se reemplazan (TSK-813)', async () => {
      const iibb: WithholdingInput = {
        taxType: 'IIBB',
        rate: '1.5',
        amount: '15',
        certificateNumber: null,
        regimeCode: '011',
        taxableBase: '1000',
        jurisdiction: '904',
      };
      const { id, invoiceId } = await createDraft([cashPayment('985')], [iibb]);

      const read = async () =>
        (await getPaymentOrder(id)).withholdings.map((w) => ({
          taxType: w.taxType,
          rate: w.rate,
          amount: w.amount,
          certificateNumber: w.certificateNumber,
          regimeCode: w.regimeCode,
          taxableBase: w.taxableBase,
          jurisdiction: w.jurisdiction,
        }));
      expect(await read()).toEqual([
        {
          taxType: 'IIBB',
          rate: 1.5,
          amount: 15,
          certificateNumber: null,
          regimeCode: '011',
          taxableBase: 1000,
          jurisdiction: '904',
        },
      ]);

      // La jurisdicción solo aplica a IIBB: en una retención de Ganancias no se guarda.
      const result = await updatePaymentOrder(id, {
        supplierId,
        date: ORDER_DATE,
        notes: `${PREFIX}orden`,
        items: [{ invoiceId, amount: '1000' }],
        payments: [cashPayment('980')],
        withholdings: [
          {
            ...iibb,
            taxType: 'GANANCIAS',
            amount: '20',
            regimeCode: '78',
            taxableBase: '',
            jurisdiction: '904',
          },
        ],
      });
      expect(result.success).toBe(true);
      expect(await read()).toEqual([
        {
          taxType: 'GANANCIAS',
          rate: 1.5,
          amount: 20,
          certificateNumber: null,
          regimeCode: '78',
          taxableBase: null,
          jurisdiction: null,
        },
      ]);
    });
  }
);
