/**
 * Capturas del TSK-762 (una factura de venta con descuento global no se podía confirmar).
 *
 * Escenario en la empresa demo: FV A 0001-00000004 en borrador, 3 × $10.000 + 2 × $7.500 al 21% con
 * 10% de descuento global: neto $40.500, IVA $8.505, total $49.005 (importes de
 * `buildSalesInvoiceAmounts`, como la guarda la app).
 *
 * 1. Ventas → Facturas → Confirmar. Sin el arreglo: "El asiento no está balanceado"; con el arreglo
 *    se confirma.
 * 2. Con el arreglo: el asiento (Deudores 49.005 = Ventas 40.500 + IVA 8.505), la Posición de IVA de
 *    octubre y el cuadro de IVA del PDF, con el descuento.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk762.mjs [baseUrl] [--antes | --posicion-antes]
 *   --antes: con la factura en borrador y sin el arreglo del asiento.
 *   --posicion-antes: con la factura ya confirmada y sin el arreglo de la Posición de IVA.
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const BEFORE = process.argv.includes('--antes');
const VAT_BEFORE = process.argv.includes('--posicion-antes');
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const INVOICE = '0001-00000004';

let failures = 0;
const INVOICE_ID = spawnSync(
  'docker',
  [
    'exec',
    'contable-pms-db',
    'psql',
    '-U',
    'postgres',
    '-d',
    'contable_pms',
    '-tAc',
    `select id from sales_invoices where company_id = '02885d43-1358-4eb2-b774-c52d5be372f3' and full_number = '${INVOICE}'`,
  ],
  { encoding: 'utf8' }
).stdout.trim();
const STATUS = spawnSync(
  'docker',
  [
    'exec',
    'contable-pms-db',
    'psql',
    '-U',
    'postgres',
    '-d',
    'contable_pms',
    '-tAc',
    `select status from sales_invoices where id = '${INVOICE_ID}'`,
  ],
  { encoding: 'utf8' }
).stdout.trim();
const money = (text) => Number(text.replace(/[^\d,]/g, '').replace(',', '.'));

/** Posición de IVA de octubre: fila del 21% y totales de ventas. */
async function vatPosition(shot) {
  await page.goto(`${BASE}/dashboard/company/accounting/reports?report=monthly-vat`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: 'Generar' }).click();
  const rate = page.locator('tr', { has: page.getByRole('cell', { name: '21%', exact: true }) });
  await rate.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(2500); // que se vaya el toast
  await hide();
  const cells = await rate.locator('td').allTextContents();
  const salesText = (await page.locator('main').textContent()) ?? '';
  await page.locator('main').screenshot({ path: `${OUT}/${shot}` });
  console.log(`  → ${OUT}/${shot}`);
  return { base: money(cells[1]), vat: money(cells[2]), salesText };
}

const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const context = await browser.newContext({
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const hide = () =>
  page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  if (VAT_BEFORE) {
    const { base, vat } = await vatPosition('tsk762-03-posicion-antes.png');
    console.log(`  21%: base ${base}, IVA ${vat}`);
    check(
      base !== 190500 || vat !== 40005,
      'sin el arreglo, el desglose del 21% no coincide con los totales de ventas'
    );
    throw 'fin';
  }

  // 1. Confirmar la factura desde la lista (si ya está confirmada, se sigue con el paso 2)
  if (STATUS === 'DRAFT') {
    await page.goto(`${BASE}/dashboard/commercial/invoices`, { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { has: page.getByText(INVOICE, { exact: true }) });
    await row.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(5000); // hidratación de la tabla
    await row.getByRole('button', { name: 'Abrir menú' }).click();
    await page.getByRole('menuitem', { name: 'Confirmar' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    const toast = page.locator('[data-sonner-toast]').first();
    await toast.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1500);
    await hide();
    const toastText = ((await toast.textContent()) ?? '').trim();
    console.log(`  toast: "${toastText}"`);
    await page.screenshot({
      path: `${OUT}/tsk762-${BEFORE ? '00-confirmar-antes' : '01-confirmar-despues'}.png`,
    });
    console.log(`  factura ${INVOICE_ID}`);

    if (BEFORE) {
      check(
        toastText.includes('no está balanceado'),
        'sin el arreglo, la confirmación se rechaza por asiento descuadrado'
      );
    } else {
      check(toastText.includes('Factura confirmada'), 'con el arreglo, la factura se confirma');
    }
  }

  if (!BEFORE) {
    // 2a. El asiento de la factura
    await page.goto(`${BASE}/dashboard/company/accounting/entries`, {
      waitUntil: 'domcontentloaded',
    });
    const entryRow = page
      .locator('tr', { has: page.getByText(`Factura de venta ${INVOICE}`, { exact: true }) })
      .first();
    await entryRow.waitFor({ state: 'visible', timeout: 60000 });
    await entryRow.locator('button').first().click(); // expandir líneas
    await page.waitForTimeout(1000);
    await hide();
    await entryRow.scrollIntoViewIfNeeded();
    const entryText = (await page.locator('main').textContent()) ?? '';
    check(
      entryText.includes('49.005,00') &&
        entryText.includes('33.750,00') &&
        entryText.includes('6.750,00') &&
        entryText.includes('8.505,00'),
      'el asiento: Deudores 49.005 = Ventas 33.750 (Administración) + 6.750 (Logística) + IVA 8.505',
    );
    await page.screenshot({ path: `${OUT}/tsk762-02-asiento.png` });

    // 2b. Posición de IVA de octubre (incluye la FV 3, sin descuento): el 21% cierra con los totales
    const { base, vat, salesText } = await vatPosition('tsk762-04-posicion-despues.png');
    console.log(`  21%: base ${base}, IVA ${vat}`);
    check(
      base === 190500 &&
        vat === 40005 &&
        salesText.includes('190.500,00') &&
        salesText.includes('40.005,00'),
      'la Posición de IVA: el 21% (base 190.500, IVA 40.005) coincide con los totales de ventas'
    );

    // 2c. Cuadro de IVA del PDF
    const pdf = await page.request.get(`${BASE}/api/invoices/${INVOICE_ID}/pdf`);
    const pdfPath = join(tmpdir(), 'tsk762-factura.pdf');
    writeFileSync(pdfPath, await pdf.body());
    const pdfText =
      spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' }).stdout ?? '';
    check(
      pdfText.includes('40.500') && pdfText.includes('8.505'),
      'el PDF muestra base 40.500 e IVA 8.505'
    );
  }
} catch (error) {
  if (error === 'fin') {
    // --posicion-antes termina después de su captura
  } else {
    failures++;
    console.error(error);
    await page.screenshot({ path: `${OUT}/tsk762-error.png` }).catch(() => {});
  }
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
