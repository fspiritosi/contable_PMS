/**
 * Capturas y verificación en navegador del TSK-790 (los montos de las cards de KPIs del
 * dashboard se salían de la card).
 *
 * No siembra datos: usa la empresa activa de dev. Como los montos de dev pueden ser chicos,
 * además de los valores reales reemplaza en pantalla cada monto por uno de 12 cifras
 * ($ 999.999.999.999,99) para forzar el peor caso, con el tamaño de fuente que la fila
 * calcularía para ese largo (kpiValueFontSize).
 *
 * Recorrido, en cada ancho (1280, 1440, 1920 y 375 px):
 *   - captura de la fila de KPIs con los montos reales
 *   - captura con los montos forzados al peor caso
 *   - chequeo: ningún monto termina fuera del borde de su card
 *
 * Uso:
 *   node scripts/guia-presentacion/capturas-tsk790.mjs [baseUrl]            # recorrido (dev :3010)
 *   node scripts/guia-presentacion/capturas-tsk790.mjs [baseUrl] --antes    # guarda como "antes"
 *
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const ANTES = args.includes('--antes');
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const WIDTHS = [1280, 1440, 1920, 375];
const WORST = '$ 999.999.999.999,99';

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

// La fila de KPIs es la grilla que contiene la card "Saldo Bancario".
const KPI_GRID = 'div.grid:has(> [data-slot="card"] :text("Saldo Bancario"))';

/** Para cada card de la fila, cuánto se pasa el monto del borde derecho de la card (px). */
const overflows = (page) =>
  page.$$eval(`${KPI_GRID} > [data-slot="card"]`, (cards) =>
    cards.map((card) => {
      const title = card.querySelector('[data-slot="card-title"]')?.textContent ?? '?';
      const value = card.querySelector('[data-slot="card-content"] > div');
      const cardRight = card.getBoundingClientRect().right;
      const valueRight = value ? value.getBoundingClientRect().left + value.scrollWidth : 0;
      return { title, excess: Math.round(valueRight - cardRight) };
    })
  );

const context = await browser.newContext({
  locale: 'es-AR',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 30000 });

const suffix = ANTES ? '-antes' : '';
for (const width of WIDTHS) {
  console.log(`\n${width} px`);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const grid = page.locator(KPI_GRID).first();
  await grid.waitFor({ timeout: 90000 });
  await page.waitForTimeout(1000);
  // El indicador de desarrollo de Next.js tapa una card en el celular.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });

  for (const r of await overflows(page)) {
    check(
      r.excess <= 0,
      `montos reales — "${r.title}" ${r.excess > 0 ? `se sale ${r.excess} px` : 'entra'}`
    );
  }
  await grid.screenshot({ path: `${OUT}/tsk790-kpis-${width}${suffix}.png` });

  await page.$$eval(
    `${KPI_GRID} > [data-slot="card"] [data-slot="card-content"] > div:first-child`,
    (els, { worst, fontSize }) =>
      els.forEach((el) => {
        if (!/\$/.test(el.textContent ?? '')) return;
        el.textContent = worst;
        // Con el arreglo, la fila ajusta la fuente al valor más largo: se replica lo que
        // calcularía kpiValueFontSize() para un monto de 20 caracteres.
        if (el.style.fontSize) el.style.fontSize = fontSize;
      }),
    { worst: WORST, fontSize: 'min(1.5rem, calc(100cqi / 10.40))' }
  );
  for (const r of await overflows(page)) {
    check(
      r.excess <= 0,
      `peor caso — "${r.title}" ${r.excess > 0 ? `se sale ${r.excess} px` : 'entra'}`
    );
  }
  await grid.screenshot({ path: `${OUT}/tsk790-kpis-${width}-peor-caso${suffix}.png` });
}

await browser.close();
console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
