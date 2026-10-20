/**
 * Capturas y verificación en navegador del TSK-782 (fecha que se borra al tipear y botón
 * "Nueva Factura" en el detalle de la factura de compra).
 *
 * No siembra datos: usa la empresa activa de dev y su factura de compra más reciente.
 *
 * Recorrido:
 *   01 Fecha de Emisión después de tipear día y mes (15 y 06) — con `--antes`, sobre el código
 *      anterior al arreglo, guarda la misma captura como "antes" (dd/06/2026)
 *   02 Chequeo: con la fecha completa tipeada queda 15/06/2026 (sin captura: igual a la 01)
 *   03 Fecha incompleta (día borrado) al guardar → "La fecha de emisión es requerida"
 *   04 Encabezado del detalle con "Nueva Factura" (desktop) y 05 en el celular (375 px)
 *   06 El botón abre una factura nueva vacía
 *
 * Uso:
 *   node scripts/guia-presentacion/capturas-tsk782.mjs [baseUrl]            # recorrido (dev :3010)
 *   node scripts/guia-presentacion/capturas-tsk782.mjs [baseUrl] --antes    # solo 01, como "antes"
 *
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const ANTES = args.includes('--antes');
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY = '02885d43-1358-4eb2-b774-c52d5be372f3'; // empresa activa habitual en dev

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};

const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -Atc "${sql}"`).toString().trim();

const invoiceId = psql(
  `select id from purchase_invoices where company_id = '${COMPANY}' and status <> 'DRAFT' order by created_at desc limit 1`,
);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

const newPage = async (width, height) => {
  const context = await browser.newContext({ locale: 'es-AR', viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  return page;
};

const hideDevBadges = (page) =>
  page
    .evaluate(() => {
      document
        .querySelectorAll('nextjs-portal, [data-next-badge-root], #next-logo, .tsqd-parent-container')
        .forEach((el) => el.remove());
    })
    .catch(() => {});

/** Tipea tecla por tecla, como una persona, empezando por el segmento del día. */
const typeDate = async (page, input, keys) => {
  await input.click({ position: { x: 12, y: 18 } });
  for (const key of keys) {
    await page.keyboard.type(key);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
};

/** Captura el campo de fecha con su etiqueta y su mensaje. */
const shotField = async (page, input, name) => {
  await hideDevBadges(page);
  const item = input.locator('xpath=ancestor::*[@data-slot="form-item"][1]');
  await item.screenshot({ path: `${OUT}/tsk782-${name}.png` });
  console.log(`  → ${OUT}/tsk782-${name}.png`);
};

const openNewInvoice = async (page) => {
  await page.goto(`${BASE}/dashboard/commercial/purchases/new`, { waitUntil: 'domcontentloaded' });
  const input = page.getByLabel(/fecha de emisi/i);
  await input.waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  return input;
};

try {
  const page = await newPage(1440, 900);

  console.log('01 Día y mes tipeados');
  let input = await openNewInvoice(page);
  await typeDate(page, input, '1506');
  const afterMonth = await input.inputValue();
  await page.keyboard.press('Tab');
  if (ANTES) {
    check(afterMonth === '', `antes: el input queda vacío tras tipear el mes (valor "${afterMonth}")`);
    await shotField(page, input, '01-fecha-antes');
  } else {
    check(afterMonth.endsWith('-06-15'), `el día se conserva al tipear el mes (valor "${afterMonth}")`);
    await shotField(page, input, '01-fecha-despues');

    console.log('02 Fecha completa');
    input = await openNewInvoice(page);
    await typeDate(page, input, '15062026');
    check((await input.inputValue()) === '2026-06-15', 'queda 15/06/2026');

    console.log('03 Fecha incompleta al guardar');
    input = await openNewInvoice(page);
    // Se borra el día: el navegador muestra dd/MM/AAAA y reporta '' (un mes a medio tipear, en
    // cambio, Chrome lo completa al salir del campo).
    await input.click({ position: { x: 12, y: 18 } });
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Guardar Factura' }).click();
    await page.waitForTimeout(1000);
    const message = page.getByText('La fecha de emisión es requerida');
    check(await message.isVisible(), 'aparece "La fecha de emisión es requerida"');
    check(page.url().endsWith('/purchases/new'), 'no se guarda: sigue en la carga');
    await shotField(page, input, '03-fecha-incompleta');

    console.log('04 Detalle con Nueva Factura (desktop)');
    await page.goto(`${BASE}/dashboard/commercial/purchases/${invoiceId}`, { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('link', { name: 'Nueva Factura' });
    await button.waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    await hideDevBadges(page);
    const header = page.locator('h1').locator('xpath=ancestor::div[contains(@class,"justify-between")][1]');
    await header.screenshot({ path: `${OUT}/tsk782-04-detalle-boton.png` });
    console.log(`  → ${OUT}/tsk782-04-detalle-boton.png`);

    console.log('06 El botón abre una factura nueva');
    await button.click();
    await page.waitForURL(/purchases\/new$/, { timeout: 60000 });
    const fresh = page.getByLabel(/fecha de emisi/i);
    await fresh.waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    check(true, 'navega a /dashboard/commercial/purchases/new');
    await hideDevBadges(page);
    await page.screenshot({ path: `${OUT}/tsk782-06-nueva-factura.png`, clip: { x: 256, y: 0, width: 1184, height: 560 } });
    console.log(`  → ${OUT}/tsk782-06-nueva-factura.png`);

    console.log('05 Detalle en el celular');
    const mobile = await newPage(375, 812);
    await mobile.goto(`${BASE}/dashboard/commercial/purchases/${invoiceId}`, { waitUntil: 'domcontentloaded' });
    await mobile.getByRole('link', { name: 'Nueva Factura' }).waitFor({ timeout: 60000 });
    await mobile.waitForTimeout(1500);
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, `sin scroll horizontal a 375 px (desborde ${overflow}px)`);
    await hideDevBadges(mobile);
    await mobile.screenshot({ path: `${OUT}/tsk782-05-detalle-movil.png`, clip: { x: 0, y: 0, width: 375, height: 340 } });
    console.log(`  → ${OUT}/tsk782-05-detalle-movil.png`);
  }
} catch (error) {
  failures++;
  console.error(error);
} finally {
  await browser.close();
}

process.exit(failures ? 1 : 0);
