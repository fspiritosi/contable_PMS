/**
 * Capturas y verificación del TSK-839 (concepto de gasto bancario con cuenta de Gastos) y del
 * TSK-840 (aviso al guardar una factura con líneas sin centro de costo).
 *
 * Datos de dev: cuenta 4.2.1/07/06 «Impuesto débitos y créditos bancarios» (Gastos), proveedor
 * «Banco de Galicia…», centros «Indirecto» y «Administración», ítem «Gastos bancarios c/IVA» sin
 * centro predeterminado e ítem «Mantenimiento cuenta» con centro predeterminado «Indirecto».
 *
 * 1. Contabilidad → Conceptos → Nuevo concepto con «Gastos e impuestos bancarios» + «Comisión»:
 *    el selector ofrece la cuenta de Gastos y el concepto se guarda con ella.
 * 2. Nueva factura de compra con los dos ítems: al guardar avisa solo la línea sin centro;
 *    «Elegir ahora» vuelve al reparto de esa línea; «Guardar sin centro de costo» guarda.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk839-840.mjs [baseUrl] [email] [password]
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [BASE = 'http://localhost:3010', EMAIL = 'dev@local.test', PASSWORD = 'Contable2026!'] =
  process.argv.slice(2);
const OUT = 'scripts/guia-presentacion/assets';

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
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const hideDevOverlay = () =>
  page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});

async function goto(path, readyText) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(readyText).first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(3000); // hidratación
  await hideDevOverlay();
}

async function chooseSelectOption(trigger, option) {
  await trigger.click();
  await page.getByRole('option', { name: option }).first().click();
  await page.waitForTimeout(400);
}

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  // ── TSK-839: concepto de gasto bancario ──
  console.log('TSK-839');
  await goto('/dashboard/company/accounting/concepts', 'Nuevo concepto');
  await page.getByRole('button', { name: 'Nuevo concepto' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Ej: Impuesto ley 25.413').fill('Imp. déb./créd. ley 25413');
  await dialog.locator('label', { hasText: 'Gastos e impuestos bancarios' }).click();
  await dialog.locator('label', { hasText: /^Comisión$/ }).click();
  await page.waitForTimeout(1500);
  await dialog.getByRole('combobox').filter({ hasText: 'Seleccionar cuenta' }).click();
  const expenseOption = page.getByRole('option', { name: /4\.2\.1\/07\/06/ });
  await expenseOption.waitFor({ timeout: 15000 }).catch(() => {});
  check(await expenseOption.isVisible(), 'el selector ofrece la cuenta de Gastos 4.2.1/07/06');
  await page.waitForTimeout(800); // fin de la animación de apertura
  await page.screenshot({ path: `${OUT}/tsk839-1-cuenta-de-gastos.png` });
  await expenseOption.click();
  await page.waitForTimeout(300);
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await page.getByText('Concepto creado').waitFor({ timeout: 20000 }).catch(() => {});
  check(await page.getByText('Concepto creado').isVisible(), 'el concepto se guarda con esa cuenta');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/tsk839-2-concepto-creado.png` });

  // ── TSK-840: aviso de centro de costo al guardar ──
  console.log('TSK-840');
  await goto('/dashboard/commercial/purchases/new', 'Nueva Factura de Compra');
  await chooseSelectOption(
    page.getByRole('combobox').filter({ hasText: 'Selecciona un proveedor' }),
    /Banco de Galicia/
  );
  await page.locator('input[name="pointOfSale"]').fill('0002');
  await page.locator('input[name="number"]').fill('00004521');

  const addItem = page.getByRole('button', { name: 'Agregar Ítem' });
  for (const [index, product, price] of [
    [0, 'Gastos bancarios c/IVA', '1000'],
    [1, 'Mantenimiento cuenta', '500'],
  ]) {
    await addItem.click();
    await page.waitForTimeout(500);
    await chooseSelectOption(page.getByRole('combobox').filter({ hasText: 'Opcional' }).first(), product);
    await page.locator(`input[name="lines.${index}.description"]`).fill(product);
    await page.locator(`input[name="lines.${index}.quantity"]`).fill('1');
    const unitCost = page.locator(`input[name="lines.${index}.unitCost"]`);
    await ((await unitCost.count()) > 0 ? unitCost : page.getByPlaceholder('0,00').nth(index)).fill(price);
  }

  await page.getByRole('button', { name: 'Guardar Factura' }).click();
  const reminder = page.getByRole('alertdialog');
  await reminder.waitFor({ timeout: 15000 }).catch(() => {});
  const reminderText = (await reminder.isVisible()) ? await reminder.innerText() : '';
  console.log(`  aviso: ${reminderText.replace(/\s+/g, ' ').trim()}`);
  check(reminderText.includes('Una línea sin centro de costo'), 'al guardar aparece el aviso');
  check(reminderText.includes('Gastos bancarios c/IVA'), 'el aviso nombra la línea sin centro');
  check(
    !reminderText.includes('Mantenimiento cuenta'),
    'no marca la línea cuyo ítem tiene centro predeterminado'
  );
  await page.waitForTimeout(800); // fin de la animación de apertura
  await page.screenshot({ path: `${OUT}/tsk840-1-aviso.png` });

  await reminder.getByRole('button', { name: 'Elegir ahora' }).click();
  await page.waitForTimeout(1500);
  check(!(await reminder.isVisible()), '«Elegir ahora» cierra el aviso sin guardar');
  check(page.url().endsWith('/purchases/new'), 'sigue en el formulario');
  check(await page.locator('#cost-center-line-0').isVisible(), 'la vista queda en el reparto de la línea');
  await page.screenshot({ path: `${OUT}/tsk840-2-elegir-ahora.png` });

  await page.getByRole('button', { name: 'Guardar Factura' }).click();
  await reminder.waitFor({ timeout: 15000 });
  await reminder.getByRole('button', { name: 'Guardar sin centro de costo' }).click();
  await page.waitForURL(/\/purchases\/[0-9a-f-]{36}$/, { timeout: 60000 }).catch(() => {});
  check(/\/purchases\/[0-9a-f-]{36}$/.test(page.url()), '«Guardar sin centro de costo» guarda la factura');
} catch (error) {
  console.error(error);
  failures++;
  await page.screenshot({ path: `${OUT}/tsk839-840-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

process.exit(failures === 0 ? 0 : 1);
