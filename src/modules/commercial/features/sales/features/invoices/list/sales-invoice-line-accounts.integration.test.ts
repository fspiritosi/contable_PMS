/**
 * Tests de integración de la confirmación de una factura de venta cuando la
 * cuenta contable la define el ítem y la "Cuenta de ventas por defecto" es
 * solo el respaldo (TSK-721), contra la base real.
 *
 * Se entra por el **`confirmInvoice` real**: la pre-validación de cuentas de
 * línea, la transacción, el asiento (`createJournalEntryForSalesInvoice`) y
 * el resultado `{ success, error }` son el código de producción. Las facturas
 * se crean directo con Prisma en `DRAFT` (molde
 * `accounting/.../cost-center.integration.test.ts`): `createInvoice` exige
 * validación AFIP y numeración que no aportan al caso.
 *
 * Se aísla ÚNICAMENTE la frontera de sesión/permisos/empresa activa/caché de
 * Next (los cuatro `vi.mock` de abajo), como en
 * `purchase-invoice-tributes.integration.test.ts`.
 *
 * Los productos tienen `trackStock: false`: si no, `confirmInvoice` exige un
 * almacén antes de llegar a la lógica que se prueba.
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

import { createJournalEntryForSalesInvoice } from '@/modules/accounting/features/integrations/commercial';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

// Código real de producción.
import { confirmInvoice } from './actions.server';

const PREFIX = 'TSK721-SALE-';

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
  'integración e2e: cuentas de línea al confirmar una venta (TSK-721)',
  () => {
    let companyId: string;
    let customerId: string;
    let customerNcId: string;
    let pointOfSaleId: string;

    let ventasId: string;
    let cobrarId: string;
    let ivaDfId: string;
    let ventasRodadosId: string;
    let ventasViejaId: string;
    const VENTAS_VIEJA_CODE = 'T721-VENTAS-VIEJA';

    let conCuentaId: string;
    let sinCuentaId: string;
    let cuentaViejaId: string;

    let nextNumber = 1;

    const setSalesAccount = (salesAccountId: string | null) =>
      prisma.accountingSettings.update({ where: { companyId }, data: { salesAccountId } });

    /** Factura en borrador con una sola línea de $1000 + IVA 21%. */
    async function createDraftSale(
      productId: string,
      description: string,
      options: { voucherType?: 'FACTURA_A' | 'NOTA_CREDITO_A'; customerId?: string } = {}
    ) {
      const number = nextNumber++;
      const invoice = await prisma.salesInvoice.create({
        data: {
          companyId,
          customerId: options.customerId ?? customerId,
          pointOfSaleId,
          voucherType: options.voucherType ?? 'FACTURA_A',
          number,
          fullNumber: `0001-${String(number).padStart(8, '0')}`,
          issueDate: new Date('2026-03-10'),
          subtotal: 1000,
          netTaxed: 1000,
          vatAmount: 210,
          total: 1210,
          totalBeforeDiscount: 1210,
          discountTotal: 0,
          createdBy: 'test',
          lines: {
            create: [
              {
                productId,
                description,
                quantity: 1,
                unitPrice: 1000,
                lineType: 'TAXED',
                vatRate: 21,
                vatAmount: 210,
                subtotal: 1000,
                total: 1210,
              },
            ],
          },
        },
        select: { id: true },
      });
      return invoice.id;
    }

    async function readInvoice(id: string) {
      const invoice = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id },
        select: { status: true, journalEntryId: true, fullNumber: true },
      });
      return invoice;
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
        type: 'ASSET' | 'LIABILITY' | 'REVENUE',
        nature: 'DEBIT' | 'CREDIT'
      ) =>
        prisma.account.create({
          data: { companyId, code, name: `${PREFIX}${name}`, type, nature },
        });

      const [ventas, cobrar, ivaDf, ventasRodados, ventasVieja] = await Promise.all([
        mk('T721-VENTAS', 'Ventas', 'REVENUE', 'CREDIT'),
        mk('T721-COBRAR', 'Cuentas por Cobrar', 'ASSET', 'DEBIT'),
        mk('T721-IVADF', 'IVA Debito Fiscal', 'LIABILITY', 'CREDIT'),
        mk('T721-VENTAS-RODADOS', 'Ventas rodados', 'REVENUE', 'CREDIT'),
        mk(VENTAS_VIEJA_CODE, 'Ventas vieja', 'REVENUE', 'CREDIT'),
      ]);
      ventasId = ventas.id;
      cobrarId = cobrar.id;
      ivaDfId = ivaDf.id;
      ventasRodadosId = ventasRodados.id;
      ventasViejaId = ventasVieja.id;

      await prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01'),
          fiscalYearEnd: new Date('2026-12-31'),
          salesAccountId: ventasId,
          receivablesAccountId: cobrarId,
          vatDebitAccountId: ivaDfId,
          requireCostCenter: false,
        },
      });

      const [customer, customerNc] = await Promise.all([
        prisma.contractor.create({ data: { companyId, name: `${PREFIX}Cliente` } }),
        // Cliente aparte para la NC: así la auto-compensación no toca las
        // facturas confirmadas por los otros casos.
        prisma.contractor.create({ data: { companyId, name: `${PREFIX}Cliente NC` } }),
      ]);
      customerId = customer.id;
      customerNcId = customerNc.id;

      const pos = await prisma.salesPointOfSale.create({
        data: { companyId, number: 9721, name: `${PREFIX}PDV`, createdBy: 'test' },
      });
      pointOfSaleId = pos.id;

      const mkProduct = (code: string, name: string, defaultIncomeAccountId: string | null) =>
        prisma.product.create({
          data: {
            companyId,
            code: `${PREFIX}${code}`,
            name: `${PREFIX}${name}`,
            usage: 'SALE',
            trackStock: false,
            defaultIncomeAccountId,
            createdBy: 'test',
          },
          select: { id: true },
        });

      const [conCuenta, sinCuenta, cuentaVieja] = await Promise.all([
        mkProduct('CON', 'conCuenta', ventasRodadosId),
        mkProduct('SIN', 'sinCuenta', null),
        mkProduct('VIEJA', 'cuentaVieja', ventasViejaId),
      ]);
      conCuentaId = conCuenta.id;
      sinCuentaId = sinCuenta.id;
      cuentaViejaId = cuentaVieja.id;

      vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
      vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
    });

    afterAll(async () => {
      await prisma.salesInvoice.deleteMany({ where: { companyId } });
      await prisma.journalEntry.deleteMany({ where: { companyId } });
      await prisma.product.deleteMany({ where: { companyId } });
      await prisma.contractor.deleteMany({ where: { companyId } });
      await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
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

    it('caso 1: ítem con cuenta propia y global vacía → confirma y el asiento usa la del ítem', async () => {
      await setSalesAccount(null);
      const id = await createDraftSale(conCuentaId, 'Rodado 0km');

      const result = await confirmInvoice(id);
      expect(result).toEqual({ success: true, id });

      const invoice = await readInvoice(id);
      expect(invoice.status).toBe('CONFIRMED');
      expect(invoice.journalEntryId).not.toBeNull();

      const lines = await fetchEntryLines(invoice.journalEntryId!);
      const rodados = lines.filter((l) => l.accountId === ventasRodadosId);
      expect(rodados).toHaveLength(1);
      expect(rodados[0].credit).toBe(1000);
      expect(lines.some((l) => l.accountId === ventasId)).toBe(false);
      expect(lines.find((l) => l.accountId === cobrarId)?.debit).toBe(1210);
      expect(lines.find((l) => l.accountId === ivaDfId)?.credit).toBe(210);
    });

    it('caso 2: ítem sin cuenta y global vacía → { success: false } nombrando el ítem; sigue en borrador', async () => {
      await setSalesAccount(null);
      const id = await createDraftSale(sinCuentaId, 'Aceite 10W40');

      const result = await confirmInvoice(id);
      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error).toBe(
        'No se puede confirmar el comprobante: la línea «Aceite 10W40» no tiene cuenta contable. ' +
          'Asignale una Cuenta de Ingresos al ítem (Ítems → Imputación contable) o configurá la ' +
          '"Cuenta de ventas por defecto" en Contabilidad → Configuración.'
      );

      const invoice = await readInvoice(id);
      expect(invoice.status).toBe('DRAFT');
      expect(invoice.journalEntryId).toBeNull();
    });

    it('caso 3: ítem sin cuenta con global configurada → confirma contra la cuenta de ventas por defecto', async () => {
      await setSalesAccount(ventasId);
      const id = await createDraftSale(sinCuentaId, 'Aceite 10W40');

      const result = await confirmInvoice(id);
      expect(result.success).toBe(true);

      const invoice = await readInvoice(id);
      expect(invoice.status).toBe('CONFIRMED');
      const lines = await fetchEntryLines(invoice.journalEntryId!);
      expect(lines.find((l) => l.accountId === ventasId)?.credit).toBe(1000);
    });

    it('caso 4: la cuenta del ítem está dada de baja → rechaza nombrándola, sin caer a la global', async () => {
      await setSalesAccount(ventasId);
      await prisma.account.update({ where: { id: ventasViejaId }, data: { isActive: false } });
      const id = await createDraftSale(cuentaViejaId, 'Rodado usado');

      try {
        const result = await confirmInvoice(id);
        expect(result.success).toBe(false);
        if (result.success) return;

        expect(result.error).toBe(
          `No se puede confirmar el comprobante: la cuenta ${VENTAS_VIEJA_CODE} - ${PREFIX}Ventas vieja ` +
            'del ítem de la línea «Rodado usado» no está activa o no es imputable. ' +
            'Corregila en Ítems → Imputación contable.'
        );

        const invoice = await readInvoice(id);
        expect(invoice.status).toBe('DRAFT');
        expect(invoice.journalEntryId).toBeNull();
        // No cayó a la global: no hay ningún asiento de esta factura.
        const asientos = await prisma.journalEntry.count({
          where: { companyId, description: { contains: invoice.fullNumber } },
        });
        expect(asientos).toBe(0);
      } finally {
        await prisma.account.update({ where: { id: ventasViejaId }, data: { isActive: true } });
      }
    });

    it('caso 5: nota de crédito de un ítem con cuenta → Debe en la cuenta del ítem, Haber en Cuentas por Cobrar', async () => {
      await setSalesAccount(null);
      const id = await createDraftSale(conCuentaId, 'Devolución rodado', {
        voucherType: 'NOTA_CREDITO_A',
        customerId: customerNcId,
      });

      const result = await confirmInvoice(id);
      expect(result.success).toBe(true);

      const invoice = await readInvoice(id);
      const lines = await fetchEntryLines(invoice.journalEntryId!);
      expect(lines.find((l) => l.accountId === ventasRodadosId)?.debit).toBe(1000);
      expect(lines.find((l) => l.accountId === cobrarId)?.credit).toBe(1210);
      expect(lines.some((l) => l.accountId === ventasId)).toBe(false);
    });

    it('caso 6: el asiento lanza si falta "Cuentas por Cobrar" (antes devolvía null)', async () => {
      await setSalesAccount(ventasId);
      await prisma.accountingSettings.update({
        where: { companyId },
        data: { receivablesAccountId: null },
      });
      const id = await createDraftSale(conCuentaId, 'Rodado 0km');

      try {
        await expect(
          prisma.$transaction((tx) => createJournalEntryForSalesInvoice(id, companyId, tx))
        ).rejects.toThrow(/Cuentas por Cobrar/);
      } finally {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { receivablesAccountId: cobrarId },
        });
      }
    });

    it('caso 7: falta la cuenta de IVA Débito Fiscal → error legible, sin asiento descuadrado ni factura confirmada', async () => {
      await setSalesAccount(null);
      await prisma.accountingSettings.update({
        where: { companyId },
        data: { vatDebitAccountId: null },
      });
      const id = await createDraftSale(conCuentaId, 'Rodado 0km');

      try {
        const result = await confirmInvoice(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain('IVA Débito Fiscal 21%');

        const invoice = await readInvoice(id);
        expect(invoice.status).toBe('DRAFT');
        expect(invoice.journalEntryId).toBeNull();
      } finally {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { vatDebitAccountId: ivaDfId },
        });
      }
    });

    it('caso 8: período cerrado → error legible y la transacción se revierte', async () => {
      await setSalesAccount(null);
      await prisma.accountingSettings.update({
        where: { companyId },
        data: { lockedUntilDate: new Date('2026-06-30') },
      });
      const id = await createDraftSale(conCuentaId, 'Rodado 0km');

      try {
        const result = await confirmInvoice(id);
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
  }
);
