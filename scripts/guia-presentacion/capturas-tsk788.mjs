/**
 * Capturas del TSK-788 (una factura anulada seguía sumando en Movimientos por Centro de Costo).
 *
 * Escenario en la empresa demo: la FC 0001-00005552 (centro Administración) anulada con su
 * asiento N° 93 todavía en borrador, como la dejaba la anulación anterior a TSK-792. Preparación:
 *   UPDATE purchase_invoices SET status = 'CANCELLED' WHERE id = 'ce34a8a2-7cbc-44f3-9f50-4b1b729a5aa6';
 *
 * 1. El informe de Administración (octubre, con borradores) muestra la factura anulada.
 * 2. Asientos → N° 93 → Eliminar borrador. Sin el arreglo lo rechaza ("pertenece a la factura
 *    de compra..."); con el arreglo lo elimina.
 * 3. Con el arreglo, el informe ya no muestra la factura.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk788.mjs [baseUrl] [--antes]
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const BEFORE = process.argv.includes('--antes');
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const INVOICE = '0001-00005552';
const ENTRY = 93;

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

/** Genera el informe de Administración de octubre con borradores y devuelve si aparece la factura. */
async function costCenterReport(shot) {
  await page.goto(`${BASE}/dashboard/company/accounting/reports?report=cost-center-movements`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(6000);
  await page.locator('#costCenter').click();
  await page.getByRole('option', { name: 'Administración', exact: true }).click();
  await page.fill('#fromDate', '2026-10-01');
  await page.fill('#toDate', '2026-10-31');
  const drafts = page.getByTestId('cost-center-movements-include-drafts');
  if ((await drafts.getAttribute('aria-checked')) !== 'true') await drafts.click();
  await page.getByRole('button', { name: 'Generar' }).click();
  await page.getByText('Saldo del período').first().waitFor({ state: 'visible', timeout: 60000 });
  // La fila del centro viene colapsada: se expande para ver los asientos.
  await page.getByRole('cell', { name: 'Administración' }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await hide();
  const visible = await page.getByText(`Compras - ${INVOICE}`).count();
  await page.screenshot({ path: `${OUT}/${shot}`, fullPage: false });
  console.log(`  → ${OUT}/${shot}`);
  return visible > 0;
}

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  if (BEFORE) {
    check(await costCenterReport('tsk788-00-informe-antes.png'), 'el informe muestra la factura anulada');
  }

  await page.goto(`${BASE}/dashboard/company/accounting/entries`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: `Acciones del asiento ${ENTRY}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Eliminar borrador' }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.waitFor({ state: 'visible' });
  await hide();
  await dialog.getByRole('button', { name: 'Eliminar borrador' }).click();
  const toast = page.locator('[data-sonner-toast]').first();
  await toast.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200); // termina la animación de entrada del toast
  const toastText = (await toast.textContent()) ?? '';
  console.log(`  toast: "${toastText.trim()}"`);
  if (!BEFORE) {
    // La lista se refresca después del toast: se espera a que el asiento salga de la tabla.
    await page
      .getByRole('button', { name: `Acciones del asiento ${ENTRY}`, exact: true })
      .waitFor({ state: 'detached', timeout: 15000 })
      .catch(() => {});
  }
  await page.screenshot({ path: `${OUT}/tsk788-${BEFORE ? '01-eliminar-antes' : '02-eliminar-despues'}.png` });

  if (BEFORE) {
    check(toastText.includes('no se puede eliminar'), 'sin el arreglo, Asientos no deja eliminar el borrador');
  } else {
    check(toastText.includes(`Borrador N° ${ENTRY} eliminado`), 'con el arreglo, el borrador se elimina');
    await page.waitForTimeout(1500);
    check(!(await costCenterReport('tsk788-03-informe-despues.png')), 'el informe ya no muestra la factura anulada');
  }
} catch (error) {
  failures++;
  console.error(error);
  await page.screenshot({ path: `${OUT}/tsk788-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
