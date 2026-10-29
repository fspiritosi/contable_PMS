/**
 * Capturas del TSK-761 (el Balance General decía "no está equilibrado" en toda empresa con
 * pasivo o patrimonio).
 *
 * Genera el Balance General de la empresa demo a la fecha y verifica que no aparezca el aviso,
 * que el pasivo y el patrimonio se muestren en positivo y que Total Activo = Total Pasivo +
 * Patrimonio Neto.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk761.mjs [baseUrl] [--antes]
 *   --antes: guarda la captura como "antes" (correr sin el arreglo).
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const BEFORE = process.argv.includes('--antes');
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};
const amount = (text) => Number((text ?? '').replace(/[^\d,-]/g, '').replace(',', '.'));

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const context = await browser.newContext({
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const hide = () => page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  await page.goto(`${BASE}/dashboard/company/accounting/reports?report=balance-sheet`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  await page.getByRole('button', { name: 'Generar' }).click();
  await page.getByText('Total Activo', { exact: true }).last().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(1000);
  await hide();

  // La tarjeta del informe (el selector de informes también dice "Balance General").
  const card = page.locator('[data-slot="card"]', { has: page.getByText('Total Pasivo + Patrimonio Neto', { exact: true }) });
  // Fila del resumen final ("Total Activo" también cierra la tabla del activo).
  const row = (label) => card.locator('tr', { has: page.getByText(label, { exact: true }) }).last().locator('td').last();
  const warning = await card.getByText(/El balance no está equilibrado/).isVisible();
  const assets = amount(await row('Total Activo').textContent());
  const liabEq = amount(await row('Total Pasivo + Patrimonio Neto').textContent());
  const equityText = (await card.locator('tr', { has: page.getByText(/^Total Patrimonio Neto/) }).locator('td').last().textContent()) ?? '';

  console.log(`  Total Activo ${assets} · Pasivo + Patrimonio ${liabEq} · Patrimonio "${equityText.trim()}"`);
  if (BEFORE) {
    check(warning, 'sin el arreglo aparece el aviso "no está equilibrado"');
  } else {
    check(!warning, 'no aparece el aviso "no está equilibrado"');
    check(Math.abs(assets - liabEq) < 0.01, 'Total Activo = Total Pasivo + Patrimonio Neto');
    check(!equityText.includes('-'), 'el patrimonio se muestra en positivo');
  }
  await card.screenshot({ path: `${OUT}/tsk761-${BEFORE ? '00-antes' : '01-despues'}.png` });
  console.log(`  → ${OUT}/tsk761-${BEFORE ? '00-antes' : '01-despues'}.png`);
} catch (error) {
  failures++;
  console.error(error);
  await page.screenshot({ path: `${OUT}/tsk761-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
