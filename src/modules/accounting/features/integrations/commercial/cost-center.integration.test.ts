/**
 * Tests de integración del reparto por centro de costo (TSK-583) contra la
 * base real de desarrollo.
 *
 * Tarea 10 del plan de TSK-583. El plan original pedía un spec de Cypress,
 * pero Cypress no existe en este proyecto (sin carpeta `cypress/`, sin
 * scripts `cy:*`, sin ningún `.cy.ts`): es un remanente del proyecto base del
 * que este es fork. Se reemplaza por tests de integración con Vitest contra
 * la base local (Docker, puerto 5534), que es lo que el proyecto sí tiene.
 *
 * Hasta esta tarea, el asiento y la obligatoriedad del reparto se venían
 * verificando con scripts de Prisma que se borraban al terminar (Tareas 6, 7
 * y 9). Nada en el repo detectaba una regresión. Estos tests son la red de
 * seguridad permanente.
 *
 * Alcance: NO se re-testean las funciones puras de
 * `src/modules/commercial/shared/cost-center.ts` (`expandByCostCenter`,
 * `findLinesMissingCostCenter`, `prorateAmount`, etc.) — esas ya tienen 34
 * tests unitarios en `cost-center.test.ts`. Acá se ejercita la cadena real
 * contra la base: que el `select` de Prisma traiga lo que las funciones de
 * integración necesitan, que el mapeo de campos sea correcto, y que el
 * asiento que efectivamente queda grabado sea el esperado.
 *
 * Aislamiento de datos: todo lo que este archivo crea usa el prefijo
 * `TSK583-TEST-` (empresa, centros de costo, cuentas, proveedor, cliente,
 * productos). El `afterAll` borra todo en orden inverso de dependencias y
 * verifica que no sobrevive ninguna fila con el prefijo. No se toca ninguna
 * empresa ni configuración existente: se crea una empresa dedicada para la
 * corrida, con su propia `AccountingSettings`.
 *
 * Disponibilidad de la base: si Docker no está levantado, todo el archivo se
 * saltea con `describe.skipIf` (no falla) — así `npm test` sigue en verde
 * para quien no tenga la base local arriba. Ver el chequeo de conectividad
 * más abajo.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/shared/lib/prisma';
import {
  buildMissingCostCenterMessage,
  findLinesMissingCostCenter,
  type CostCenterLineCheck,
} from '@/modules/commercial/shared/cost-center';

import { createJournalEntryForPurchaseInvoice, createJournalEntryForSalesInvoice } from './index';

const PREFIX = 'TSK583-TEST-';

// ============================================
// Chequeo de disponibilidad de la base
// ============================================
//
// `prisma` (singleton de `@/shared/lib/prisma`) ya está creado en el momento
// en que se importan estos módulos (requiere `DATABASE_URL`, que viene del
// `.env` del repo vía `dotenv/config` de arriba). Lo que puede faltar es que
// Docker esté levantado: por eso el chequeo real es una consulta, no la sola
// presencia de la variable de entorno.
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
  costCenterId: string | null;
}

async function fetchEntryLines(entryId: string): Promise<JournalLineRow[]> {
  const rows = await prisma.journalEntryLine.findMany({
    where: { entryId },
    select: { accountId: true, debit: true, credit: true, costCenterId: true },
  });
  return rows.map((r) => ({
    accountId: r.accountId,
    debit: Number(r.debit),
    credit: Number(r.credit),
    costCenterId: r.costCenterId,
  }));
}

describe.skipIf(!dbAvailable)('integración: reparto por centro de costo contable (TSK-583)', () => {
  // Ids de andamiaje, creados una vez en el beforeAll de este describe.
  let companyId: string;
  let costCenter1Id: string;
  let costCenter2Id: string;

  let purchasesAccountId: string;
  let payablesAccountId: string;
  let vatCreditAccountId: string;
  let salesAccountId: string;
  let receivablesAccountId: string;
  let vatDebitAccountId: string;

  let supplierId: string;
  let customerId: string;
  let pointOfSaleId: string;

  let expenseProductId: string;
  let incomeProduct1Id: string;
  let incomeProduct2Id: string;

  // Documentos y asientos creados por los casos, para borrarlos en orden en
  // el afterAll (una factura de compra por caso 1-3, una de venta para el
  // caso 4, y otra de compra sin confirmar para el caso 5).
  const createdPurchaseInvoiceIds: string[] = [];
  const createdSalesInvoiceIds: string[] = [];
  const createdJournalEntryIds: string[] = [];

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const [costCenter1, costCenter2] = await Promise.all([
      prisma.costCenter.create({ data: { companyId, name: `${PREFIX}CC1` } }),
      prisma.costCenter.create({ data: { companyId, name: `${PREFIX}CC2` } }),
    ]);
    costCenter1Id = costCenter1.id;
    costCenter2Id = costCenter2.id;

    const [purchasesAccount, payablesAccount, vatCreditAccount, salesAccount, receivablesAccount, vatDebitAccount] =
      await Promise.all([
        prisma.account.create({
          data: { companyId, code: 'T583-COMPRAS', name: `${PREFIX}Compras`, type: 'EXPENSE', nature: 'DEBIT' },
        }),
        prisma.account.create({
          data: { companyId, code: 'T583-PAGAR', name: `${PREFIX}Cuentas por Pagar`, type: 'LIABILITY', nature: 'CREDIT' },
        }),
        prisma.account.create({
          data: { companyId, code: 'T583-IVACF', name: `${PREFIX}IVA Credito Fiscal`, type: 'ASSET', nature: 'DEBIT' },
        }),
        prisma.account.create({
          data: { companyId, code: 'T583-VENTAS', name: `${PREFIX}Ventas`, type: 'REVENUE', nature: 'CREDIT' },
        }),
        prisma.account.create({
          data: { companyId, code: 'T583-COBRAR', name: `${PREFIX}Cuentas por Cobrar`, type: 'ASSET', nature: 'DEBIT' },
        }),
        prisma.account.create({
          data: { companyId, code: 'T583-IVADF', name: `${PREFIX}IVA Debito Fiscal`, type: 'LIABILITY', nature: 'CREDIT' },
        }),
      ]);
    purchasesAccountId = purchasesAccount.id;
    payablesAccountId = payablesAccount.id;
    vatCreditAccountId = vatCreditAccount.id;
    salesAccountId = salesAccount.id;
    receivablesAccountId = receivablesAccount.id;
    vatDebitAccountId = vatDebitAccount.id;

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
        requireCostCenter: false,
      },
    });

    const supplier = await prisma.supplier.create({
      data: {
        companyId,
        code: `${PREFIX}PROV1`,
        businessName: `${PREFIX}Proveedor`,
        taxId: '30111111110',
        taxCondition: 'RESPONSABLE_INSCRIPTO',
        createdBy: 'test',
      },
    });
    supplierId = supplier.id;

    const customer = await prisma.contractor.create({
      data: { companyId, name: `${PREFIX}Cliente` },
    });
    customerId = customer.id;

    const pos = await prisma.salesPointOfSale.create({
      data: { companyId, number: 9999, name: `${PREFIX}PDV`, createdBy: 'test' },
    });
    pointOfSaleId = pos.id;

    // Ítem imputado a cuenta de egresos (caso 1-3 y caso 5).
    const expenseProduct = await prisma.product.create({
      data: {
        companyId,
        code: `${PREFIX}PROD-GASTO`,
        name: `${PREFIX}Gasto sin reparto`,
        defaultExpenseAccountId: purchasesAccountId,
        createdBy: 'test',
      },
    });
    expenseProductId = expenseProduct.id;

    // Dos ítems imputados a cuenta de ingresos, con centro predeterminado
    // DISTINTO cada uno: es el escenario del bug de la regresión (caso 4).
    const incomeProduct1 = await prisma.product.create({
      data: {
        companyId,
        code: `${PREFIX}PROD-ING1`,
        name: `${PREFIX}Ingreso Centro 1`,
        defaultIncomeAccountId: salesAccountId,
        defaultCostCenterId: costCenter1Id,
        createdBy: 'test',
      },
    });
    incomeProduct1Id = incomeProduct1.id;

    const incomeProduct2 = await prisma.product.create({
      data: {
        companyId,
        code: `${PREFIX}PROD-ING2`,
        name: `${PREFIX}Ingreso Centro 2`,
        defaultIncomeAccountId: salesAccountId,
        defaultCostCenterId: costCenter2Id,
        createdBy: 'test',
      },
    });
    incomeProduct2Id = incomeProduct2.id;
  });

  afterAll(async () => {
    // Orden inverso de dependencias: primero los documentos (cascadean sus
    // líneas y el reparto de cada línea), después los asientos (cascadean
    // sus imputaciones), después catálogos, después la empresa.
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
    await prisma.costCenter.deleteMany({ where: { companyId } });
    await prisma.supplier.deleteMany({ where: { companyId } });
    await prisma.contractor.deleteMany({ where: { companyId } });
    await prisma.salesPointOfSale.deleteMany({ where: { companyId } });
    await prisma.accountingSettings.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });

    // Verificación de que no sobrevive ninguna fila de la corrida.
    const [remainingCostCenters, remainingAccounts, remainingCompanies] = await Promise.all([
      prisma.costCenter.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
    ]);
    expect(remainingCostCenters).toBe(0);
    expect(remainingAccounts).toBe(0);
    expect(remainingCompanies).toBe(0);

    await prisma.$disconnect();
  });

  describe('caso 1-3: compra con reparto 60/40 entre dos centros de costo', () => {
    let lines: JournalLineRow[];

    beforeAll(async () => {
      const invoice = await prisma.purchaseInvoice.create({
        data: {
          companyId,
          supplierId,
          voucherType: 'FACTURA_A',
          pointOfSale: '0001',
          number: '00000001',
          fullNumber: '0001-00000001',
          issueDate: new Date('2026-01-15'),
          subtotal: 1000,
          netTaxed: 1000,
          vatAmount: 210,
          total: 1210,
          createdBy: 'test',
          lines: {
            create: [
              {
                productId: expenseProductId,
                description: `${PREFIX}Linea reparto 60/40`,
                quantity: 1,
                unitCost: 1000,
                lineType: 'TAXED',
                vatRate: 21,
                vatAmount: 210,
                subtotal: 1000,
                total: 1210,
                costCenterAllocations: {
                  create: [
                    { costCenterId: costCenter1Id, percentage: 60 },
                    { costCenterId: costCenter2Id, percentage: 40 },
                  ],
                },
              },
            ],
          },
        },
      });
      createdPurchaseInvoiceIds.push(invoice.id);

      const entryId = await prisma.$transaction((tx) =>
        createJournalEntryForPurchaseInvoice(invoice.id, companyId, tx)
      );
      expect(entryId).not.toBeNull();
      createdJournalEntryIds.push(entryId as string);

      lines = await fetchEntryLines(entryId as string);
    });

    it('genera dos imputaciones a la cuenta de compras, de 600 y 400, cada una con su centro', () => {
      const compras = lines.filter((l) => l.accountId === purchasesAccountId);
      expect(compras).toHaveLength(2);

      const porCentro = new Map(compras.map((l) => [l.costCenterId, l.debit]));
      expect(porCentro.get(costCenter1Id)).toBe(600);
      expect(porCentro.get(costCenter2Id)).toBe(400);
    });

    it('el IVA no se reparte: la línea de IVA no tiene centro de costo', () => {
      const iva = lines.filter((l) => l.accountId === vatCreditAccountId);
      expect(iva).toHaveLength(1);
      expect(iva[0].costCenterId).toBeNull();
      expect(iva[0].debit).toBe(210);
    });

    it('el asiento balancea: suma de debitos igual a suma de creditos', () => {
      const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(1210);
    });
  });

  describe('caso 4: venta con ítems de centros distintos (regresión del bug de la Tarea 9)', () => {
    let lines: JournalLineRow[];

    beforeAll(async () => {
      const invoice = await prisma.salesInvoice.create({
        data: {
          companyId,
          customerId,
          pointOfSaleId,
          voucherType: 'FACTURA_A',
          number: 1,
          fullNumber: '0001-00000001',
          issueDate: new Date('2026-01-15'),
          subtotal: 800,
          netTaxed: 800,
          vatAmount: 168,
          total: 968,
          totalBeforeDiscount: 968,
          discountTotal: 0,
          createdBy: 'test',
          lines: {
            create: [
              {
                productId: incomeProduct1Id,
                description: `${PREFIX}Linea centro 1`,
                quantity: 1,
                unitPrice: 500,
                lineType: 'TAXED',
                vatRate: 21,
                vatAmount: 105,
                subtotal: 500,
                total: 605,
              },
              {
                productId: incomeProduct2Id,
                description: `${PREFIX}Linea centro 2`,
                quantity: 1,
                unitPrice: 300,
                lineType: 'TAXED',
                vatRate: 21,
                vatAmount: 63,
                subtotal: 300,
                total: 363,
              },
            ],
          },
        },
      });
      createdSalesInvoiceIds.push(invoice.id);

      const entryId = await prisma.$transaction((tx) => createJournalEntryForSalesInvoice(invoice.id, companyId, tx));
      expect(entryId).not.toBeNull();
      createdJournalEntryIds.push(entryId as string);

      lines = await fetchEntryLines(entryId as string);
    });

    it('genera dos imputaciones separadas a la cuenta de ventas, una por centro predeterminado del ítem', () => {
      const ventas = lines.filter((l) => l.accountId === salesAccountId);
      // Antes de la Tarea 9, `expandByCostCenter` agrupaba solo por cuenta y
      // estas dos líneas colapsaban en una sola imputación de 800.
      expect(ventas).toHaveLength(2);

      const porCentro = new Map(ventas.map((l) => [l.costCenterId, l.credit]));
      expect(porCentro.get(costCenter1Id)).toBe(500);
      expect(porCentro.get(costCenter2Id)).toBe(300);
    });
  });

  describe('caso 5: obligatoriedad del centro de costo al confirmar', () => {
    // `confirmPurchaseInvoice` (purchases/features/invoices/list/actions.server.ts)
    // es un Server Action de Next: usa `checkPermission`, `getCurrentUserId` y
    // `getActiveCompanyId`, que dependen de la sesión/el request de Clerk y no
    // se pueden invocar desde un test de Vitest sin montar ese contexto.
    //
    // Camino elegido: replicar acá la MISMA consulta y la MISMA llamada a
    // `findLinesMissingCostCenter` que hace `confirmPurchaseInvoice` (mismo
    // `select`, mismo mapeo de `accountType`/`allocations`, mismo `if
    // (settings?.requireCostCenter)`), y usar `buildMissingCostCenterMessage`
    // real para el mensaje.
    //
    // Qué protege: que esa consulta + `findLinesMissingCostCenter` +
    // `buildMissingCostCenterMessage`, ejecutadas contra la base real, dan el
    // resultado correcto. Qué NO protege: que `confirmPurchaseInvoice` siga
    // usando esta misma lógica. Si alguien cambia el `select`, el orden del
    // `if`, o deja de llamar a `findLinesMissingCostCenter` dentro del action
    // real sin tocar `cost-center.ts`, este test sigue en verde y no lo
    // detecta.
    let invoiceId: string;

    async function replicateConfirmValidation(): Promise<{ blocked: boolean; missing: CostCenterLineCheck[] }> {
      const settings = await prisma.accountingSettings.findUnique({
        where: { companyId },
        select: { requireCostCenter: true },
      });

      if (!settings?.requireCostCenter) return { blocked: false, missing: [] };

      const invoice = await prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: {
          lines: {
            include: {
              product: { include: { defaultExpenseAccount: { select: { type: true } } } },
              costCenterAllocations: true,
            },
          },
        },
      });

      const missing = findLinesMissingCostCenter(
        invoice.lines.map((line) => ({
          description: line.description,
          accountType: line.product?.defaultExpenseAccount?.type ?? null,
          allocations: line.costCenterAllocations.map((a) => ({
            costCenterId: a.costCenterId,
            percentage: Number(a.percentage),
          })),
        }))
      );

      return { blocked: missing.length > 0, missing };
    }

    beforeAll(async () => {
      const invoice = await prisma.purchaseInvoice.create({
        data: {
          companyId,
          supplierId,
          voucherType: 'FACTURA_A',
          pointOfSale: '0001',
          number: '00000002',
          fullNumber: '0001-00000002',
          issueDate: new Date('2026-01-20'),
          subtotal: 500,
          netTaxed: 500,
          vatAmount: 105,
          total: 605,
          createdBy: 'test',
          lines: {
            create: [
              {
                productId: expenseProductId,
                description: `${PREFIX}Gasto sin reparto`,
                quantity: 1,
                unitCost: 500,
                lineType: 'TAXED',
                vatRate: 21,
                vatAmount: 105,
                subtotal: 500,
                total: 605,
                // Sin costCenterAllocations: es justo lo que falta.
              },
            ],
          },
        },
      });
      invoiceId = invoice.id;
      createdPurchaseInvoiceIds.push(invoice.id);
    });

    it('con requireCostCenter=true, bloquea y el mensaje nombra la línea sin reparto', async () => {
      await prisma.accountingSettings.update({ where: { companyId }, data: { requireCostCenter: true } });

      const { blocked, missing } = await replicateConfirmValidation();

      expect(blocked).toBe(true);
      expect(missing).toHaveLength(1);
      expect(buildMissingCostCenterMessage(missing)).toContain(`${PREFIX}Gasto sin reparto`);
    });

    it('con requireCostCenter=false, la misma factura no queda bloqueada', async () => {
      await prisma.accountingSettings.update({ where: { companyId }, data: { requireCostCenter: false } });

      const { blocked } = await replicateConfirmValidation();

      expect(blocked).toBe(false);
    });
  });
});
