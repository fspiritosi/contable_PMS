/**
 * Tests de integración de percepciones e impuestos internos (TSK-644) contra
 * la base real de desarrollo.
 *
 * Sigue el molde de `cost-center.integration.test.ts`: el `describe.skipIf`
 * cuando no hay base, un prefijo propio en todo lo que se crea, y la limpieza
 * + verificación en el `afterAll`. Reemplaza a las tareas 9.1-9.4 del plan,
 * que pedían specs de Cypress: Cypress no existe en este proyecto (sin
 * carpeta `cypress/`, sin scripts `cy:*`, sin ningún `.cy.ts`) — es un
 * remanente del proyecto base del que este es fork, ya documentado en
 * TSK-583.
 *
 * Alcance: NO se re-testean las funciones puras de
 * `@/modules/commercial/shared/perceptions` (`calculateOtherTaxes`,
 * `derivePerceptionRate`, `toPerceptionRecords`) — ya tienen 17 tests
 * unitarios en `perceptions.test.ts`. Acá se ejercita la cadena real contra
 * la base: que el `select` traiga los tributos, que cada uno caiga en su
 * cuenta, que el asiento cierre contra el total del comprobante, y que la
 * falta de una cuenta configurada se detecte en vez de producir un asiento
 * descuadrado.
 *
 * Los importes son los de la factura de La Anónima que adjunta el ticket.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

import {
  createJournalEntryForPurchaseInvoice,
  createJournalEntryForSalesInvoice,
} from './index';

const PREFIX = 'TSK644-TEST-';

// Importes de la factura del ticket.
const NETO_21 = 91957.84;
const NETO_105 = 91284.86;
const IVA_21 = 19311.15;
const IVA_105 = 9584.91;
const PERCEP_NQN = 1832.43;
const PERCEP_IVA = 4128.01;
const IMP_INTERNOS = 326.95;

const NETO_TOTAL = NETO_21 + NETO_105; // 183242.70
const IVA_TOTAL = IVA_21 + IVA_105; // 28896.06
const OTHER_TAXES = PERCEP_NQN + PERCEP_IVA + IMP_INTERNOS; // 6287.39
const TOTAL = Math.round((NETO_TOTAL + IVA_TOTAL + OTHER_TAXES) * 100) / 100; // 218426.15

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
  description: string;
}

async function fetchEntryLines(entryId: string): Promise<JournalLineRow[]> {
  const rows = await prisma.journalEntryLine.findMany({
    where: { entryId },
    select: { accountId: true, debit: true, credit: true, description: true },
  });
  return rows.map((r) => ({
    accountId: r.accountId,
    debit: Number(r.debit),
    credit: Number(r.credit),
    description: r.description ?? '',
  }));
}

describe.skipIf(!dbAvailable)('integración: percepciones e impuestos internos (TSK-644)', () => {
  let companyId: string;

  let purchasesAccountId: string;
  let payablesAccountId: string;
  let vatCreditAccountId: string;
  let salesAccountId: string;
  let receivablesAccountId: string;
  let vatDebitAccountId: string;
  let percIvaSufferedAccountId: string;
  let percIibbSufferedAccountId: string;
  let percMunicipalSufferedAccountId: string;
  let percIvaCollectedAccountId: string;
  let internalTaxesAccountId: string;

  let supplierId: string;
  let customerId: string;
  let pointOfSaleId: string;
  let expenseProductId: string;
  let incomeProductId: string;

  const createdPurchaseInvoiceIds: string[] = [];
  const createdSalesInvoiceIds: string[] = [];
  const createdJournalEntryIds: string[] = [];

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const makeAccount = (code: string, name: string, type: 'ASSET' | 'LIABILITY' | 'EXPENSE' | 'REVENUE', nature: 'DEBIT' | 'CREDIT') =>
      prisma.account.create({
        data: { companyId, code, name: `${PREFIX}${name}`, type, nature },
      });

    const [
      purchasesAccount,
      payablesAccount,
      vatCreditAccount,
      salesAccount,
      receivablesAccount,
      vatDebitAccount,
      percIvaSuffered,
      percIibbSuffered,
      percMunicipalSuffered,
      percIvaCollected,
      internalTaxes,
    ] = await Promise.all([
      makeAccount('T644-COMPRAS', 'Compras', 'EXPENSE', 'DEBIT'),
      makeAccount('T644-PAGAR', 'Cuentas por Pagar', 'LIABILITY', 'CREDIT'),
      makeAccount('T644-IVACF', 'IVA Credito Fiscal', 'ASSET', 'DEBIT'),
      makeAccount('T644-VENTAS', 'Ventas', 'REVENUE', 'CREDIT'),
      makeAccount('T644-COBRAR', 'Cuentas por Cobrar', 'ASSET', 'DEBIT'),
      makeAccount('T644-IVADF', 'IVA Debito Fiscal', 'LIABILITY', 'CREDIT'),
      makeAccount('T644-PERCIVA-S', 'Perc IVA Sufrida', 'ASSET', 'DEBIT'),
      makeAccount('T644-PERCIIBB-S', 'Perc IIBB Sufrida', 'ASSET', 'DEBIT'),
      makeAccount('T644-PERCMUN-S', 'Perc Municipal Sufrida', 'ASSET', 'DEBIT'),
      makeAccount('T644-PERCIVA-C', 'Perc IVA Cobrada', 'LIABILITY', 'CREDIT'),
      makeAccount('T644-IMPINT', 'Impuestos Internos', 'EXPENSE', 'DEBIT'),
    ]);

    purchasesAccountId = purchasesAccount.id;
    payablesAccountId = payablesAccount.id;
    vatCreditAccountId = vatCreditAccount.id;
    salesAccountId = salesAccount.id;
    receivablesAccountId = receivablesAccount.id;
    vatDebitAccountId = vatDebitAccount.id;
    percIvaSufferedAccountId = percIvaSuffered.id;
    percIibbSufferedAccountId = percIibbSuffered.id;
    percMunicipalSufferedAccountId = percMunicipalSuffered.id;
    percIvaCollectedAccountId = percIvaCollected.id;
    internalTaxesAccountId = internalTaxes.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        purchasesAccountId,
        payablesAccountId,
        vatCreditAccountId,
        salesAccountId,
        receivablesAccountId,
        vatDebitAccountId,
        perceptionIvaSufferedAccountId: percIvaSufferedAccountId,
        perceptionIibbSufferedAccountId: percIibbSufferedAccountId,
        perceptionMunicipalSufferedAccountId: percMunicipalSufferedAccountId,
        perceptionIvaCollectedAccountId: percIvaCollectedAccountId,
        internalTaxesAccountId,
        requireCostCenter: false,
      },
    });

    const [supplier, customer, pointOfSale] = await Promise.all([
      prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}PROV1`,
          businessName: `${PREFIX}Proveedor`,
          taxId: '30644000019',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
      }),
      // El cliente es `Contractor` en este modelo, no `Customer`.
      prisma.contractor.create({
        data: { companyId, name: `${PREFIX}Cliente` },
      }),
      prisma.salesPointOfSale.create({
        data: { companyId, number: 9644, name: `${PREFIX}PV1`, createdBy: 'test' },
      }),
    ]);
    supplierId = supplier.id;
    customerId = customer.id;
    pointOfSaleId = pointOfSale.id;

    const [expenseProduct, incomeProduct] = await Promise.all([
      prisma.product.create({
        data: {
          companyId,
          code: `${PREFIX}GASTO`,
          name: `${PREFIX}Mercaderia`,
          defaultExpenseAccountId: purchasesAccountId,
          createdBy: 'test',
        },
      }),
      prisma.product.create({
        data: {
          companyId,
          code: `${PREFIX}INGRESO`,
          name: `${PREFIX}Servicio`,
          defaultIncomeAccountId: salesAccountId,
          createdBy: 'test',
        },
      }),
    ]);
    expenseProductId = expenseProduct.id;
    incomeProductId = incomeProduct.id;
  });

  afterAll(async () => {
    for (const id of createdPurchaseInvoiceIds) {
      await prisma.purchaseInvoice.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdSalesInvoiceIds) {
      await prisma.salesInvoice.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdJournalEntryIds) {
      await prisma.journalEntry.delete({ where: { id } }).catch(() => undefined);
    }

    await prisma.product.deleteMany({ where: { companyId } });
    await prisma.supplier.deleteMany({ where: { companyId } });
    await prisma.contractor.deleteMany({ where: { companyId } });
    await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
    await prisma.accountingSettings.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });

    const [remainingAccounts, remainingCompanies] = await Promise.all([
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
    ]);
    expect(remainingAccounts).toBe(0);
    expect(remainingCompanies).toBe(0);

    await prisma.$disconnect();
  });

  /** Factura de compra con los importes del ticket, dos netos y dos alícuotas. */
  async function createTicketPurchaseInvoice(
    number: string,
    overrides: {
      perceptions?: Array<{
        type: 'IVA' | 'IIBB' | 'MUNICIPAL';
        jurisdiction?: string;
        amount: number;
      }>;
      internalTaxes?: number;
    } = {}
  ) {
    const perceptions = overrides.perceptions ?? [
      { type: 'IIBB' as const, jurisdiction: 'NQN', amount: PERCEP_NQN },
      { type: 'IVA' as const, amount: PERCEP_IVA },
    ];
    const internalTaxes = overrides.internalTaxes ?? IMP_INTERNOS;
    const otherTaxes =
      Math.round(
        (perceptions.reduce((s, p) => s + p.amount, 0) + internalTaxes) * 100
      ) / 100;

    return prisma.purchaseInvoice.create({
      data: {
        companyId,
        supplierId,
        voucherType: 'FACTURA_A',
        pointOfSale: '0001',
        number,
        fullNumber: `0001-${number}`,
        issueDate: new Date('2026-01-15'),
        subtotal: NETO_TOTAL,
        netTaxed: NETO_TOTAL,
        vatAmount: IVA_TOTAL,
        internalTaxes,
        otherTaxes,
        total: Math.round((NETO_TOTAL + IVA_TOTAL + otherTaxes) * 100) / 100,
        createdBy: 'test',
        lines: {
          create: [
            {
              productId: expenseProductId,
              description: `${PREFIX}Neto 21`,
              quantity: 1,
              unitCost: NETO_21,
              lineType: 'TAXED',
              vatRate: 21,
              vatAmount: IVA_21,
              subtotal: NETO_21,
              total: NETO_21 + IVA_21,
            },
            {
              productId: expenseProductId,
              description: `${PREFIX}Neto 10.5`,
              quantity: 1,
              unitCost: NETO_105,
              lineType: 'TAXED',
              vatRate: 10.5,
              vatAmount: IVA_105,
              subtotal: NETO_105,
              total: NETO_105 + IVA_105,
            },
          ],
        },
        perceptions: {
          create: perceptions.map((p) => ({
            type: p.type,
            jurisdiction: p.jurisdiction ?? null,
            rate: Math.round((p.amount / NETO_TOTAL) * 100 * 1000) / 1000,
            baseAmount: NETO_TOTAL,
            amount: p.amount,
          })),
        },
      },
    });
  }

  describe('compra con percepciones e impuestos internos (factura del ticket)', () => {
    let lines: JournalLineRow[];

    beforeAll(async () => {
      const invoice = await createTicketPurchaseInvoice('00000001');
      createdPurchaseInvoiceIds.push(invoice.id);

      const entryId = await prisma.$transaction((tx) =>
        createJournalEntryForPurchaseInvoice(invoice.id, companyId, tx)
      );
      expect(entryId).not.toBeNull();
      createdJournalEntryIds.push(entryId as string);

      lines = await fetchEntryLines(entryId as string);
    });

    it('imputa cada percepción a su cuenta, al debe', () => {
      const percIibb = lines.filter((l) => l.accountId === percIibbSufferedAccountId);
      expect(percIibb).toHaveLength(1);
      expect(percIibb[0].debit).toBe(PERCEP_NQN);
      expect(percIibb[0].description).toContain('NQN');

      const percIva = lines.filter((l) => l.accountId === percIvaSufferedAccountId);
      expect(percIva).toHaveLength(1);
      expect(percIva[0].debit).toBe(PERCEP_IVA);
    });

    it('imputa los impuestos internos a su propia cuenta', () => {
      const impInt = lines.filter((l) => l.accountId === internalTaxesAccountId);
      expect(impInt).toHaveLength(1);
      expect(impInt[0].debit).toBe(IMP_INTERNOS);
      expect(impInt[0].credit).toBe(0);
    });

    it('acredita a proveedores el total con tributos incluidos', () => {
      const payables = lines.filter((l) => l.accountId === payablesAccountId);
      expect(payables).toHaveLength(1);
      expect(payables[0].credit).toBe(TOTAL);
    });

    it('el asiento balancea contra el total del comprobante', () => {
      const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
      expect(Math.round(totalDebit * 100) / 100).toBe(TOTAL);
      expect(Math.round(totalCredit * 100) / 100).toBe(TOTAL);
    });

    it('el IVA sigue discriminado por alícuota', () => {
      const iva = lines.filter((l) => l.accountId === vatCreditAccountId);
      expect(iva).toHaveLength(2);
      expect(iva.map((l) => l.debit).sort((a, b) => a - b)).toEqual([IVA_105, IVA_21]);
    });
  });

  describe('percepción municipal', () => {
    it('se imputa a su cuenta en vez de descartarse del asiento', async () => {
      const invoice = await createTicketPurchaseInvoice('00000002', {
        perceptions: [{ type: 'MUNICIPAL', jurisdiction: 'CABA', amount: 500 }],
        internalTaxes: 0,
      });
      createdPurchaseInvoiceIds.push(invoice.id);

      const entryId = await prisma.$transaction((tx) =>
        createJournalEntryForPurchaseInvoice(invoice.id, companyId, tx)
      );
      createdJournalEntryIds.push(entryId as string);

      const lines = await fetchEntryLines(entryId as string);
      const municipal = lines.filter((l) => l.accountId === percMunicipalSufferedAccountId);

      expect(municipal).toHaveLength(1);
      expect(municipal[0].debit).toBe(500);

      const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
      expect(Math.round((totalDebit - totalCredit) * 100) / 100).toBe(0);
    });
  });

  describe('cuenta de tributo sin configurar', () => {
    it('falla con un mensaje que nombra la cuenta faltante, sin dejar asiento descuadrado', async () => {
      await prisma.accountingSettings.update({
        where: { companyId },
        data: { internalTaxesAccountId: null },
      });

      const invoice = await createTicketPurchaseInvoice('00000003');
      createdPurchaseInvoiceIds.push(invoice.id);

      await expect(
        prisma.$transaction((tx) =>
          createJournalEntryForPurchaseInvoice(invoice.id, companyId, tx)
        )
      ).rejects.toThrow(/impuestos internos/i);

      // No quedó ningún asiento a medio crear para esa factura.
      const stillWithoutEntry = await prisma.purchaseInvoice.findUnique({
        where: { id: invoice.id },
        select: { journalEntryId: true },
      });
      expect(stillWithoutEntry?.journalEntryId).toBeNull();

      await prisma.accountingSettings.update({
        where: { companyId },
        data: { internalTaxesAccountId },
      });
    });
  });

  describe('venta con percepciones e impuestos internos', () => {
    let lines: JournalLineRow[];
    const netoVenta = 100000;
    const ivaVenta = 21000;
    const percVenta = 3000;
    const impIntVenta = 500;
    const totalVenta = netoVenta + ivaVenta + percVenta + impIntVenta;

    beforeAll(async () => {
      const invoice = await prisma.salesInvoice.create({
        data: {
          companyId,
          customerId,
          pointOfSaleId,
          voucherType: 'FACTURA_A',
          number: 1,
          fullNumber: '0001-00000001',
          issueDate: new Date('2026-01-20'),
          subtotal: netoVenta,
          netTaxed: netoVenta,
          vatAmount: ivaVenta,
          internalTaxes: impIntVenta,
          otherTaxes: percVenta + impIntVenta,
          total: totalVenta,
          createdBy: 'test',
          lines: {
            create: [
              {
                productId: incomeProductId,
                description: `${PREFIX}Servicio`,
                quantity: 1,
                unitPrice: netoVenta,
                lineType: 'TAXED',
                vatRate: 21,
                vatAmount: ivaVenta,
                subtotal: netoVenta,
                total: netoVenta + ivaVenta,
              },
            ],
          },
          perceptions: {
            create: [
              {
                type: 'IVA',
                jurisdiction: null,
                rate: 3,
                baseAmount: netoVenta,
                amount: percVenta,
              },
            ],
          },
        },
      });
      createdSalesInvoiceIds.push(invoice.id);

      const entryId = await prisma.$transaction((tx) =>
        createJournalEntryForSalesInvoice(invoice.id, companyId, tx)
      );
      expect(entryId).not.toBeNull();
      createdJournalEntryIds.push(entryId as string);

      lines = await fetchEntryLines(entryId as string);
    });

    it('acredita la percepción cobrada como pasivo', () => {
      const perc = lines.filter((l) => l.accountId === percIvaCollectedAccountId);
      expect(perc).toHaveLength(1);
      expect(perc[0].credit).toBe(percVenta);
      expect(perc[0].debit).toBe(0);
    });

    it('acredita los impuestos internos', () => {
      const impInt = lines.filter((l) => l.accountId === internalTaxesAccountId);
      expect(impInt).toHaveLength(1);
      expect(impInt[0].credit).toBe(impIntVenta);
    });

    it('debita a clientes el total con tributos y el asiento balancea', () => {
      const receivables = lines.filter((l) => l.accountId === receivablesAccountId);
      expect(receivables).toHaveLength(1);
      expect(receivables[0].debit).toBe(totalVenta);

      const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(totalVenta);
    });
  });
});
