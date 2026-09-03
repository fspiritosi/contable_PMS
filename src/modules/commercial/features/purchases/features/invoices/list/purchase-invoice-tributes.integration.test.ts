/**
 * Tests de integración de la cadena completa de una factura de compra con
 * percepciones e impuestos internos (TSK-644), contra la base real.
 *
 * Complementa a
 * `src/modules/accounting/features/integrations/commercial/perceptions.integration.test.ts`,
 * que ejercita el armado del asiento a partir de un comprobante ya persistido.
 * Acá se entra por arriba: por los **server actions reales**
 * (`createPurchaseInvoice`, `confirmPurchaseInvoice`, `getPurchaseInvoiceById`),
 * con el mismo input que manda el formulario. Es la verificación de punta a
 * punta que pide la tarea 11.3 del plan, con los importes de la factura de La
 * Anónima que adjunta el ticket.
 *
 * CÓDIGO REAL DE PRODUCCIÓN, NO UNA RÉPLICA
 * ------------------------------------------
 * Sigue el criterio de `fund-movement-lines.integration.test.ts`: se aísla
 * ÚNICAMENTE la frontera de sesión/permisos/empresa activa/caché de Next
 * (los cuatro `vi.mock` de abajo). El cálculo de totales, la persistencia de
 * las percepciones, la validación de cuentas de tributos y la generación del
 * asiento son el código real.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// Frontera aislada: sesión, permisos, empresa activa y caché de Next.
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', () => ({
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { calculatePurchaseInvoiceBalance } from '@/modules/commercial/shared/purchase-invoice-balance';

// Código real de producción.
import {
  confirmPurchaseInvoice,
  createPurchaseInvoice,
  getPurchaseInvoiceById,
} from './actions.server';

const PREFIX = 'TSK644-E2E-';

// Importes exactos del ticket de La Anónima.
const NETO_21 = 91957.84;
const NETO_105 = 91284.86;
const IVA_21 = 19311.15;
const IVA_105 = 9584.91;
const PERCEP_NQN = '1832.43';
const PERCEP_IVA = '4128.01';
const IMP_INTERNOS = '326.95';

const NETO_TOTAL = NETO_21 + NETO_105; // 183242.70
const IVA_TOTAL = IVA_21 + IVA_105; // 28896.06
const OTHER_TAXES = 6287.39; // 1832.43 + 4128.01 + 326.95
const TOTAL = 218426.15; // el ticket imprime 218426.14: 1 centavo de redondeo del emisor

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('integración e2e: factura de compra con tributos (TSK-644)', () => {
  let companyId: string;
  let supplierId: string;
  let invoiceId: string;
  let internalTaxesAccountId: string;
  const accountIdsByName = new Map<string, string>();

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const mk = (code: string, name: string, type: 'ASSET' | 'LIABILITY' | 'EXPENSE', nature: 'DEBIT' | 'CREDIT') =>
      prisma.account.create({
        data: { companyId, code, name: `${PREFIX}${name}`, type, nature },
      });

    const [compras, pagar, ivacf, percIva, percIibb, impInt] = await Promise.all([
      mk('E644-COMPRAS', 'Compras', 'EXPENSE', 'DEBIT'),
      mk('E644-PAGAR', 'Cuentas por Pagar', 'LIABILITY', 'CREDIT'),
      mk('E644-IVACF', 'IVA Credito Fiscal', 'ASSET', 'DEBIT'),
      mk('E644-PERCIVA', 'Perc IVA Sufrida', 'ASSET', 'DEBIT'),
      mk('E644-PERCIIBB', 'Perc IIBB Sufrida', 'ASSET', 'DEBIT'),
      mk('E644-IMPINT', 'Impuestos Internos', 'EXPENSE', 'DEBIT'),
    ]);
    for (const a of [compras, pagar, ivacf, percIva, percIibb, impInt]) {
      accountIdsByName.set(a.name.replace(PREFIX, ''), a.id);
    }
    internalTaxesAccountId = impInt.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        purchasesAccountId: compras.id,
        payablesAccountId: pagar.id,
        vatCreditAccountId: ivacf.id,
        perceptionIvaSufferedAccountId: percIva.id,
        perceptionIibbSufferedAccountId: percIibb.id,
        internalTaxesAccountId,
      },
    });

    const supplier = await prisma.supplier.create({
      data: {
        companyId,
        code: `${PREFIX}LA`,
        businessName: `${PREFIX}La Anonima`,
        taxId: '30500000000',
        taxCondition: 'RESPONSABLE_INSCRIPTO',
        createdBy: 'test',
      },
    });
    supplierId = supplier.id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
    await prisma.journalEntry.deleteMany({ where: { companyId } });
    await prisma.supplier.deleteMany({ where: { companyId } });
    await prisma.accountingSettings.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });

    const remaining = await prisma.company.count({
      where: { name: { startsWith: PREFIX } },
    });
    expect(remaining).toBe(0);

    await prisma.$disconnect();
  });

  /** El mismo objeto que arma el formulario al guardar. */
  const formInput = {
    supplierId: '',
    voucherType: 'FACTURA_A',
    pointOfSale: '0001',
    number: '00006441',
    issueDate: new Date('2026-01-15'),
    notes: 'Factura del ticket TSK-644',
    lines: [
      { description: 'Neto 21%', quantity: '1', unitCost: String(NETO_21), vatRate: '21' },
      { description: 'Neto 10.5%', quantity: '1', unitCost: String(NETO_105), vatRate: '10.5' },
    ],
    perceptions: [
      {
        type: 'IIBB' as const,
        jurisdiction: 'NQN',
        baseAmount: NETO_TOTAL.toFixed(2),
        amount: PERCEP_NQN,
      },
      {
        type: 'IVA' as const,
        jurisdiction: '',
        baseAmount: NETO_TOTAL.toFixed(2),
        amount: PERCEP_IVA,
      },
    ],
    internalTaxes: IMP_INTERNOS,
  };

  describe('alta desde el formulario', () => {
    beforeAll(async () => {
      const result = await createPurchaseInvoice({ ...formInput, supplierId });
      invoiceId = result.id;
    });

    it('persiste los totales con los tributos incluidos', async () => {
      const invoice = await getPurchaseInvoiceById(invoiceId);

      expect(invoice.subtotal).toBe(NETO_TOTAL);
      expect(invoice.vatAmount).toBe(IVA_TOTAL);
      expect(invoice.internalTaxes).toBe(326.95);
      expect(invoice.otherTaxes).toBe(OTHER_TAXES);
      expect(invoice.total).toBe(TOTAL);
    });

    it('guarda las percepciones con su jurisdicción y la alícuota derivada', async () => {
      const invoice = await getPurchaseInvoiceById(invoiceId);

      expect(invoice.perceptions).toHaveLength(2);

      const iibb = invoice.perceptions.find((p) => p.type === 'IIBB');
      expect(iibb?.jurisdiction).toBe('NQN');
      expect(iibb?.amount).toBe(1832.43);
      expect(iibb?.baseAmount).toBe(NETO_TOTAL);
      expect(iibb?.rate).toBe(1); // 1832.43 / 183242.70 = 0.9999...% → 1.000

      const iva = invoice.perceptions.find((p) => p.type === 'IVA');
      expect(iva?.jurisdiction).toBeNull(); // jurisdicción vacía → null
      expect(iva?.amount).toBe(4128.01);
      expect(iva?.rate).toBe(2.253);
    });
  });

  describe('confirmación', () => {
    it('bloquea si falta la cuenta de un tributo, nombrándola', async () => {
      await prisma.accountingSettings.update({
        where: { companyId },
        data: { internalTaxesAccountId: null },
      });

      await expect(confirmPurchaseInvoice(invoiceId)).rejects.toThrow(
        /impuestos internos/i
      );

      // No confirmó ni a medias: sigue en borrador y sin asiento.
      const invoice = await prisma.purchaseInvoice.findUnique({
        where: { id: invoiceId },
        select: { status: true, journalEntryId: true },
      });
      expect(invoice?.status).toBe('DRAFT');
      expect(invoice?.journalEntryId).toBeNull();

      await prisma.accountingSettings.update({
        where: { companyId },
        data: { internalTaxesAccountId },
      });
    });

    it('con las cuentas configuradas, confirma y genera el asiento balanceado', async () => {
      await confirmPurchaseInvoice(invoiceId);

      const invoice = await prisma.purchaseInvoice.findUnique({
        where: { id: invoiceId },
        select: { status: true, journalEntryId: true },
      });
      expect(invoice?.status).toBe('CONFIRMED');
      expect(invoice?.journalEntryId).not.toBeNull();

      const lines = await prisma.journalEntryLine.findMany({
        where: { entryId: invoice!.journalEntryId! },
        select: { debit: true, credit: true, accountId: true },
      });

      const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(Math.round(debit * 100) / 100).toBe(TOTAL);
      expect(Math.round(credit * 100) / 100).toBe(TOTAL);

      const byAccount = (name: string) =>
        lines
          .filter((l) => l.accountId === accountIdsByName.get(name))
          .reduce((s, l) => s + Number(l.debit), 0);

      expect(byAccount('Perc IIBB Sufrida')).toBe(1832.43);
      expect(byAccount('Perc IVA Sufrida')).toBe(4128.01);
      expect(byAccount('Impuestos Internos')).toBe(326.95);
    });
  });

  describe('saldo con el proveedor', () => {
    it('el pendiente de pago incluye los tributos', async () => {
      const invoice = await prisma.purchaseInvoice.findUnique({
        where: { id: invoiceId },
        select: { voucherType: true, total: true },
      });

      const balance = calculatePurchaseInvoiceBalance({
        voucherType: invoice!.voucherType,
        total: Number(invoice!.total),
        paymentOrderItems: [],
        creditNoteApplicationsReceived: [],
        creditDebitNotes: [],
      });

      expect(balance.pendingBalance).toBe(TOTAL);
    });
  });
});
