/**
 * Capturas del TSK-796 (Libro IVA Digital omitía facturas Pagadas y Parciales) y de la pantalla
 * nueva "Contabilidad → Archivos ARCA".
 *
 * Usa los datos demo de la empresa de prueba: en septiembre y octubre de 2026 hay compras
 * confirmadas, pagadas y con pago parcial. Genera los archivos de cada mes, descarga el de
 * comprobantes de compras y verifica contra la base que trae todas las facturas del mes salvo
 * borradores y anuladas, con registros de 325 posiciones (diseño de ARCA).
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk796.mjs [baseUrl]
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY = '02885d43-1358-4eb2-b774-c52d5be372f3';

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};
const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -Atc "${sql}"`).toString().trim();
const purchasesIn = (month, statuses) =>
  Number(psql(`select count(*) from purchase_invoices where company_id='${COMPANY}' and to_char(issue_date,'YYYY-MM')='${month}' and status::text in (${statuses})`));
const ALL_BUT_DRAFT = `'CONFIRMED','PAID','PARTIAL_PAID'`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const context = await browser.newContext({
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();

const hide = () => page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});
const shot = async (name, target, opts = {}) => {
  await hide();
  await (target ?? page).screenshot({ path: `${OUT}/tsk796-${name}.png`, ...opts });
  console.log(`  → ${OUT}/tsk796-${name}.png`);
};
const goto = async (path, ms = 5000) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(ms);
  await hide();
};
const fileRow = (filename) => page.locator('div.rounded-md.border', { hasText: filename });
const generate = async () => {
  await page.getByRole('button', { name: 'Generar archivos' }).click();
  await page.getByText(/^Libro IVA Digital de /).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(800);
};

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  // --- 1. Pantalla nueva, con el mes anterior elegido por defecto
  console.log('Pantalla Archivos ARCA');
  await goto('/dashboard/company/accounting/fiscal-exports', 8000);
  check(await page.getByRole('heading', { name: 'Archivos ARCA' }).isVisible(), 'la pantalla abre');
  check((await page.getByRole('combobox').nth(0).textContent())?.includes('Septiembre'), 'viene elegido el mes anterior (septiembre)');
  await shot('01-pantalla');

  // --- 2. Septiembre: 2 confirmadas + 2 con pago parcial
  console.log('Septiembre 2026');
  await generate();
  const sepExpected = purchasesIn('2026-09', ALL_BUT_DRAFT);
  const sepBefore = purchasesIn('2026-09', `'CONFIRMED'`);
  const sepRow = fileRow('LIBRO_IVA_DIGITAL_COMPRAS_CBTE_202609.txt');
  check((await sepRow.textContent())?.includes(`${sepExpected} registros`), `compras: ${sepExpected} registros (antes del arreglo: ${sepBefore})`);
  await shot('02-septiembre');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sepRow.getByRole('button', { name: 'Descargar' }).click(),
  ]);
  const path = `${OUT}/../tsk796-descarga.txt`;
  await download.saveAs(path);
  const raw = readFileSync(path);
  const lines = raw.toString('latin1').split('\r\n').filter(Boolean);
  check(download.suggestedFilename() === 'LIBRO_IVA_DIGITAL_COMPRAS_CBTE_202609.txt', 'el archivo se descarga con su nombre');
  check(lines.length === sepExpected, `el archivo trae ${lines.length} comprobantes`);
  check(lines.every((l) => l.length === 325), `cada registro mide 325 posiciones, como pide ARCA (${lines[0]?.length})`);
  execSync(`rm -f ${path}`);

  // --- 3. Octubre: 4 confirmadas + 12 pagadas
  console.log('Octubre 2026');
  await page.getByRole('combobox').nth(0).click();
  await page.getByRole('option', { name: 'Octubre' }).click();
  check(!(await page.getByText(/^Libro IVA Digital de /).isVisible()), 'al cambiar el mes se ocultan los archivos del mes anterior');
  await generate();
  const octExpected = purchasesIn('2026-10', ALL_BUT_DRAFT);
  const octBefore = purchasesIn('2026-10', `'CONFIRMED'`);
  check((await fileRow('LIBRO_IVA_DIGITAL_COMPRAS_CBTE_202610.txt').textContent())?.includes(`${octExpected} registros`), `compras: ${octExpected} registros (antes del arreglo: ${octBefore})`);
  await shot('03-octubre');

  // --- 4. Celular
  console.log('Celular');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `sin scroll horizontal a 375px (${overflow}px)`);
  await shot('04-celular', null, { fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- 5. Guía in-app
  console.log('Guía in-app');
  await goto('/dashboard/help', 6000);
  await page.getByRole('tab', { name: /Contabilidad/ }).first().click();
  await page.waitForTimeout(1000);
  const card = page.locator('[data-slot="card"]', { has: page.getByText('Archivos ARCA', { exact: true }) }).first();
  await card.scrollIntoViewIfNeeded();
  check(await card.isVisible(), 'la guía tiene la tarjeta Archivos ARCA');
  await shot('05-guia', card);
} catch (error) {
  failures++;
  console.error(error);
  await page.screenshot({ path: `${OUT}/tsk796-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
