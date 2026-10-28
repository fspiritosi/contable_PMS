/**
 * Capturas del TSK-793 (Inversiones: brokers, tenencias, compra/venta y valuación al cierre).
 *
 * Usa los datos de dev: tenencia "TSK793 AL30" en Banco Santander (compra de 100 nominales a $1.250,50
 * y venta parcial de 40 por $60.000). Crea (si no existe) el broker "TSK793 Balanz" por la app.
 * La valuación se genera para la captura y se deshace al final: la base queda sin valuación.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk793.mjs [baseUrl] [--only=broker|tenencias|compra|anular|valuacion|ajustes]
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const run = (name) => !ONLY || ONLY === name;
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY = '02885d43-1358-4eb2-b774-c52d5be372f3';
const INV = '/dashboard/commercial/treasury/investments';

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};
const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -Atc "${sql}"`).toString().trim();

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const hide = () => page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});
const shot = async (name, target) => {
  await hide();
  await (target ?? page).screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  → ${OUT}/${name}.png`);
};
const goto = async (path, ms = 4000) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(ms);
  await hide();
};
const dialog = () => page.getByRole('dialog');
const tall = async (name, target) => {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.waitForTimeout(800);
  await shot(name, target);
  await page.setViewportSize({ width: 1440, height: 900 });
};

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });

  if (run('broker')) {
    console.log('Broker: tipo de cuenta nuevo');
    await goto('/dashboard/commercial/treasury/bank-accounts');
    await page.getByRole('button', { name: 'Nueva Cuenta' }).first().click();
    await dialog().waitFor({ state: 'visible' });
    await dialog().getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Broker' }).click();
    await dialog().getByPlaceholder('Ej: Balanz').fill('TSK793 Balanz');
    await page.waitForTimeout(600);
    await shot('tsk793-01-broker-formulario', dialog());
    const exists = psql(`select count(*) from bank_accounts where company_id='${COMPANY}' and bank_name='TSK793 Balanz'`) !== '0';
    if (exists) {
      await page.keyboard.press('Escape');
    } else {
      await dialog().getByRole('button', { name: /Crear|Guardar/ }).click();
      await page.waitForTimeout(3000);
    }
    check(psql(`select account_type from bank_accounts where company_id='${COMPANY}' and bank_name='TSK793 Balanz'`) === 'BROKER', 'el broker existe con tipo BROKER');
    await goto('/dashboard/commercial/treasury/bank-accounts');
    await shot('tsk793-02-cuentas-y-brokers');
  }

  if (run('tenencias')) {
    console.log('Listado y detalle de tenencias');
    await goto(INV);
    check((await page.locator('main').innerText()).includes('TSK793 AL30'), 'el listado muestra TSK793 AL30');
    await shot('tsk793-03-listado-tenencias');
    const id = psql(`select id from investment_holdings where company_id='${COMPANY}' and name='TSK793 AL30'`);
    await goto(`${INV}/${id}`);
    check((await page.locator('main').innerText()).includes('Venta'), 'el detalle muestra el historial');
    await shot('tsk793-04-detalle-tenencia');
  }

  if (run('compra')) {
    console.log('Compra de inversión con nominales (sin guardar)');
    await goto('/dashboard/commercial/treasury/fund-movements');
    await page.getByRole('button', { name: 'Nuevo Movimiento' }).first().click();
    await dialog().waitFor({ state: 'visible' });
    await dialog().getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Compra de inversión' }).click();
    await page.waitForTimeout(800);
    await dialog().getByRole('combobox').filter({ hasText: /Seleccionar banco o caja/ }).click();
    await page.getByRole('option', { name: /Santander/ }).first().click();
    await dialog().getByRole('combobox').filter({ hasText: /Seleccionar tenencia/ }).click();
    await page.getByRole('option', { name: /TSK793 AL30/ }).click();
    await dialog().getByPlaceholder('0').first().fill('50');
    await dialog().getByPlaceholder('0').nth(1).fill('1300');
    await dialog().getByLabel('Comisión').fill('500');
    await dialog().getByPlaceholder('Concepto del movimiento').fill('TSK793 compra de 50 nominales AL30');
    await page.waitForTimeout(800);
    await tall('tsk793-05-compra-con-nominales', dialog());
    await page.keyboard.press('Escape');
  }

  if (run('anular')) {
    console.log('Anular la venta parcial: propuesta del motor de corrección');
    await goto('/dashboard/commercial/treasury/fund-movements');
    const row = page.locator('table tbody tr').filter({ hasText: 'TSK793 venta parcial AL30' }).first();
    await row.waitFor({ state: 'visible', timeout: 30000 });
    for (let i = 0; i < 8; i++) {
      await row.locator('button').last().click();
      if (await page.getByRole('menuitem', { name: /Anular/ }).first().isVisible({ timeout: 1500 }).catch(() => false)) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
    }
    await page.getByRole('menuitem', { name: /Anular/ }).first().click();
    await dialog().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(3000);
    const text = await dialog().innerText();
    console.log(text);
    check(/Se anula|Contraasiento|Se elimina/.test(text), 'la propuesta muestra los efectos de anular la venta');
    await tall('tsk793-06-anular-venta', dialog());
    await page.keyboard.press('Escape');
  }

  if (run('valuacion')) {
    console.log('Valuación al cierre');
    await goto(`${INV}/valuation`);
    const input = page.getByLabel('Precio por nominal de TSK793 AL30');
    await input.waitFor({ state: 'visible', timeout: 30000 });
    await input.fill('1400');
    await page.waitForTimeout(1000);
    check((await page.locator('main').innerText()).includes('84.000'), 'la vista previa calcula 60 x 1.400 = $84.000');
    await shot('tsk793-07-valuacion-vista-previa');
    await page.getByRole('button', { name: 'Generar valuación' }).first().click();
    await page.getByRole('alertdialog').waitFor({ state: 'visible' });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Generar valuación' }).click();
    await page.waitForTimeout(4000);
    check(psql(`select count(*) from investment_valuations where company_id='${COMPANY}'`) === '1', 'la valuación se generó');
    const entry = psql(`select je.status||'/'||je.process from investment_valuations v join journal_entries je on je.id=v.journal_entry_id where v.company_id='${COMPANY}'`);
    check(entry === 'DRAFT/INVESTMENT_VALUATION', `el asiento quedó en borrador (${entry})`);
    await shot('tsk793-08-valuacion-generada');
    // se deshace para dejar la base sin valuación
    await page.getByRole('button', { name: /Deshacer/ }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Deshacer valuación' }).click();
    await page.waitForTimeout(4000);
    check(psql(`select count(*) from investment_valuations where company_id='${COMPANY}'`) === '0', 'la valuación se deshizo');
  }

  if (run('ajustes')) {
    console.log('Ajustes contables');
    await goto('/dashboard/company/accounting/settings', 5000);
    const label = page.getByText('Resultado por tenencia positivo (inversiones)').first();
    await label.waitFor({ state: 'visible', timeout: 30000 });
    await label.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await shot('tsk793-09-ajustes-contables');
  }
} catch (e) {
  console.error(e);
  failures++;
  await page.screenshot({ path: '/tmp/claude-1000/probe/error.png' }).catch(() => {});
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
