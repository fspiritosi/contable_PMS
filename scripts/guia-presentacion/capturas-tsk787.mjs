/**
 * Capturas del TSK-787 (en la factura de compra, la letra del comprobante según la condición IVA
 * del proveedor).
 *
 * Empresa demo con dos proveedores: NIC Argentina (Exento) y Distribuidora de Combustibles SRL
 * (Responsable Inscripto). En Compras → Nueva factura:
 * 1. Proveedor Exento: el selector ofrece solo comprobantes C (sin el arreglo ofrecía todos).
 * 2. Con el arreglo, al pasar al proveedor inscripto la Factura C cambia sola a Factura A y se
 *    ofrecen A y B.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk787.mjs [baseUrl] [--antes]
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

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const context = await browser.newContext({
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const hide = () => page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});

const field = (label) => page.locator('[data-slot="form-item"]', { has: page.getByText(label, { exact: true }) });

async function chooseSupplier(name) {
  await field('Proveedor *').getByRole('combobox').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await page.waitForTimeout(500);
}

/** Abre el selector de comprobante, saca la captura y devuelve las opciones y el valor elegido. */
async function voucherOptions(shot) {
  const voucher = field('Tipo de Comprobante *');
  const value = ((await voucher.getByRole('combobox').textContent()) ?? '').trim();
  await voucher.getByRole('combobox').click();
  await page.waitForTimeout(500); // animación de apertura
  const options = (await page.getByRole('option').allTextContents()).map((o) => o.trim());
  await hide();
  await page.screenshot({ path: `${OUT}/${shot}`, clip: { x: 256, y: 60, width: 1184, height: 640 } });
  console.log(`  → ${OUT}/${shot}: "${value}" de [${options.join(', ')}]`);
  await page.keyboard.press('Escape');
  return { value, options };
}

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  await page.goto(`${BASE}/dashboard/commercial/purchases/new`, { waitUntil: 'domcontentloaded' });
  await field('Proveedor *').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(5000); // hidratación del formulario

  await chooseSupplier('NIC');
  const exento = await voucherOptions(`tsk787-${BEFORE ? '00-exento-antes' : '01-exento-despues'}.png`);

  if (BEFORE) {
    check(exento.options.includes('Factura A'), 'sin el arreglo, a un proveedor Exento se le ofrece Factura A');
  } else {
    check(exento.value === 'Factura C', 'al elegir el proveedor Exento, la Factura A pasa sola a Factura C');
    check(
      JSON.stringify(exento.options) ===
        JSON.stringify(['Factura C', 'Nota de Crédito C', 'Nota de Débito C', 'Gastos Bancarios']),
      'solo se ofrecen comprobantes C (y Gastos Bancarios)'
    );
    check(await page.getByText('Proveedor Exento: comprobantes C.').isVisible(), 'el formulario explica por qué');

    await chooseSupplier('Distribuidora');
    const inscripto = await voucherOptions('tsk787-02-inscripto.png');
    check(inscripto.value === 'Factura A', 'al pasar al proveedor inscripto, la Factura C pasa a Factura A');
    check(!inscripto.options.some((o) => o.endsWith(' C')), 'a un Responsable Inscripto no se le ofrece C');
  }
} catch (error) {
  failures++;
  console.error(error);
  await page.screenshot({ path: `${OUT}/tsk787-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
