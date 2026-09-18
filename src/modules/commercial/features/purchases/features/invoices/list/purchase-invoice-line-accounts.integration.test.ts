/**
 * Tests de integración de la confirmación de una factura de compra cuando la
 * cuenta contable la define el ítem y la "Cuenta de compras por defecto" es
 * solo el respaldo —obligatorio para las líneas sin ítem— (TSK-721), contra
 * la base real.
 *
 * Se entra por arriba, por los **server actions reales**
 * (`createPurchaseInvoice`, `confirmPurchaseInvoice`,
 * `bulkConfirmPurchaseInvoices`), con el mismo input que manda el formulario
 * (una línea sin `productId` es válida: gastos no inventariables e importación
 * AFIP). Molde: `purchase-invoice-tributes.integration.test.ts`.
 *
 * Se aísla ÚNICAMENTE la frontera de sesión/permisos/empresa activa/caché de
 * Next (los cuatro `vi.mock` de abajo).
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// Frontera aislada: sesión, permisos, empresa activa y caché de Next.
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
  bulkConfirmPurchaseInvoices,
  confirmPurchaseInvoice,
  createPurchaseInvoice,
} from './actions.server';

const PREFIX = 'TSK721-PURC-';

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
}

describe.skipIf(!dbAvailable)(
  'integración e2e: cuentas de línea al confirmar una compra (TSK-721)',
  () => {
    let companyId: string;
    let supplierId: string;

    let comprasId: string;
    let pagarId: string;
    let ivaCfId: string;
    let repuestosId: string;
    let comprasViejaId: string;
    let comprasPadreId: string;
    const COMPRAS_VIEJA_CODE = 'T721-COMPRAS-VIEJA';
    const COMPRAS_PADRE_CODE = 'T721-COMPRAS-PADRE';

    let conCuentaId: string;
    let sinCuentaId: string;
    let cuentaViejaId: string;

    let nextNumber = 1;

    const setPurchasesAccount = (purchasesAccountId: string | null) =>
      prisma.accountingSettings.update({ where: { companyId }, data: { purchasesAccountId } });

    /** Factura en borrador desde el formulario: una línea de $1000 + IVA 21%. */
    async function createDraftPurchase(description: string, productId?: string) {
      const number = String(nextNumber++).padStart(8, '0');
      const result = await createPurchaseInvoice({
        supplierId,
        voucherType: 'FACTURA_A',
        pointOfSale: '0001',
        number,
        issueDate: new Date('2026-03-10'),
        lines: [
          {
            ...(productId ? { productId } : {}),
            description,
            quantity: '1',
            unitCost: '1000',
            vatRate: '21',
          },
        ],
        internalTaxes: '',
      });
      return { id: result.id, fullNumber: `0001-${number}` };
    }

    async function readInvoice(id: string) {
      return prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id },
        select: { status: true, journalEntryId: true, fullNumber: true },
      });
    }

    async function fetchEntryLines(entryId: string): Promise<JournalLineRow[]> {
      const rows = await prisma.journalEntryLine.findMany({
        where: { entryId },
        select: { accountId: true, debit: true, credit: true },
      });
      return rows.map((r) => ({
        accountId: r.accountId,
        debit: Number(r.debit),
        credit: Number(r.credit),
      }));
    }

    beforeAll(async () => {
      const company = await prisma.company.create({
        data: { name: `${PREFIX}Empresa`, isActive: true },
      });
      companyId = company.id;

      const mk = (
        code: string,
        name: string,
        type: 'ASSET' | 'LIABILITY' | 'EXPENSE',
        nature: 'DEBIT' | 'CREDIT',
        extra: { isLeaf?: boolean } = {}
      ) =>
        prisma.account.create({
          data: { companyId, code, name: `${PREFIX}${name}`, type, nature, ...extra },
        });

      const [compras, pagar, ivaCf, repuestos, comprasVieja, comprasPadre] = await Promise.all([
        mk('T721-COMPRAS', 'Compras', 'EXPENSE', 'DEBIT'),
        mk('T721-PAGAR', 'Cuentas por Pagar', 'LIABILITY', 'CREDIT'),
        mk('T721-IVACF', 'IVA Credito Fiscal', 'ASSET', 'DEBIT'),
        mk('T721-REPUESTOS', 'Repuestos', 'EXPENSE', 'DEBIT'),
        mk(COMPRAS_VIEJA_CODE, 'Compras vieja', 'EXPENSE', 'DEBIT'),
        // Cuenta con hijas: no es imputable aunque esté activa.
        mk(COMPRAS_PADRE_CODE, 'Compras (rubro)', 'EXPENSE', 'DEBIT', { isLeaf: false }),
      ]);
      comprasId = compras.id;
      pagarId = pagar.id;
      ivaCfId = ivaCf.id;
      repuestosId = repuestos.id;
      comprasViejaId = comprasVieja.id;
      comprasPadreId = comprasPadre.id;

      await prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01'),
          fiscalYearEnd: new Date('2026-12-31'),
          purchasesAccountId: comprasId,
          payablesAccountId: pagarId,
          vatCreditAccountId: ivaCfId,
          requireCostCenter: false,
        },
      });

      const supplier = await prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}PROV`,
          businessName: `${PREFIX}Proveedor`,
          taxId: '30500000000',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
      });
      supplierId = supplier.id;

      const mkProduct = (code: string, name: string, defaultExpenseAccountId: string | null) =>
        prisma.product.create({
          data: {
            companyId,
            code: `${PREFIX}${code}`,
            name: `${PREFIX}${name}`,
            usage: 'PURCHASE',
            trackStock: false,
            defaultExpenseAccountId,
            createdBy: 'test',
          },
          select: { id: true },
        });

      const [conCuenta, sinCuenta, cuentaVieja] = await Promise.all([
        mkProduct('CON', 'conCuenta', repuestosId),
        mkProduct('SIN', 'sinCuenta', null),
        mkProduct('VIEJA', 'cuentaVieja', comprasViejaId),
      ]);
      conCuentaId = conCuenta.id;
      sinCuentaId = sinCuenta.id;
      cuentaViejaId = cuentaVieja.id;

      vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
      vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
    });

    afterAll(async () => {
      await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
      await prisma.journalEntry.deleteMany({ where: { companyId } });
      await prisma.product.deleteMany({ where: { companyId } });
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });

      const [remainingCompanies, remainingAccounts, remainingProducts] = await Promise.all([
        prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
        prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
        prisma.product.count({ where: { name: { startsWith: PREFIX } } }),
      ]);
      expect(remainingCompanies).toBe(0);
      expect(remainingAccounts).toBe(0);
      expect(remainingProducts).toBe(0);

      await prisma.$disconnect();
    });

    it('caso 1: línea sin ítem con global configurada → confirma con Debe en la cuenta de compras por defecto', async () => {
      await setPurchasesAccount(comprasId);
      const { id } = await createDraftPurchase('Compra según comprobante AFIP (IVA 21%)');

      const result = await confirmPurchaseInvoice(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.id).toBe(id);
      expect(result.supplierId).toBe(supplierId);
      expect(result.needsReceivingNote).toBe(false);

      const invoice = await readInvoice(id);
      expect(invoice.status).toBe('CONFIRMED');
      const lines = await fetchEntryLines(invoice.journalEntryId!);
      expect(lines.find((l) => l.accountId === comprasId)?.debit).toBe(1000);
      expect(lines.find((l) => l.accountId === ivaCfId)?.debit).toBe(210);
      expect(lines.find((l) => l.accountId === pagarId)?.credit).toBe(1210);
    });

    it('caso 2: línea sin ítem y global vacía → { success: false } con «(sin ítem)»; sigue en borrador', async () => {
      await setPurchasesAccount(null);
      const { id } = await createDraftPurchase('Compra según comprobante AFIP (IVA 21%)');

      const result = await confirmPurchaseInvoice(id);
      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error).toBe(
        'No se puede confirmar el comprobante: la línea «Compra según comprobante AFIP (IVA 21%)» (sin ítem) ' +
          'no tiene cuenta contable. Asignale una Cuenta de Egresos al ítem (Ítems → Imputación contable) ' +
          'o configurá la "Cuenta de compras por defecto" en Contabilidad → Configuración. ' +
          'Las líneas sin ítem solo pueden usar la cuenta por defecto.'
      );

      const invoice = await readInvoice(id);
      expect(invoice.status).toBe('DRAFT');
      expect(invoice.journalEntryId).toBeNull();
    });

    it('caso 3: ítem con cuenta propia y global vacía → confirma con Debe en la cuenta del ítem', async () => {
      await setPurchasesAccount(null);
      const { id } = await createDraftPurchase('Filtro de aceite', conCuentaId);

      const result = await confirmPurchaseInvoice(id);
      expect(result.success).toBe(true);

      const invoice = await readInvoice(id);
      expect(invoice.status).toBe('CONFIRMED');
      const lines = await fetchEntryLines(invoice.journalEntryId!);
      expect(lines.find((l) => l.accountId === repuestosId)?.debit).toBe(1000);
      expect(lines.some((l) => l.accountId === comprasId)).toBe(false);
    });

    it('caso 4: la cuenta del ítem está dada de baja → rechaza nombrando ítem y cuenta, sin caer a la global', async () => {
      await setPurchasesAccount(comprasId);
      await prisma.account.update({ where: { id: comprasViejaId }, data: { isActive: false } });
      const { id, fullNumber } = await createDraftPurchase('Repuesto discontinuado', cuentaViejaId);

      try {
        const result = await confirmPurchaseInvoice(id);
        expect(result.success).toBe(false);
        if (result.success) return;

        expect(result.error).toBe(
          `No se puede confirmar el comprobante: la cuenta ${COMPRAS_VIEJA_CODE} - ${PREFIX}Compras vieja ` +
            'del ítem de la línea «Repuesto discontinuado» no está activa o no es imputable. ' +
            'Corregila en Ítems → Imputación contable.'
        );

        const invoice = await readInvoice(id);
        expect(invoice.status).toBe('DRAFT');
        expect(invoice.journalEntryId).toBeNull();
        const asientos = await prisma.journalEntry.count({
          where: { companyId, description: { contains: fullNumber } },
        });
        expect(asientos).toBe(0);
      } finally {
        await prisma.account.update({ where: { id: comprasViejaId }, data: { isActive: true } });
      }
    });

    it('caso 5: la global apunta a una cuenta no hoja y la línea no tiene ítem → rechaza nombrando la configuración', async () => {
      await setPurchasesAccount(comprasPadreId);
      const { id } = await createDraftPurchase('Gasto varios');

      try {
        const result = await confirmPurchaseInvoice(id);
        expect(result.success).toBe(false);
        if (result.success) return;

        expect(result.error).toBe(
          `No se puede confirmar el comprobante: la cuenta ${COMPRAS_PADRE_CODE} - ${PREFIX}Compras (rubro) ` +
            'configurada como "Cuenta de compras por defecto" no está activa o no es imputable. ' +
            'Corregila en Contabilidad → Configuración.'
        );

        const invoice = await readInvoice(id);
        expect(invoice.status).toBe('DRAFT');
      } finally {
        await setPurchasesAccount(comprasId);
      }
    });

    it('caso 6: la confirmación masiva reporta el motivo legible por factura', async () => {
      await setPurchasesAccount(null);
      const sin = await createDraftPurchase('Aceite sin cuenta', sinCuentaId);
      const con = await createDraftPurchase('Filtro con cuenta', conCuentaId);

      const result = await bulkConfirmPurchaseInvoices([sin.id, con.id]);

      expect(result.confirmedCount).toBe(1);
      expect(result.skippedCount).toBe(0);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].fullNumber).toBe(sin.fullNumber);
      expect(result.failures[0].message).toContain('«Aceite sin cuenta»');
      expect(result.failures[0].message).toContain('Cuenta de compras por defecto');

      expect((await readInvoice(sin.id)).status).toBe('DRAFT');
      expect((await readInvoice(con.id)).status).toBe('CONFIRMED');
    });

    it('caso 7: falta la cuenta de IVA Crédito Fiscal → error legible, sin factura confirmada a medias', async () => {
      await setPurchasesAccount(comprasId);
      await prisma.accountingSettings.update({
        where: { companyId },
        data: { vatCreditAccountId: null },
      });
      const { id } = await createDraftPurchase('Gasto con IVA');

      try {
        const result = await confirmPurchaseInvoice(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain('IVA Crédito Fiscal 21%');

        const invoice = await readInvoice(id);
        expect(invoice.status).toBe('DRAFT');
        expect(invoice.journalEntryId).toBeNull();
      } finally {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { vatCreditAccountId: ivaCfId },
        });
      }
    });

    it('caso 8: período cerrado → error legible y la transacción se revierte', async () => {
      await setPurchasesAccount(comprasId);
      await prisma.accountingSettings.update({
        where: { companyId },
        data: { lockedUntilDate: new Date('2026-06-30') },
      });
      const { id } = await createDraftPurchase('Gasto en período cerrado');

      try {
        const result = await confirmPurchaseInvoice(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toMatch(/período está cerrado/);

        const invoice = await readInvoice(id);
        expect(invoice.status).toBe('DRAFT');
        expect(invoice.journalEntryId).toBeNull();
      } finally {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { lockedUntilDate: null },
        });
      }
    });

    it('caso 9: una factura que no está en borrador se rechaza con mensaje legible', async () => {
      await setPurchasesAccount(comprasId);
      const { id } = await createDraftPurchase('Ya confirmada');
      expect((await confirmPurchaseInvoice(id)).success).toBe(true);

      const result = await confirmPurchaseInvoice(id);
      expect(result).toEqual({
        success: false,
        error: 'Solo se pueden confirmar facturas en estado borrador',
      });
    });
  }
);
