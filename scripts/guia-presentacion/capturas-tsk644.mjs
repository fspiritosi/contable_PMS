/**
 * Capturas para la guía de presentación del TSK-644.
 *
 * Carga en el formulario real de factura de compra los importes de la factura
 * de La Anónima que adjunta el ticket, y captura la sección de percepciones y
 * el panel de totales ya calculado.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk644.mjs
 * Requiere `npm run dev` corriendo en localhost:3000.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const shot = async (name, locator) => {
  await page.waitForTimeout(900);
  // El indicador flotante de Next tapa la esquina inferior derecha. Vive en un
  // custom element con shadow DOM, así que no alcanza con una regla CSS: se
  // quita el host del DOM.
  await page
    .evaluate(() => {
      document
        .querySelectorAll('nextjs-portal, [data-next-badge-root], #next-logo')
        .forEach((el) => el.remove());
    })
    .catch(() => {});
  await (locator ?? page).screenshot({ path: `${OUT}/tsk644-${name}.png`, ...(locator ? {} : { fullPage: true }) });
  console.log(`  ✓ ${name}`);
};

// --- Login ---
await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.fill('input[type="email"], input[name="email"]', EMAIL);
await page.fill('input[type="password"], input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);

// --- Formulario de factura de compra con los datos del ticket ---
console.log('Cargando la factura del ticket...');
await page.goto(`${BASE}/dashboard/commercial/purchases/new`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// Proveedor
await page.getByText('Selecciona un proveedor').click();
await page.waitForTimeout(800);
await page.locator('[role="option"]').first().click();
await page.waitForTimeout(800);

// Dos ítems: neto 21% y neto 10,5%
const netos = [['91957,84', '21'], ['91284,86', '10.5']];
for (const [costo, iva] of netos) {
  await page.getByRole('button', { name: /Agregar Ítem/i }).click();
  await page.waitForTimeout(700);
}
const descripciones = page.locator('input[name^="lines."][name$=".description"]');
const cantidades = page.locator('input[name^="lines."][name$=".quantity"]');
const costos = page.locator('input[name^="lines."][name$=".unitCost"]');
for (let i = 0; i < netos.length; i++) {
  await descripciones.nth(i).fill(i === 0 ? 'Mercadería gravada 21%' : 'Mercadería gravada 10,5%');
  await cantidades.nth(i).fill('1');
  await costos.nth(i).fill(netos[i][0]);
  await page.waitForTimeout(300);
}

// La segunda línea va al 10,5% (la primera queda en 21%, el valor por defecto)
await page.locator('button[role="combobox"]').filter({ hasText: '21%' }).nth(1).click();
await page.waitForTimeout(600);
await page.getByRole('option', { name: '10.5%' }).click();
await page.waitForTimeout(900);

// Percepciones: IIBB NQN e IVA
const percepciones = [
  { jurisdiccion: 'NQN', monto: '1832,43' },
  { jurisdiccion: '', monto: '4128,01' },
];
for (const _ of percepciones) {
  await page.getByRole('button', { name: /Agregar percepción/i }).click();
  await page.waitForTimeout(600);
}
const jurisdicciones = page.locator('input[name^="perceptions."][name$=".jurisdiction"]');
const montos = page.locator('input[name^="perceptions."][name$=".amount"]');
for (let i = 0; i < percepciones.length; i++) {
  if (percepciones[i].jurisdiccion) await jurisdicciones.nth(i).fill(percepciones[i].jurisdiccion);
  await montos.nth(i).fill(percepciones[i].monto);
  await page.waitForTimeout(300);
}

// La segunda es percepción de IVA (la primera queda en IIBB, el valor por defecto)
await page.locator('button[role="combobox"]').filter({ hasText: 'Percepción IIBB' }).nth(1).click();
await page.waitForTimeout(600);
await page.getByRole('option', { name: 'Percepción IVA' }).click();
await page.waitForTimeout(800);

// Impuestos internos
await page.locator('#internal-taxes').fill('326,95');
await page.waitForTimeout(1200);

// Sección de percepciones y panel de totales
const seccionPerc = page
  .locator('h3', { hasText: 'Percepciones e impuestos internos' })
  .locator('xpath=ancestor::div[contains(@class,"p-6")][1]');
await seccionPerc.scrollIntoViewIfNeeded();
await shot('percepciones-cargadas', seccionPerc);

const totales = page
  .locator('h3', { hasText: 'Totales' })
  .locator('xpath=ancestor::div[contains(@class,"p-6")][1]');
// El indicador de Next es un overlay fijo en la esquina inferior derecha que
// no se puede quitar del DOM (shadow root propio): se esquiva dejando el panel
// en la mitad superior de la ventana.
await totales.evaluate((el) => el.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(600);
await shot('totales', totales);

// --- Configuración contable ---
console.log('Configuración contable...');
await page.goto(`${BASE}/dashboard/company/accounting/settings`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

// Las tres secciones nuevas viven al final del formulario de integración
// comercial: se recorta el bloque que va desde "Percepciones Cobradas" hasta
// el final de "Impuestos Internos".
const desde = page.getByText('Percepciones Cobradas (por Depositar)').first();
const hasta = page
  .getByText('En compras suele ser una cuenta de resultado', { exact: false })
  .first();
await desde.evaluate((el) => el.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(800);

const a = await desde.boundingBox();
const b = await hasta.boundingBox();
await page.screenshot({
  path: `${OUT}/tsk644-config-contable.png`,
  clip: {
    x: Math.max(a.x - 24, 0),
    y: Math.max(a.y - 24, 0),
    width: 1120,
    height: b.y + b.height - a.y + 48,
  },
});
console.log('  ✓ config-contable');

await browser.close();
console.log('Listo.');
