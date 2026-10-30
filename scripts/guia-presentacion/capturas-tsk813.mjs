/**
 * Capturas del TSK-813 y el TSK-814 (Archivos ARCA: retenciones de SIRE, SICORE y SIRCAR).
 *
 * Empresa demo: OP-00004 (octubre) con retenciones de IVA (régimen 831), Ganancias (078) e IIBB de
 * Córdoba; OP-00005 con una de Ganancias cargada sin régimen ni base.
 * 1. Contabilidad → Archivos ARCA, octubre: sin el arreglo, solo el Libro IVA Digital; con el
 *    arreglo, además los archivos de retenciones y el aviso de la retención incompleta.
 * 2. Con el arreglo, la retención de la orden de pago con régimen, base imponible y jurisdicción.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk813.mjs [baseUrl] [--antes]
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
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const hide = async () => {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});
  // El botón flotante del widget de soporte tapa las capturas de página completa.
  await page.evaluate(() => {
    for (const el of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.position === 'fixed' && rect.left > window.innerWidth - 200 && rect.width < 200) {
        el.style.visibility = 'hidden';
      }
    }
  });
};

async function chooseOption(trigger, option) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await page.waitForTimeout(300);
}

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  // 1. Archivos ARCA de octubre
  await page.goto(`${BASE}/dashboard/company/accounting/fiscal-exports`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Generar archivos' }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(4000); // hidratación
  await chooseOption(page.getByRole('combobox').first(), 'Octubre');
  await page.getByRole('button', { name: 'Generar archivos' }).click();
  await page.getByText('Libro IVA Digital de Octubre 2026').waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await hide();
  const shot = `tsk813-${BEFORE ? '00-archivos-antes' : '01-archivos-despues'}.png`;
  await page.screenshot({ path: `${OUT}/${shot}`, fullPage: true });
  console.log(`  → ${OUT}/${shot}`);

  const retenciones = page.getByText('Retenciones de Octubre 2026');
  if (BEFORE) {
    check(!(await retenciones.isVisible()), 'sin el arreglo, la pantalla no ofrece archivos de retenciones');
  } else {
    check(await retenciones.isVisible(), 'aparece el bloque de retenciones del mes');
    const row = (label) => page.locator('div.rounded-md.border', { hasText: label });
    for (const label of ['SIRE F.2005: retenciones de IVA', 'SICORE: retenciones de Ganancias', 'SIRCAR: retenciones de IIBB de Córdoba']) {
      check((await row(label).textContent())?.includes('1 registro'), `${label}: 1 registro`);
    }
    check((await row('SIRE F.2004').textContent())?.includes('Sin registros'), 'SIRE F.2004 (SUSS): sin registros');
    check(
      await page.getByText('OP-00005, Ret. Ganancias: falta régimen, base imponible').isVisible(),
      'avisa la retención de la OP-00005 a la que le falta régimen y base'
    );

    // 2. La retención en la orden de pago
    await page.goto(`${BASE}/dashboard/commercial/treasury/payment-orders`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Nueva Orden de Pago' }).waitFor({ timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: 'Nueva Orden de Pago' }).click();
    const section = page.locator('section', { has: page.getByRole('heading', { name: 'Retenciones' }) });
    await section.getByRole('button', { name: 'Agregar' }).click();
    const card = section.locator('div.rounded-md.border', { hasText: 'Retención 1' });
    await chooseOption(card.getByRole('combobox').first(), 'Ret. IIBB');
    await card.getByLabel('Alícuota %').fill('1.5');
    await card.getByPlaceholder('Ej: 078').fill('011');
    await card.getByLabel('Base imponible').fill('826446,28');
    await card.getByLabel('Monto *').fill('12396,69');
    await chooseOption(card.getByRole('combobox').nth(1), '904 · Córdoba');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    await hide();
    await card.screenshot({ path: `${OUT}/tsk813-02-retencion-op.png` });
    console.log(`  → ${OUT}/tsk813-02-retencion-op.png`);
    check(await card.getByText('para SIRCAR también la jurisdicción').isVisible(), 'la OP explica para qué son los datos');
    check(((await card.getByRole('combobox').nth(1).textContent()) ?? '').includes('Córdoba'), 'jurisdicción Córdoba elegida');
  }
} catch (error) {
  failures++;
  console.error(error);
  await page.screenshot({ path: `${OUT}/tsk813-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
