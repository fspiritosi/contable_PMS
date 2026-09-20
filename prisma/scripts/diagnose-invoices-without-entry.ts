/**
 * Diagnóstico de comprobantes confirmados SIN asiento contable
 * (TSK-721 facturas; TSK-728 recibos, órdenes de pago y gastos).
 *
 * Contexto: hasta TSK-721, cuando una factura de venta o de compra se
 * confirmaba y alguna línea no tenía cuenta contable resoluble (ni en el ítem,
 * ni en la configuración contable de la empresa), la integración contable
 * devolvía `null` en silencio: la factura quedaba **confirmada sin asiento** y
 * nadie se enteraba. TSK-728 cierra el mismo agujero en recibos de cobro,
 * órdenes de pago (OP) y gastos: sin cuenta de Cobrar/Pagar, de la caja o del
 * banco, de una retención, o con un medio de pago que todavía no tiene cuenta
 * (cheque físico, tarjeta de crédito, "Cuenta corriente"), el comprobante se
 * confirmaba sin asiento o con asiento descuadrado. Desde esos tickets la
 * confirmación se bloquea con un error claro, pero los comprobantes que ya
 * cayeron en el comportamiento anterior siguen en la base sin `journal_entry_id`.
 *
 * Este script SOLO LEE. No hace ningún UPDATE ni INSERT: cada comprobante que
 * lista requiere una decisión contable (generar el asiento a mano o revertir y
 * reconfirmar) y eso es otro ticket. Muestra:
 *
 *   1) PROBLEMA — comprobantes "confirmados" con `journal_entry_id IS NULL`,
 *      ordenados por empresa y fecha, con tipo, empresa, número, fecha, tercero,
 *      total, estado e id; subtotal por empresa y tipo, y totales:
 *        - VENTA / COMPRA: `status NOT IN ('DRAFT','CANCELLED')`
 *          (CONFIRMED, PAID, PARTIAL_PAID).
 *        - RECIBO / OP: `status = 'CONFIRMED'` (sus enums no tienen PAID).
 *        - GASTO: `status NOT IN ('DRAFT','CANCELLED')` (`expense_status`:
 *          CONFIRMED, PARTIAL_PAID, PAID).
 *   2) NO ES PROBLEMA — OP a socio (`partner_id IS NOT NULL`) confirmadas sin
 *      asiento: por diseño no generan asiento (devolución de cuenta corriente de
 *      socio, seguimiento 2.4-4 del plan TSK-728). Se listan aparte para saber
 *      cuántas hay; no cuentan en los totales del punto 1.
 *   3) USO DE MEDIOS DE PAGO en recibos y OP confirmados: conteo e importe por
 *      `payment_method`, y cuántos comprobantes tienen al menos un pago con
 *      cheque físico, tarjeta de crédito o "Cuenta corriente" (los medios que
 *      hoy no tienen cuenta contable definida en ningún lado). Ese número dice
 *      cuánto pesa el seguimiento "cuentas para cheques/tarjetas" (2.4-1).
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
 *   -- 1) Detalle: comprobantes confirmados sin asiento, por empresa y fecha (PROBLEMA).
 *   --    `status::text` es obligatorio: cada tabla tiene su propio enum de estado
 *   --    (`sales_invoice_status`, `purchase_invoice_status`, `receipt_status`,
 *   --    `payment_order_status`, `expense_status`) y el UNION ALL no los puede
 *   --    unificar sin el cast; lo mismo `voucher_type::text` (enum `voucher_type`, solo
 *   --    existe en facturas: `NULL::text` en recibos, OP y gastos).
 *   --    OP: `partner_id IS NULL` excluye las OP a socio (sin asiento por diseño, ver 2).
 *   SELECT 'VENTA' AS tipo, c.name AS empresa, s.full_number AS numero, s.voucher_type::text,
 *          s.issue_date::date AS fecha, k.name AS tercero, s.total, s.status::text AS status, s.id
 *   FROM sales_invoices s
 *   JOIN companies c   ON c.id = s.company_id
 *   JOIN contractors k ON k.id = s.customer_id
 *   WHERE s.status NOT IN ('DRAFT','CANCELLED') AND s.journal_entry_id IS NULL
 *   UNION ALL
 *   SELECT 'COMPRA', c.name, p.full_number, p.voucher_type::text,
 *          p.issue_date::date, v.business_name, p.total, p.status::text, p.id
 *   FROM purchase_invoices p
 *   JOIN companies c ON c.id = p.company_id
 *   JOIN suppliers v ON v.id = p.supplier_id
 *   WHERE p.status NOT IN ('DRAFT','CANCELLED') AND p.journal_entry_id IS NULL
 *   UNION ALL
 *   SELECT 'RECIBO', c.name, r.full_number, NULL::text,
 *          r.date::date, k.name, r.total_amount, r.status::text, r.id
 *   FROM receipts r
 *   JOIN companies c   ON c.id = r.company_id
 *   JOIN contractors k ON k.id = r.customer_id
 *   WHERE r.status = 'CONFIRMED' AND r.journal_entry_id IS NULL
 *   UNION ALL
 *   SELECT 'OP', c.name, o.full_number, NULL::text,
 *          o.date::date, coalesce(v.business_name, '-'), o.total_amount, o.status::text, o.id
 *   FROM payment_orders o
 *   JOIN companies c      ON c.id = o.company_id
 *   LEFT JOIN suppliers v ON v.id = o.supplier_id
 *   WHERE o.status = 'CONFIRMED' AND o.journal_entry_id IS NULL AND o.partner_id IS NULL
 *   UNION ALL
 *   SELECT 'GASTO', c.name, e.full_number, NULL::text,
 *          e.date::date, coalesce(v.business_name, '-'), e.amount, e.status::text, e.id
 *   FROM expenses e
 *   JOIN companies c      ON c.id = e.company_id
 *   LEFT JOIN suppliers v ON v.id = e.supplier_id
 *   WHERE e.status NOT IN ('DRAFT','CANCELLED') AND e.journal_entry_id IS NULL
 *   ORDER BY 2, 5, 1;
 *
 *   -- 2) OP a socio confirmadas sin asiento (NO ES PROBLEMA: sin asiento por diseño).
 *   SELECT 'OP-SOCIO' AS tipo, c.name AS empresa, o.full_number AS numero,
 *          o.date::date AS fecha, coalesce(pp.name, '-') AS tercero, o.total_amount,
 *          o.status::text AS status, o.id
 *   FROM payment_orders o
 *   JOIN companies c     ON c.id = o.company_id
 *   LEFT JOIN partners pp ON pp.id = o.partner_id
 *   WHERE o.status = 'CONFIRMED' AND o.journal_entry_id IS NULL AND o.partner_id IS NOT NULL
 *   ORDER BY 2, 4;
 *
 *   -- 3) Resumen del punto 1: conteo y suma por empresa y tipo.
 *   SELECT c.name AS empresa, 'VENTA' AS tipo, count(*) AS cantidad, sum(s.total) AS total
 *   FROM sales_invoices s JOIN companies c ON c.id = s.company_id
 *   WHERE s.status NOT IN ('DRAFT','CANCELLED') AND s.journal_entry_id IS NULL
 *   GROUP BY 1
 *   UNION ALL
 *   SELECT c.name, 'COMPRA', count(*), sum(p.total)
 *   FROM purchase_invoices p JOIN companies c ON c.id = p.company_id
 *   WHERE p.status NOT IN ('DRAFT','CANCELLED') AND p.journal_entry_id IS NULL
 *   GROUP BY 1
 *   UNION ALL
 *   SELECT c.name, 'RECIBO', count(*), sum(r.total_amount)
 *   FROM receipts r JOIN companies c ON c.id = r.company_id
 *   WHERE r.status = 'CONFIRMED' AND r.journal_entry_id IS NULL
 *   GROUP BY 1
 *   UNION ALL
 *   SELECT c.name, 'OP', count(*), sum(o.total_amount)
 *   FROM payment_orders o JOIN companies c ON c.id = o.company_id
 *   WHERE o.status = 'CONFIRMED' AND o.journal_entry_id IS NULL AND o.partner_id IS NULL
 *   GROUP BY 1
 *   UNION ALL
 *   SELECT c.name, 'GASTO', count(*), sum(e.amount)
 *   FROM expenses e JOIN companies c ON c.id = e.company_id
 *   WHERE e.status NOT IN ('DRAFT','CANCELLED') AND e.journal_entry_id IS NULL
 *   GROUP BY 1
 *   ORDER BY 1, 2;
 *
 *   -- 4) Uso de medios de pago en recibos y OP CONFIRMADOS (con o sin asiento):
 *   --    conteo de pagos e importe por medio. Insumo del seguimiento "cuentas para
 *   --    cheques/tarjetas" (2.4-1 del plan TSK-728). `payment_method::text` por el
 *   --    UNION (mismo enum, pero así se lee igual que el resto del header).
 *   SELECT 'RECIBO' AS tipo, rp.payment_method::text AS medio, count(*) AS pagos, sum(rp.amount) AS importe
 *   FROM receipt_payments rp JOIN receipts r ON r.id = rp.receipt_id
 *   WHERE r.status = 'CONFIRMED'
 *   GROUP BY 1, 2
 *   UNION ALL
 *   SELECT 'OP', op.payment_method::text, count(*), sum(op.amount)
 *   FROM payment_order_payments op JOIN payment_orders o ON o.id = op.payment_order_id
 *   WHERE o.status = 'CONFIRMED'
 *   GROUP BY 1, 2
 *   ORDER BY 1, 2;
 *
 *   -- 5) Cuántos recibos / OP confirmados tienen al menos un pago con un medio SIN
 *   --    cuenta contable definida hoy (cheque físico, tarjeta de crédito, cuenta corriente).
 *   SELECT 'RECIBO' AS tipo, count(*) AS comprobantes
 *   FROM receipts r
 *   WHERE r.status = 'CONFIRMED' AND EXISTS (
 *     SELECT 1 FROM receipt_payments rp
 *     WHERE rp.receipt_id = r.id AND rp.payment_method IN ('CHECK','CREDIT_CARD','ACCOUNT'))
 *   UNION ALL
 *   SELECT 'OP', count(*)
 *   FROM payment_orders o
 *   WHERE o.status = 'CONFIRMED' AND EXISTS (
 *     SELECT 1 FROM payment_order_payments op
 *     WHERE op.payment_order_id = o.id AND op.payment_method IN ('CHECK','CREDIT_CARD','ACCOUNT'));
 *
 *   -- 6) Ítems activos sin cuenta, por uso (dato que la clienta necesita ANTES de
 *   --    vaciar la cuenta global de ventas/compras; análisis 1.2.3 del plan TSK-721).
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
import { PaymentMethod, Prisma } from '../../src/generated/prisma/client';
import { prisma } from '../../src/shared/lib/prisma';

/** Facturas y gastos: "confirmado" = todo lo que no es borrador ni anulado. */
const NOT_CONFIRMED_STATUSES = ['DRAFT', 'CANCELLED'] as const;

/** Medios de pago que hoy no tienen cuenta contable definida en ningún lado (análisis 1.2.4). */
const METHODS_WITHOUT_ACCOUNT: PaymentMethod[] = ['CHECK', 'CREDIT_CARD', 'ACCOUNT'];

const DOCUMENT_KINDS = ['VENTA', 'COMPRA', 'RECIBO', 'OP', 'GASTO'] as const;
type DocumentKind = (typeof DOCUMENT_KINDS)[number];

type PaymentDocumentKind = Extract<DocumentKind, 'RECIBO' | 'OP'>;

interface DocumentWithoutEntry {
  kind: DocumentKind;
  companyId: string;
  companyName: string;
  fullNumber: string;
  /** Solo facturas; NULL en recibos, OP y gastos (igual que el SQL del header). */
  voucherType: string | null;
  date: Date;
  thirdParty: string;
  total: Prisma.Decimal;
  status: string;
  id: string;
}

interface PartnerOrderWithoutEntry {
  companyName: string;
  fullNumber: string;
  date: Date;
  partnerName: string;
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
  byKind: Record<DocumentKind, KindSummary>;
  rows: DocumentWithoutEntry[];
}

interface PaymentMethodUsage {
  kind: PaymentDocumentKind;
  method: PaymentMethod;
  payments: number;
  amount: Prisma.Decimal;
}

interface PaymentMethodsReport {
  usage: PaymentMethodUsage[];
  /** Comprobantes confirmados con al menos un pago en METHODS_WITHOUT_ACCOUNT. */
  documentsWithoutAccount: Record<PaymentDocumentKind, number>;
}

const emptySummary = (): KindSummary => ({ count: 0, total: new Prisma.Decimal(0) });

const emptyByKind = (): Record<DocumentKind, KindSummary> => ({
  VENTA: emptySummary(),
  COMPRA: emptySummary(),
  RECIBO: emptySummary(),
  OP: emptySummary(),
  GASTO: emptySummary(),
});

async function findDocumentsWithoutEntry(): Promise<DocumentWithoutEntry[]> {
  const [sales, purchases, receipts, paymentOrders, expenses] = await Promise.all([
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
    prisma.receipt.findMany({
      where: { status: 'CONFIRMED', journalEntryId: null },
      select: {
        id: true,
        companyId: true,
        company: { select: { name: true } },
        fullNumber: true,
        date: true,
        totalAmount: true,
        status: true,
        customer: { select: { name: true } },
      },
      orderBy: [{ companyId: 'asc' }, { date: 'asc' }],
    }),
    // OP a socio (partnerId != null) no generan asiento por diseño: van en findPartnerOrdersWithoutEntry.
    prisma.paymentOrder.findMany({
      where: { status: 'CONFIRMED', journalEntryId: null, partnerId: null },
      select: {
        id: true,
        companyId: true,
        company: { select: { name: true } },
        fullNumber: true,
        date: true,
        totalAmount: true,
        status: true,
        supplier: { select: { businessName: true } },
      },
      orderBy: [{ companyId: 'asc' }, { date: 'asc' }],
    }),
    prisma.expense.findMany({
      where: {
        status: { notIn: [...NOT_CONFIRMED_STATUSES] },
        journalEntryId: null,
      },
      select: {
        id: true,
        companyId: true,
        company: { select: { name: true } },
        fullNumber: true,
        date: true,
        amount: true,
        status: true,
        supplier: { select: { businessName: true } },
      },
      orderBy: [{ companyId: 'asc' }, { date: 'asc' }],
    }),
  ]);

  const rows: DocumentWithoutEntry[] = [
    ...sales.map((inv) => ({
      kind: 'VENTA' as const,
      companyId: inv.companyId,
      companyName: inv.company.name,
      fullNumber: inv.fullNumber,
      voucherType: inv.voucherType,
      date: inv.issueDate,
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
      date: inv.issueDate,
      thirdParty: inv.supplier.businessName,
      total: inv.total,
      status: inv.status,
      id: inv.id,
    })),
    ...receipts.map((receipt) => ({
      kind: 'RECIBO' as const,
      companyId: receipt.companyId,
      companyName: receipt.company.name,
      fullNumber: receipt.fullNumber,
      voucherType: null,
      date: receipt.date,
      thirdParty: receipt.customer.name,
      total: receipt.totalAmount,
      status: receipt.status,
      id: receipt.id,
    })),
    ...paymentOrders.map((order) => ({
      kind: 'OP' as const,
      companyId: order.companyId,
      companyName: order.company.name,
      fullNumber: order.fullNumber,
      voucherType: null,
      date: order.date,
      thirdParty: order.supplier?.businessName ?? '-',
      total: order.totalAmount,
      status: order.status,
      id: order.id,
    })),
    ...expenses.map((expense) => ({
      kind: 'GASTO' as const,
      companyId: expense.companyId,
      companyName: expense.company.name,
      fullNumber: expense.fullNumber,
      voucherType: null,
      date: expense.date,
      thirdParty: expense.supplier?.businessName ?? '-',
      total: expense.amount,
      status: expense.status,
      id: expense.id,
    })),
  ];

  // Mismo orden que el SQL 1) del encabezado: empresa, fecha, tipo.
  return rows.sort(
    (a, b) =>
      a.companyName.localeCompare(b.companyName) ||
      a.date.getTime() - b.date.getTime() ||
      a.kind.localeCompare(b.kind)
  );
}

/** OP a socio confirmadas sin asiento: no son problema (sin asiento por diseño). SQL 2). */
async function findPartnerOrdersWithoutEntry(): Promise<PartnerOrderWithoutEntry[]> {
  const orders = await prisma.paymentOrder.findMany({
    where: { status: 'CONFIRMED', journalEntryId: null, partnerId: { not: null } },
    select: {
      id: true,
      company: { select: { name: true } },
      fullNumber: true,
      date: true,
      totalAmount: true,
      status: true,
      partner: { select: { name: true } },
    },
    orderBy: [{ companyId: 'asc' }, { date: 'asc' }],
  });

  return orders
    .map((order) => ({
      companyName: order.company.name,
      fullNumber: order.fullNumber,
      date: order.date,
      partnerName: order.partner?.name ?? '-',
      total: order.totalAmount,
      status: order.status,
      id: order.id,
    }))
    .sort(
      (a, b) => a.companyName.localeCompare(b.companyName) || a.date.getTime() - b.date.getTime()
    );
}

/** Uso de medios de pago en recibos y OP confirmados (SQL 4 y 5 del encabezado). */
async function reportPaymentMethods(): Promise<PaymentMethodsReport> {
  const [receiptUsage, orderUsage, receiptsWithoutAccount, ordersWithoutAccount] =
    await Promise.all([
      prisma.receiptPayment.groupBy({
        by: ['paymentMethod'],
        where: { receipt: { status: 'CONFIRMED' } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.paymentOrderPayment.groupBy({
        by: ['paymentMethod'],
        where: { paymentOrder: { status: 'CONFIRMED' } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.receipt.count({
        where: {
          status: 'CONFIRMED',
          payments: { some: { paymentMethod: { in: METHODS_WITHOUT_ACCOUNT } } },
        },
      }),
      prisma.paymentOrder.count({
        where: {
          status: 'CONFIRMED',
          payments: { some: { paymentMethod: { in: METHODS_WITHOUT_ACCOUNT } } },
        },
      }),
    ]);

  const usage: PaymentMethodUsage[] = [
    ...receiptUsage.map((row) => ({
      kind: 'RECIBO' as const,
      method: row.paymentMethod,
      payments: row._count._all,
      amount: row._sum.amount ?? new Prisma.Decimal(0),
    })),
    ...orderUsage.map((row) => ({
      kind: 'OP' as const,
      method: row.paymentMethod,
      payments: row._count._all,
      amount: row._sum.amount ?? new Prisma.Decimal(0),
    })),
  ].sort((a, b) => a.kind.localeCompare(b.kind) || a.method.localeCompare(b.method));

  return {
    usage,
    documentsWithoutAccount: { RECIBO: receiptsWithoutAccount, OP: ordersWithoutAccount },
  };
}

function groupByCompany(rows: DocumentWithoutEntry[]): CompanySummary[] {
  const byCompany = new Map<string, CompanySummary>();

  for (const row of rows) {
    let summary = byCompany.get(row.companyId);
    if (!summary) {
      summary = {
        companyId: row.companyId,
        companyName: row.companyName,
        byKind: emptyByKind(),
        rows: [],
      };
      byCompany.set(row.companyId, summary);
    }
    const bucket = summary.byKind[row.kind];
    bucket.count += 1;
    bucket.total = bucket.total.plus(row.total);
    summary.rows.push(row);
  }

  return [...byCompany.values()];
}

function formatRow(row: DocumentWithoutEntry): string {
  const number = row.voucherType ? `${row.fullNumber} (${row.voucherType})` : row.fullNumber;
  return (
    `${row.kind.padEnd(6)} | ${row.companyName} | ${number} | ` +
    `${moment.utc(row.date).format('DD/MM/YYYY')} | ${row.thirdParty} | ` +
    `total ${row.total.toString()} | ${row.status} | id ${row.id}`
  );
}

function formatPartnerRow(row: PartnerOrderWithoutEntry): string {
  return (
    `OP-SOCIO | ${row.companyName} | ${row.fullNumber} | ` +
    `${moment.utc(row.date).format('DD/MM/YYYY')} | socio ${row.partnerName} | ` +
    `total ${row.total.toString()} | ${row.status} | id ${row.id}`
  );
}

function formatKindSummaries(byKind: Record<DocumentKind, KindSummary>): string {
  return DOCUMENT_KINDS.map(
    (kind) => `${kind} ${byKind[kind].count} comprobante(s), total ${byKind[kind].total.toString()}`
  ).join(' | ');
}

function printDocumentsWithoutEntry(rows: DocumentWithoutEntry[]) {
  const companies = groupByCompany(rows);

  console.log('--- 1) PROBLEMA: comprobantes confirmados SIN asiento contable ---');
  console.log(
    '(VENTA/COMPRA/GASTO: no DRAFT ni CANCELLED; RECIBO/OP: CONFIRMED; OP a socio excluidas, ver 2)'
  );
  console.log('');

  if (rows.length === 0) {
    console.log('Ninguno. Nada que revisar.');
    console.log('');
    return;
  }

  for (const company of companies) {
    console.log(`== ${company.companyName} (${company.companyId}) ==`);
    for (const row of company.rows) {
      console.log(`  ${formatRow(row)}`);
    }
    console.log(`  Subtotal ${company.companyName}: ${formatKindSummaries(company.byKind)}`);
    console.log('');
  }

  const totals = emptyByKind();
  for (const company of companies) {
    for (const kind of DOCUMENT_KINDS) {
      totals[kind].count += company.byKind[kind].count;
      totals[kind].total = totals[kind].total.plus(company.byKind[kind].total);
    }
  }

  console.log('--- Totales ---');
  for (const kind of DOCUMENT_KINDS) {
    console.log(
      `${`${kind}:`.padEnd(8)}${totals[kind].count} comprobante(s), total ${totals[kind].total.toString()}`
    );
  }
  console.log(`Total a revisar: ${rows.length} comprobante(s) en ${companies.length} empresa(s).`);
  console.log('');
  console.log(
    'Son comprobantes que se confirmaron sin asiento por el comportamiento anterior ' +
      '(falta de cuenta contable tragada en silencio). No se corrigen automáticamente: ' +
      'cada uno requiere decisión contable (generar el asiento a mano o revertir y reconfirmar).'
  );
  console.log('');
}

function printPartnerOrders(rows: PartnerOrderWithoutEntry[]) {
  console.log(
    '--- 2) NO ES PROBLEMA: OP a socio confirmadas sin asiento (sin asiento por diseño) ---'
  );
  if (rows.length === 0) {
    console.log('Ninguna.');
  } else {
    for (const row of rows) {
      console.log(`  ${formatPartnerRow(row)}`);
    }
    console.log(
      `  ${rows.length} OP a socio. No cuentan como problema: la devolución de cuenta corriente ` +
        'de socio no genera asiento por diseño (seguimiento 2.4-4 del plan TSK-728).'
    );
  }
  console.log('');
}

function printPaymentMethods(report: PaymentMethodsReport) {
  console.log('--- 3) Uso de medios de pago en recibos y OP CONFIRMADOS (con o sin asiento) ---');
  if (report.usage.length === 0) {
    console.log('Ninguno: no hay pagos en recibos ni OP confirmados.');
  } else {
    for (const row of report.usage) {
      console.log(
        `  ${row.kind.padEnd(6)} | ${row.method.padEnd(11)} | ${row.payments} pago(s) | importe ${row.amount.toString()}`
      );
    }
  }
  console.log('');
  console.log(
    `Con al menos un pago SIN cuenta contable definida hoy (${METHODS_WITHOUT_ACCOUNT.join(', ')}): ` +
      `RECIBO ${report.documentsWithoutAccount.RECIBO} | OP ${report.documentsWithoutAccount.OP}.`
  );
  console.log(
    'Es el peso del seguimiento "cuentas para cheques / tarjetas / cuenta corriente" (2.4-1): ' +
      'esos medios no generan línea en el asiento hasta que tengan cuenta.'
  );
}

async function main() {
  const [rows, partnerOrders, paymentMethods] = await Promise.all([
    findDocumentsWithoutEntry(),
    findPartnerOrdersWithoutEntry(),
    reportPaymentMethods(),
  ]);

  console.log('=== Diagnóstico de comprobantes confirmados sin asiento (TSK-721 / TSK-728) ===');
  console.log('(solo lectura: no se corrige nada)');
  console.log('');

  printDocumentsWithoutEntry(rows);
  printPartnerOrders(partnerOrders);
  printPaymentMethods(paymentMethods);
}

main()
  .catch((error) => {
    console.error('Error en el diagnóstico de comprobantes sin asiento:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
