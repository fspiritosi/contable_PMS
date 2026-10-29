/**
 * Capturas del TSK-795 ("October" en el balance del mes): los nombres de mes salen en español.
 *
 * Recorre las pantallas que muestran meses con moment y verifica que ninguna tenga un mes en
 * inglés. Cada pantalla se abre con una carga completa (sin navegación interna), que es el caso
 * en que antes quedaba el inglés: ningún módulo había cargado todavía el idioma español.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk795.mjs [baseUrl]
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const ENGLISH_MONTHS =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;

let failures = 0;
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

const hide = () => page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});
const shot = async (name, target) => {
  await hide();
  await (target ?? page).screenshot({ path: `${OUT}/tsk795-${name}.png` });
  console.log(`  → ${OUT}/tsk795-${name}.png`);
};
const goto = async (path, ms = 8000) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(ms);
  await hide();
};
const noEnglishMonths = async (label) => {
  const text = await page.locator('main').innerText();
  const match = text.match(ENGLISH_MONTHS);
  check(!match, `${label}: sin meses en inglés${match ? ` (aparece "${match[0]}")` : ''}`);
};

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  console.log('Balance del mes (el del ticket)');
  await goto('/dashboard/company/accounting/monthly-balance');
  const title = page.getByText(/^Detalle de /);
  check((await title.textContent())?.trim() === 'Detalle de octubre 2026', `título: "${(await title.textContent())?.trim()}"`);
  await noEnglishMonths('balance del mes');
  await shot('01-balance-del-mes', page.locator('main'));

  console.log('Dashboard');
  await goto('/dashboard');
  await noEnglishMonths('dashboard');
  await shot('02-dashboard');

  console.log('Saldos de cuentas');
  await goto('/dashboard/commercial/account-balances');
  await noEnglishMonths('saldos de cuentas');

  console.log('Flujo de caja');
  await goto('/dashboard/commercial/treasury/cashflow');
  await noEnglishMonths('flujo de caja');
  await shot('03-flujo-de-caja');
} catch (error) {
  failures++;
  console.error(error);
  await page.screenshot({ path: `${OUT}/tsk795-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
