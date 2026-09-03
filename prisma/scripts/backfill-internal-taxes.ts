/**
 * TSK-644 — Backfill de `internal_taxes` en comprobantes preexistentes.
 *
 * Contexto: hasta este ticket, `otherTaxes` solo se poblaba desde la
 * importación de comprobantes recibidos de AFIP (`otrosTributos`), y el asiento
 * contable no lo contemplaba. Resultado: al confirmar una factura importada con
 * otros tributos, el asiento salía descuadrado (el total los incluía, pero no
 * había contrapartida), `validateBalance` lo rechazaba, el error se degradaba a
 * `logger.warn` y la factura quedaba **confirmada sin asiento**, en silencio.
 *
 * Este script hace dos cosas, ninguna destructiva:
 *
 *   1. BACKFILL (escribe): en comprobantes **en borrador** con `otherTaxes > 0`
 *      e `internalTaxes = 0`, copia `otherTaxes` a `internalTaxes`. Con eso su
 *      asiento ya puede generarse balanceado cuando se los confirme. El total
 *      del comprobante no se toca.
 *
 *   2. DIAGNÓSTICO (no escribe): lista los comprobantes ya **confirmados** con
 *      `otherTaxes > 0` y sin asiento (`journal_entry_id IS NULL`) — los que
 *      cayeron en el bug. No se corrigen automáticamente: confirmar es
 *      irreversible y el asiento que corresponda es una decisión contable.
 *
 * === Cómo correrlo ===
 *   Aplicar PRIMERO la migración 20260903183104_tsk_644_percepciones_impuestos_internos:
 *
 *     npx tsx prisma/scripts/backfill-internal-taxes.ts
 *
 *   Es idempotente: una segunda corrida no cambia nada (el filtro exige
 *   `internalTaxes = 0`). Carga `DATABASE_URL` desde `.env` vía dotenv.
 */

import 'dotenv/config';
import { prisma } from '../../src/shared/lib/prisma';

async function backfillDrafts() {
  const [purchases, sales] = await Promise.all([
    prisma.$executeRaw`
      UPDATE purchase_invoices
      SET internal_taxes = other_taxes, updated_at = NOW()
      WHERE status = 'DRAFT' AND other_taxes > 0 AND internal_taxes = 0
    `,
    prisma.$executeRaw`
      UPDATE sales_invoices
      SET internal_taxes = other_taxes, updated_at = NOW()
      WHERE status = 'DRAFT' AND other_taxes > 0 AND internal_taxes = 0
    `,
  ]);

  console.log('--- Backfill de comprobantes en borrador ---');
  console.log(`Facturas de compra actualizadas: ${purchases}`);
  console.log(`Facturas de venta actualizadas:  ${sales}`);
}

async function reportConfirmedWithoutEntry() {
  const [purchases, sales] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where: {
        status: { not: 'DRAFT' },
        otherTaxes: { gt: 0 },
        journalEntryId: null,
      },
      select: {
        id: true,
        fullNumber: true,
        issueDate: true,
        otherTaxes: true,
        total: true,
        company: { select: { name: true } },
        supplier: { select: { businessName: true } },
      },
      orderBy: { issueDate: 'asc' },
    }),
    prisma.salesInvoice.findMany({
      where: {
        status: { not: 'DRAFT' },
        otherTaxes: { gt: 0 },
        journalEntryId: null,
      },
      select: {
        id: true,
        fullNumber: true,
        issueDate: true,
        otherTaxes: true,
        total: true,
        company: { select: { name: true } },
        customer: { select: { name: true } },
      },
      orderBy: { issueDate: 'asc' },
    }),
  ]);

  console.log('');
  console.log('--- Confirmadas con otros tributos y SIN asiento contable ---');
  console.log('(no se corrigen: requieren decisión contable)');

  if (purchases.length === 0 && sales.length === 0) {
    console.log('Ninguna. Nada que revisar.');
    return;
  }

  for (const inv of purchases) {
    console.log(
      `COMPRA  ${inv.company.name} | ${inv.fullNumber} | ` +
        `${inv.issueDate.toISOString().slice(0, 10)} | ${inv.supplier.businessName} | ` +
        `otros tributos ${inv.otherTaxes.toString()} | total ${inv.total.toString()} | id ${inv.id}`
    );
  }
  for (const inv of sales) {
    console.log(
      `VENTA   ${inv.company.name} | ${inv.fullNumber} | ` +
        `${inv.issueDate.toISOString().slice(0, 10)} | ${inv.customer.name} | ` +
        `otros tributos ${inv.otherTaxes.toString()} | total ${inv.total.toString()} | id ${inv.id}`
    );
  }
  console.log('');
  console.log(`Total a revisar: ${purchases.length + sales.length} comprobante(s).`);
}

async function main() {
  await backfillDrafts();
  await reportConfirmedWithoutEntry();
}

main()
  .catch((error) => {
    console.error('Error en el backfill de impuestos internos:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
