/**
 * Tests de integración de la confirmación de un recibo de cobro cuando el
 * asiento no se puede generar (TSK-728), contra la base real.
 *
 * Antes, cualquier fallo del asiento se degradaba a `logger.warn` y el recibo
 * quedaba `CONFIRMED` sin asiento. Ahora `confirmReceipt` pre-valida ANTES de
 * la transacción (cuentas de Ajustes, caja/banco, retenciones, imputabilidad),
 * omite con aviso los medios sin cuenta (cheque, tarjeta, cuenta corriente) y
 * devuelve `ActionResult<{ id, warnings }>`.
 *
 * Se entra por los **server actions reales** (`createReceipt`, `confirmReceipt`,
 * `getReceiptEntryPreview`). Molde: `purchase-invoice-line-accounts.integration.test.ts`
 * y `fund-movement-partner-account.integration.test.ts` (caja con sesión, bancos).
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

import type { CreateReceiptFormData } from '../../shared/validators';

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
import { confirmReceipt, createReceipt, getReceiptEntryPreview } from './actions.server';

const PREFIX = 'TSK728-REC-';
const RECEIPT_DATE = new Date('2026-03-10');

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type PaymentInput = CreateReceiptFormData['payments'][number];
type WithholdingInput = CreateReceiptFormData['withholdings'][number];

interface JournalLineRow {
  accountId: string;
  debit: number;
  credit: number;
}

describe.skipIf(!dbAvailable)(
  'integración e2e: asiento al confirmar un recibo de cobro (TSK-728)',
  () => {
    let companyId: string;
    let customerId: string;
    let pointOfSaleId: string;

    let cobrarId: string;
    let cajaId: string;
    let bancoId: string;
    let retIibbId: string;
    let cajaViejaId: string;
    const CAJA_VIEJA_CODE = 'T728R-CAJA-VIEJA';

    let cajaPrincipalId: string;
    let cajaPrincipalSessionId: string;
    let cajaViejaRegisterId: string;
    let bancoSinCuentaId: string;
    const BANCO_SIN_CUENTA_NUMBER = 'T728R-0002';

    let nextInvoiceNumber = 1;

    const cashPayment = (amount: string, cashRegisterId: string): PaymentInput => ({
      paymentMethod: 'CASH',
      amount,
      cashRegisterId,
    });
    const transferPayment = (amount: string, bankAccountId: string): PaymentInput => ({
      paymentMethod: 'TRANSFER',
      amount,
      bankAccountId,
    });
    const checkPayment = (amount: string, checkNumber: string): PaymentInput => ({
      paymentMethod: 'CHECK',
      amount,
      checkNumber,
      checkBankName: 'Banco Emisor',
      checkIssueDate: RECEIPT_DATE,
      checkDueDate: new Date('2026-04-10'),
      checkDrawerName: 'Cliente Librador',
    });

    /** Factura de venta CONFIRMED de $1000 creada directo con Prisma (una por caso). */
    async function createConfirmedInvoice(): Promise<string> {
      const number = nextInvoiceNumber++;
      const invoice = await prisma.salesInvoice.create({
        data: {
          companyId,
          customerId,
          pointOfSaleId,
          voucherType: 'FACTURA_A',
          number,
          fullNumber: `9728-${String(number).padStart(8, '0')}`,
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
      return invoice.id;
    }

    /** Recibo en borrador por el `createReceipt` real, cobrando una factura de $1000. */
    async function createDraft(payments: PaymentInput[], withholdings: WithholdingInput[] = []) {
      const invoiceId = await createConfirmedInvoice();
      const result = await createReceipt({
        customerId,
        date: RECEIPT_DATE,
        notes: `${PREFIX}recibo`,
        items: [{ invoiceId, amount: '1000' }],
        payments,
        withholdings,
      });
      return { id: result.id, invoiceId };
    }

    async function readReceipt(id: string) {
      return prisma.receipt.findUniqueOrThrow({
        where: { id },
        select: { status: true, journalEntryId: true, fullNumber: true },
      });
    }

    async function fetchEntryLines(receiptId: string): Promise<JournalLineRow[]> {
      const receipt = await readReceipt(receiptId);
      if (!receipt.journalEntryId) throw new Error('El recibo no tiene asiento generado');
      const rows = await prisma.journalEntryLine.findMany({
        where: { entryId: receipt.journalEntryId },
        select: { accountId: true, debit: true, credit: true },
      });
      return rows.map((r) => ({
        accountId: r.accountId,
        debit: Number(r.debit),
        credit: Number(r.credit),
      }));
    }

    const setSettings = (data: {
      receivablesAccountId?: string | null;
      defaultBankAccountId?: string | null;
      lockedUntilDate?: Date | null;
    }) => prisma.accountingSettings.update({ where: { companyId }, data });

    beforeAll(async () => {
      const company = await prisma.company.create({
        data: { name: `${PREFIX}Empresa`, isActive: true },
      });
      companyId = company.id;

      const mk = (code: string, name: string) =>
        prisma.account.create({
          data: { companyId, code, name: `${PREFIX}${name}`, type: 'ASSET', nature: 'DEBIT' },
        });

      const [cobrar, caja, banco, retIibb, cajaVieja] = await Promise.all([
        mk('T728R-COBRAR', 'Cuentas por Cobrar'),
        mk('T728R-CAJA', 'Caja'),
        mk('T728R-BANCO', 'Banco'),
        mk('T728R-RET-IIBB', 'Ret IIBB Sufrida'),
        mk(CAJA_VIEJA_CODE, 'Caja vieja'),
      ]);
      cobrarId = cobrar.id;
      cajaId = caja.id;
      bancoId = banco.id;
      retIibbId = retIibb.id;
      cajaViejaId = cajaVieja.id;

      await prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01'),
          fiscalYearEnd: new Date('2026-12-31'),
          receivablesAccountId: cobrarId,
          withholdingIibbSufferedAccountId: retIibbId,
          // "Caja por Defecto" y "Banco por Defecto" vacías a propósito.
          requireCostCenter: false,
        },
      });

      const customer = await prisma.contractor.create({
        data: { companyId, name: `${PREFIX}Cliente` },
      });
      customerId = customer.id;

      const pos = await prisma.salesPointOfSale.create({
        data: { companyId, number: 9728, name: `${PREFIX}PDV`, createdBy: 'test' },
      });
      pointOfSaleId = pos.id;

      const mkCashRegister = async (code: string, name: string, accountId: string) => {
        const register = await prisma.cashRegister.create({
          data: { companyId, code, name: `${PREFIX}${name}`, accountId, createdBy: 'test' },
          select: { id: true },
        });
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
        return { registerId: register.id, sessionId: session.id };
      };

      const principal = await mkCashRegister('T728R-CAJA1', 'Caja principal', cajaId);
      cajaPrincipalId = principal.registerId;
      cajaPrincipalSessionId = principal.sessionId;
      const vieja = await mkCashRegister('T728R-CAJA2', 'Caja vieja', cajaViejaId);
      cajaViejaRegisterId = vieja.registerId;

      // El banco con cuenta propia queda como control: nunca aparece en un error.
      const [, sinCuenta] = await Promise.all([
        prisma.bankAccount.create({
          data: {
            companyId,
            bankName: `${PREFIX}Banco con cuenta`,
            accountNumber: 'T728R-0001',
            accountType: 'CHECKING',
            balance: 0,
            status: 'ACTIVE',
            accountId: bancoId,
          },
          select: { id: true },
        }),
        prisma.bankAccount.create({
          data: {
            companyId,
            bankName: `${PREFIX}Banco sin cuenta`,
            accountNumber: BANCO_SIN_CUENTA_NUMBER,
            accountType: 'CHECKING',
            balance: 0,
            status: 'ACTIVE',
            accountId: null,
          },
          select: { id: true },
        }),
      ]);
      bancoSinCuentaId = sinCuenta.id;

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
        // items/payments/withholdings caen en cascada con el recibo.
        await prisma.receipt.deleteMany({ where: { companyId } });
        await prisma.journalEntry.deleteMany({ where: { companyId } });
        await prisma.salesInvoice.deleteMany({ where: { companyId } });
        await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
        await prisma.contractor.deleteMany({ where: { companyId } });
        await prisma.accountingSettings.deleteMany({ where: { companyId } });
        await prisma.account.deleteMany({ where: { companyId } });
        await prisma.company.deleteMany({ where: { id: companyId } });
      }

      const [remainingCompanies, remainingAccounts, remainingReceipts] = await Promise.all([
        prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
        prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
        prisma.receipt.count({ where: { notes: { startsWith: PREFIX } } }),
      ]);
      expect(remainingCompanies).toBe(0);
      expect(remainingAccounts).toBe(0);
      expect(remainingReceipts).toBe(0);

      await prisma.$disconnect();
    });

    it('caso 1: efectivo en caja con cuenta → confirma sin avisos; Debe Caja / Haber Cobrar; factura PAID; movimiento de caja', async () => {
      const { id, invoiceId } = await createDraft([cashPayment('1000', cajaPrincipalId)]);

      const result = await confirmReceipt(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.id).toBe(id);
      expect(result.warnings).toEqual([]);

      const receipt = await readReceipt(id);
      expect(receipt.status).toBe('CONFIRMED');
      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountId === cajaId)?.debit).toBe(1000);
      expect(lines.find((l) => l.accountId === cobrarId)?.credit).toBe(1000);

      const invoice = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true },
      });
      expect(invoice.status).toBe('PAID');

      const movement = await prisma.cashMovement.findFirst({
        where: { cashRegisterId: cajaPrincipalId, reference: receipt.fullNumber },
        select: { type: true, amount: true },
      });
      expect(movement?.type).toBe('INCOME');
      expect(Number(movement?.amount)).toBe(1000);
    });

    it('caso 2 y 3: transferencia a banco sin cuenta ni "Banco por Defecto" → bloqueado sin mover nada; con el default cargado → confirma en Banco', async () => {
      const { id, invoiceId } = await createDraft([transferPayment('1000', bancoSinCuentaId)]);

      const result = await confirmReceipt(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain(
        `la cuenta bancaria "${PREFIX}Banco sin cuenta ${BANCO_SIN_CUENTA_NUMBER}"`
      );
      expect(result.error).toContain('"Banco por Defecto"');
      expect(result.error).toContain('Contabilidad → Configuración');

      const receipt = await readReceipt(id);
      expect(receipt.status).toBe('DRAFT');
      expect(receipt.journalEntryId).toBeNull();
      const invoice = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true },
      });
      expect(invoice.status).toBe('CONFIRMED');
      const bank = await prisma.bankAccount.findUniqueOrThrow({
        where: { id: bancoSinCuentaId },
        select: { balance: true, movements: { select: { id: true } } },
      });
      expect(Number(bank.balance)).toBe(0);
      expect(bank.movements).toHaveLength(0);

      // Caso 3: con "Banco por Defecto" el mismo recibo confirma.
      await setSettings({ defaultBankAccountId: bancoId });
      try {
        const retry = await confirmReceipt(id);
        expect(retry.success).toBe(true);
        const lines = await fetchEntryLines(id);
        expect(lines.find((l) => l.accountId === bancoId)?.debit).toBe(1000);
        expect(lines.find((l) => l.accountId === cobrarId)?.credit).toBe(1000);
        const bankAfter = await prisma.bankAccount.findUniqueOrThrow({
          where: { id: bancoSinCuentaId },
          select: { balance: true },
        });
        expect(Number(bankAfter.balance)).toBe(1000);
      } finally {
        await setSettings({ defaultBankAccountId: null });
      }
    });

    it('caso 4: sin "Cuentas por Cobrar" en Ajustes → bloqueado con el label exacto', async () => {
      const { id } = await createDraft([cashPayment('1000', cajaPrincipalId)]);
      await setSettings({ receivablesAccountId: null });
      try {
        const result = await confirmReceipt(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain('falta configurar "Cuentas por Cobrar"');
        expect(result.error).toContain('en Contabilidad → Configuración');
        expect((await readReceipt(id)).status).toBe('DRAFT');
      } finally {
        await setSettings({ receivablesAccountId: cobrarId });
      }
    });

    it('caso 5: retención sin cuenta sufrida → bloqueado; con la configurada → Debe Ret + Debe Caja / Haber Cobrar', async () => {
      const withholding = (taxType: 'GANANCIAS' | 'IIBB'): WithholdingInput => ({
        taxType,
        rate: '10',
        amount: '100',
      });

      const sinCuenta = await createDraft(
        [cashPayment('900', cajaPrincipalId)],
        [withholding('GANANCIAS')]
      );
      const blocked = await confirmReceipt(sinCuenta.id);
      expect(blocked.success).toBe(false);
      if (blocked.success) return;
      expect(blocked.error).toContain('"Ret. Ganancias Sufrida"');
      expect((await readReceipt(sinCuenta.id)).status).toBe('DRAFT');

      const conCuenta = await createDraft(
        [cashPayment('900', cajaPrincipalId)],
        [withholding('IIBB')]
      );
      const ok = await confirmReceipt(conCuenta.id);
      expect(ok.success).toBe(true);
      const lines = await fetchEntryLines(conCuenta.id);
      expect(lines).toHaveLength(3);
      expect(lines.find((l) => l.accountId === retIibbId)?.debit).toBe(100);
      expect(lines.find((l) => l.accountId === cajaId)?.debit).toBe(900);
      expect(lines.find((l) => l.accountId === cobrarId)?.credit).toBe(1000);
    });

    it('caso 6: cheque físico + efectivo → confirma con aviso; asiento de dos líneas por el importe contabilizable; cheque en cartera', async () => {
      const { id, invoiceId } = await createDraft([
        checkPayment('400', '00012345'),
        cashPayment('600', cajaPrincipalId),
      ]);

      const result = await confirmReceipt(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Cheque N° 00012345');
      expect(result.warnings[0]).toContain('no genera línea');
      expect(result.warnings[0]).toContain('Cuentas por Cobrar');

      const lines = await fetchEntryLines(id);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountId === cajaId)?.debit).toBe(600);
      expect(lines.find((l) => l.accountId === cobrarId)?.credit).toBe(600);

      const check = await prisma.check.findFirst({
        where: { companyId, checkNumber: '00012345' },
        select: { type: true, status: true, amount: true },
      });
      expect(check?.type).toBe('THIRD_PARTY');
      expect(check?.status).toBe('PORTFOLIO');
      expect(Number(check?.amount)).toBe(400);

      const invoice = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true },
      });
      expect(invoice.status).toBe('PAID');
    });

    it('caso 7: solo cheque físico → bloqueado por asiento de una sola línea; sin cheque creado', async () => {
      const { id } = await createDraft([checkPayment('1000', '00099999')]);

      const result = await confirmReceipt(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('una sola línea');
      expect(result.error).toContain('Cheque N° 00099999');

      expect((await readReceipt(id)).status).toBe('DRAFT');
      const check = await prisma.check.findFirst({ where: { companyId, checkNumber: '00099999' } });
      expect(check).toBeNull();
    });

    it('caso 8: sin pagos ni retenciones → bloqueado con "Agregá un pago"', async () => {
      const { id } = await createDraft([]);

      const result = await confirmReceipt(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('una sola línea');
      expect(result.error).toContain('Agregá un pago');
      expect((await readReceipt(id)).status).toBe('DRAFT');
    });

    it('caso 9: caja cuya cuenta está inactiva → bloqueado nombrando la cuenta', async () => {
      const { id } = await createDraft([cashPayment('1000', cajaViejaRegisterId)]);
      await prisma.account.update({ where: { id: cajaViejaId }, data: { isActive: false } });
      try {
        const result = await confirmReceipt(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain(`${CAJA_VIEJA_CODE} - ${PREFIX}Caja vieja`);
        expect(result.error).toContain('no está activa o no es imputable');
        expect(result.error).toContain(`la caja "${PREFIX}Caja vieja"`);
        expect((await readReceipt(id)).status).toBe('DRAFT');
      } finally {
        await prisma.account.update({ where: { id: cajaViejaId }, data: { isActive: true } });
      }
    });

    it('caso 10: caja sin sesión abierta → error legible con el nombre de la caja; nada se mueve', async () => {
      const { id } = await createDraft([cashPayment('1000', cajaPrincipalId)]);
      await prisma.cashRegisterSession.update({
        where: { id: cajaPrincipalSessionId },
        data: { status: 'CLOSED', closedAt: new Date(), closedBy: 'test' },
      });
      try {
        const result = await confirmReceipt(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toBe(`No hay sesión abierta para la caja "${PREFIX}Caja principal"`);
        const receipt = await readReceipt(id);
        expect(receipt.status).toBe('DRAFT');
        expect(receipt.journalEntryId).toBeNull();
      } finally {
        await prisma.cashRegisterSession.update({
          where: { id: cajaPrincipalSessionId },
          data: { status: 'OPEN', closedAt: null, closedBy: null },
        });
      }
    });

    it('caso 11: período cerrado → error legible y transacción revertida (sin movimiento de caja)', async () => {
      const { id } = await createDraft([cashPayment('1000', cajaPrincipalId)]);
      await setSettings({ lockedUntilDate: new Date('2026-12-31') });
      try {
        const result = await confirmReceipt(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain('período está cerrado');

        const receipt = await readReceipt(id);
        expect(receipt.status).toBe('DRAFT');
        expect(receipt.journalEntryId).toBeNull();
        const movements = await prisma.cashMovement.count({
          where: { cashRegisterId: cajaPrincipalId, reference: receipt.fullNumber },
        });
        expect(movements).toBe(0);
      } finally {
        await setSettings({ lockedUntilDate: null });
      }
    });

    it('caso 12: confirmar dos veces → "Recibo no encontrado o ya confirmado"', async () => {
      const { id } = await createDraft([cashPayment('1000', cajaPrincipalId)]);
      expect((await confirmReceipt(id)).success).toBe(true);

      const again = await confirmReceipt(id);
      expect(again.success).toBe(false);
      if (again.success) return;
      expect(again.error).toBe('Recibo no encontrado o ya confirmado');
    });

    it('caso 13: getReceiptEntryPreview anticipa los avisos y el error sin confirmar', async () => {
      const conCheque = await createDraft([
        checkPayment('400', '00055555'),
        cashPayment('600', cajaPrincipalId),
      ]);
      const preview = await getReceiptEntryPreview(conCheque.id);
      expect(preview.error).toBeNull();
      expect(preview.warnings).toHaveLength(1);
      expect(preview.warnings[0]).toMatch(/Cheque N° 00055555/);
      expect(preview.documentLabel).toBe(
        `el recibo ${(await readReceipt(conCheque.id)).fullNumber}`
      );
      expect((await readReceipt(conCheque.id)).status).toBe('DRAFT');

      const sinCuenta = await createDraft([transferPayment('1000', bancoSinCuentaId)]);
      const blocked = await getReceiptEntryPreview(sinCuenta.id);
      expect(blocked.error).toMatch(/Banco sin cuenta/);
      expect(blocked.warnings).toEqual([]);
    });
  }
);
