/**
 * TSK-721 — Diagnóstico de facturas confirmadas SIN asiento contable.
 *
 * Contexto: hasta este ticket, cuando una factura de venta o de compra se
 * confirmaba y alguna línea no tenía cuenta contable resoluble (ni en el ítem,
 * ni en la configuración contable de la empresa), la integración contable
 * devolvía `null` en silencio: la factura quedaba **confirmada sin asiento** y
 * nadie se enteraba. Desde TSK-721 esa situación bloquea la confirmación con un
 * error claro, pero los comprobantes que ya cayeron en el comportamiento
 * anterior siguen en la base sin `journal_entry_id`.
 *
 * Este script SOLO LEE. No hace ningún UPDATE ni INSERT: cada comprobante que
 * lista requiere una decisión contable (generar el asiento a mano o revertir y
 * reconfirmar) y eso es otro ticket. Lista, ordenado por empresa y fecha:
 *
 *   - Facturas de venta y de compra "confirmadas" (status distinto de DRAFT y
 *     de CANCELLED; es decir CONFIRMED, PAID o PARTIAL_PAID) con
 *     `journal_entry_id IS NULL`, con tipo, empresa, número, fecha, tercero,
 *     total, estado e id.
 *   - Al final, conteo y suma de `total` por tipo (VENTA / COMPRA) y por
 *     empresa.
 *
 * === Cómo correrlo en dev ===
 *
 *     npx tsx prisma/scripts/diagnose-invoices-without-entry.ts
 *
 *   Idempotente por construcción: no escribe nada. Carga `DATABASE_URL` desde
 *   `.env` vía dotenv.
 *
 * === Cómo correrlo en producción (SQL equivalente) ===
 *   La imagen `runner` de producción NO tiene `tsx` ni `src/` (memoria
 *   `produccion-dokploy-scripts-db`), así que este script no se puede ejecutar
 *   dentro del contenedor de la app. En prod se abre `psql` en el contenedor de
 *   Postgres y se pega el SQL de abajo, que devuelve exactamente las mismas
 *   filas que el script (verificado en dev contra `contable-pms-db`):
 *
 *     sudo docker exec -it $(sudo docker ps -q --filter name=contablemas-contablemas) \
 *       sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
 *
 *   -- 1) Detalle: comprobantes confirmados sin asiento, por empresa y fecha.
 *   --    `status::text` es obligatorio: `sales_invoice_status` y `purchase_invoice_status`
 *   --    son enums distintos y el UNION ALL no los puede unificar sin el cast.
 *   SELECT 'VENTA' AS tipo, c.name AS empresa, s.full_number AS numero, s.voucher_type,
 *          s.issue_date::date AS fecha, k.name AS tercero, s.total, s.status::text AS status, s.id
 *   FROM sales_invoices s
 *   JOIN companies c   ON c.id = s.company_id
 *   JOIN contractors k ON k.id = s.customer_id
 *   WHERE s.status NOT IN ('DRAFT','CANCELLED') AND s.journal_entry_id IS NULL
 *   UNION ALL
 *   SELECT 'COMPRA', c.name, p.full_number, p.voucher_type,
 *          p.issue_date::date, v.business_name, p.total, p.status::text, p.id
 *   FROM purchase_invoices p
 *   JOIN companies c ON c.id = p.company_id
 *   JOIN suppliers v ON v.id = p.supplier_id
 *   WHERE p.status NOT IN ('DRAFT','CANCELLED') AND p.journal_entry_id IS NULL
 *   ORDER BY 2, 5, 1;
 *
 *   -- 2) Resumen: conteo y suma por empresa y tipo
 *   SELECT c.name AS empresa, 'VENTA' AS tipo, count(*) AS cantidad, sum(s.total) AS total
 *   FROM sales_invoices s JOIN companies c ON c.id = s.company_id
 *   WHERE s.status NOT IN ('DRAFT','CANCELLED') AND s.journal_entry_id IS NULL
 *   GROUP BY 1
 *   UNION ALL
 *   SELECT c.name, 'COMPRA', count(*), sum(p.total)
 *   FROM purchase_invoices p JOIN companies c ON c.id = p.company_id
 *   WHERE p.status NOT IN ('DRAFT','CANCELLED') AND p.journal_entry_id IS NULL
 *   GROUP BY 1
 *   ORDER BY 1, 2;
 *
 *   -- 3) Ítems activos sin cuenta, por uso (dato que la clienta necesita ANTES de
 *   --    vaciar la cuenta global de ventas/compras; análisis 1.2.3 del plan).
 *   --    Reemplazar <COMPANY_ID> por el uuid de la empresa (SELECT id, name FROM companies;).
 *   SELECT usage,
 *          count(*) FILTER (WHERE default_income_account_id IS NULL)  AS sin_ingreso,
 *          count(*) FILTER (WHERE default_expense_account_id IS NULL) AS sin_egreso,
 *          count(*) AS total
 *   FROM products
 *   WHERE company_id = '<COMPANY_ID>' AND status = 'ACTIVE'
 *   GROUP BY 1;
 */

import 'dotenv/config';
import moment from 'moment';
import { Prisma } from '../../src/generated/prisma/client';
import { prisma } from '../../src/shared/lib/prisma';

/** "Confirmada" = todo lo que no es borrador ni anulada: CONFIRMED, PAID, PARTIAL_PAID. */
const NOT_CONFIRMED_STATUSES = ['DRAFT', 'CANCELLED'] as const;

type InvoiceKind = 'VENTA' | 'COMPRA';

interface InvoiceWithoutEntry {
  kind: InvoiceKind;
  companyId: string;
  companyName: string;
  fullNumber: string;
  voucherType: string;
  issueDate: Date;
  thirdParty: string;
  total: Prisma.Decimal;
  status: string;
  id: string;
}

interface KindSummary {
  count: number;
  total: Prisma.Decimal;
}

interface CompanySummary {
  companyId: string;
  companyName: string;
  sales: KindSummary;
  purchases: KindSummary;
  rows: InvoiceWithoutEntry[];
}

const emptySummary = (): KindSummary => ({ count: 0, total: new Prisma.Decimal(0) });

async function findInvoicesWithoutEntry(): Promise<InvoiceWithoutEntry[]> {
  const [sales, purchases] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: {
        status: { notIn: [...NOT_CONFIRMED_STATUSES] },
        journalEntryId: null,
      },
      select: {
        id: true,
        companyId: true,
        company: { select: { name: true } },
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        total: true,
        status: true,
        customer: { select: { name: true } },
      },
      orderBy: [{ companyId: 'asc' }, { issueDate: 'asc' }],
    }),
    prisma.purchaseInvoice.findMany({
      where: {
        status: { notIn: [...NOT_CONFIRMED_STATUSES] },
        journalEntryId: null,
      },
      select: {
        id: true,
        companyId: true,
        company: { select: { name: true } },
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        total: true,
        status: true,
        supplier: { select: { businessName: true } },
      },
      orderBy: [{ companyId: 'asc' }, { issueDate: 'asc' }],
    }),
  ]);

  const rows: InvoiceWithoutEntry[] = [
    ...sales.map((inv) => ({
      kind: 'VENTA' as const,
      companyId: inv.companyId,
      companyName: inv.company.name,
      fullNumber: inv.fullNumber,
      voucherType: inv.voucherType,
      issueDate: inv.issueDate,
      thirdParty: inv.customer.name,
      total: inv.total,
      status: inv.status,
      id: inv.id,
    })),
    ...purchases.map((inv) => ({
      kind: 'COMPRA' as const,
      companyId: inv.companyId,
      companyName: inv.company.name,
      fullNumber: inv.fullNumber,
      voucherType: inv.voucherType,
      issueDate: inv.issueDate,
      thirdParty: inv.supplier.businessName,
      total: inv.total,
      status: inv.status,
      id: inv.id,
    })),
  ];

  // Mismo orden que el SQL del encabezado: empresa, fecha, tipo.
  return rows.sort(
    (a, b) =>
      a.companyName.localeCompare(b.companyName) ||
      a.issueDate.getTime() - b.issueDate.getTime() ||
      a.kind.localeCompare(b.kind)
  );
}

function groupByCompany(rows: InvoiceWithoutEntry[]): CompanySummary[] {
  const byCompany = new Map<string, CompanySummary>();

  for (const row of rows) {
    let summary = byCompany.get(row.companyId);
    if (!summary) {
      summary = {
        companyId: row.companyId,
        companyName: row.companyName,
        sales: emptySummary(),
        purchases: emptySummary(),
        rows: [],
      };
      byCompany.set(row.companyId, summary);
    }
    const bucket = row.kind === 'VENTA' ? summary.sales : summary.purchases;
    bucket.count += 1;
    bucket.total = bucket.total.plus(row.total);
    summary.rows.push(row);
  }

  return [...byCompany.values()];
}

function formatRow(row: InvoiceWithoutEntry): string {
  return (
    `${row.kind.padEnd(6)} | ${row.companyName} | ${row.fullNumber} (${row.voucherType}) | ` +
    `${moment.utc(row.issueDate).format('DD/MM/YYYY')} | ${row.thirdParty} | ` +
    `total ${row.total.toString()} | ${row.status} | id ${row.id}`
  );
}

async function main() {
  const rows = await findInvoicesWithoutEntry();
  const companies = groupByCompany(rows);

  console.log('--- Facturas confirmadas (no DRAFT / no CANCELLED) SIN asiento contable ---');
  console.log('(solo lectura: no se corrige nada)');
  console.log('');

  if (rows.length === 0) {
    console.log('Ninguna. Nada que revisar.');
    return;
  }

  for (const company of companies) {
    console.log(`== ${company.companyName} (${company.companyId}) ==`);
    for (const row of company.rows) {
      console.log(`  ${formatRow(row)}`);
    }
    console.log(
      `  Subtotal ${company.companyName}: ` +
        `VENTA ${company.sales.count} comprobante(s), total ${company.sales.total.toString()} | ` +
        `COMPRA ${company.purchases.count} comprobante(s), total ${company.purchases.total.toString()}`
    );
    console.log('');
  }

  const totals = companies.reduce(
    (acc, company) => ({
      sales: {
        count: acc.sales.count + company.sales.count,
        total: acc.sales.total.plus(company.sales.total),
      },
      purchases: {
        count: acc.purchases.count + company.purchases.count,
        total: acc.purchases.total.plus(company.purchases.total),
      },
    }),
    { sales: emptySummary(), purchases: emptySummary() }
  );

  console.log('--- Totales ---');
  console.log(
    `VENTA:  ${totals.sales.count} comprobante(s), total ${totals.sales.total.toString()}`
  );
  console.log(
    `COMPRA: ${totals.purchases.count} comprobante(s), total ${totals.purchases.total.toString()}`
  );
  console.log(`Total a revisar: ${rows.length} comprobante(s) en ${companies.length} empresa(s).`);
  console.log('');
  console.log(
    'Son comprobantes que se confirmaron sin asiento por el comportamiento anterior ' +
      '(falta de cuenta contable tragada en silencio). No se corrigen automáticamente: ' +
      'cada uno requiere decisión contable (generar el asiento a mano o revertir y reconfirmar).'
  );
}

main()
  .catch((error) => {
    console.error('Error en el diagnóstico de facturas sin asiento:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
