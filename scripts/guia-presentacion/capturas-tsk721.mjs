/**
 * Capturas para la guía de presentación del TSK-721/718.
 *
 * Recorre: Ajustes contables (cuentas "por defecto", campo de gastos bancarios y
 * aviso de ítems sin cuenta), el listado de ítems filtrado, la confirmación de una
 * factura de compra bloqueada por un ítem sin cuenta (y confirmada al haber cuenta
 * por defecto), y el modal de gastos bancarios con la cuenta preseleccionada.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk721.mjs [baseUrl]
 * Requiere `npm run dev` corriendo y la base de dev. Modifica datos de la
 * Empresa de Prueba 01 SA (dev): un borrador de compra pasa a usar "Soporte
 * Técnico" y la cuenta de compras por defecto se vacía y restaura.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY_ID = '02885d43-1358-4eb2-b774-c52d5be372f3';

mkdirSync(OUT, { recursive: true });

const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -tAc "${sql}"`, {
    encoding: 'utf8',
  }).trim();

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const hideNextBadge = () =>
  page
    .evaluate(() => {
      document
        .querySelectorAll('nextjs-portal, [data-next-badge-root], #next-logo')
        .forEach((el) => el.remove());
    })
    .catch(() => {});

const shot = async (name, locator, opts = {}) => {
  await page.waitForTimeout(700);
  await hideNextBadge();
  await (locator ?? page).screenshot({ path: `${OUT}/tsk721-${name}.png`, ...opts });
  console.log(`  ✓ ${name}`);
};

// --- Datos: cuenta de gastos bancarios por defecto e ítem sin cuenta en un borrador ---
const bankChargesAcc = psql(
  `select id from accounts where company_id='${COMPANY_ID}' and code='4.2.1/03/09' limit 1`
);
psql(`update accounting_settings set bank_charges_account_id='${bankChargesAcc}' where company_id='${COMPANY_ID}'`);
const soporte = psql(`select id from products where company_id='${COMPANY_ID}' and name='Soporte Técnico' limit 1`);
const draft = psql(
  `select id from purchase_invoices where company_id='${COMPANY_ID}' and status='DRAFT' order by created_at desc limit 1`
);
const draftNumber = psql(`select full_number from purchase_invoices where id='${draft}'`);
psql(`update purchase_invoice_lines set product_id='${soporte}', description='Soporte técnico mensual' where invoice_id='${draft}'`);
const purchasesDefault = psql(`select purchases_account_id from accounting_settings where company_id='${COMPANY_ID}'`);
console.log(`borrador de compra ${draftNumber} ahora usa Soporte Técnico (sin cuenta de egreso)`);

// --- Login ---
await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 30000 });
await page.waitForTimeout(2000);

// --- 1. Ajustes contables ---
console.log('Ajustes contables...');
await page.goto(`${BASE}/dashboard/company/accounting/settings`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
const notice = page.getByText(/sin Cuenta de (Ingresos|Egresos)/).first();
if (await notice.count()) {
  const box = await notice.locator('xpath=ancestor::div[contains(@class,"rounded")][1]').boundingBox();
  await shot('01-ajustes-aviso-items', null, { clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } });
}
const ventasLabel = page.getByText('Cuenta de ventas por defecto').first();
await ventasLabel.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const vb = await ventasLabel.boundingBox();
await shot('02-ajustes-ventas-compras', null, { clip: { x: Math.max(vb.x - 24, 0), y: vb.y - 60, width: 900, height: 330 } });
const gbLabel = page.getByText('Gastos bancarios por defecto').first();
await gbLabel.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const gb = await gbLabel.boundingBox();
await shot('03-ajustes-gastos-bancarios', null, { clip: { x: Math.max(gb.x - 24, 0), y: gb.y - 24, width: 900, height: 150 } });

// --- 2. Ítems filtrados ---
console.log('Ítems sin cuenta...');
await page.goto(`${BASE}/dashboard/commercial/products?imputation=noExpense&status=ACTIVE`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await shot('04-items-sin-egreso', page.locator('table').first());
await page.goto(`${BASE}/dashboard/commercial/products?status=ACTIVE`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const facet = page.getByRole('button', { name: /Imputación/ }).first();
if (await facet.count()) {
  await facet.click();
  await page.waitForTimeout(600);
  await shot('05-items-facet-imputacion', null, { clip: { x: 0, y: 60, width: 1500, height: 520 } });
  await page.keyboard.press('Escape');
}

// --- 3. Confirmar compra: bloqueada sin cuenta, confirmada con cuenta por defecto ---
const openConfirm = async () => {
  await page.goto(`${BASE}/dashboard/commercial/purchases`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const row = page.locator('table tbody tr').filter({ hasText: draftNumber }).first();
  await row.locator('button').last().click();
  await page.waitForTimeout(500);
  await page.getByRole('menuitem', { name: /Confirmar/ }).click();
  await page.waitForTimeout(600);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirmar' }).click();
  await page.waitForTimeout(2500);
};

console.log('Confirmar sin cuenta (bloquea)...');
psql(`update accounting_settings set purchases_account_id=null where company_id='${COMPANY_ID}'`);
try {
  await openConfirm();
  const toast = page.locator('[data-sonner-toast]').first();
  console.log('  toast:', (await toast.innerText().catch(() => '(sin toast)')).replace(/\s+/g, ' '));
  await shot('06-confirmar-bloqueado', null, { clip: { x: 0, y: 0, width: 1500, height: 950 } });
  console.log('  status:', psql(`select status from purchase_invoices where id='${draft}'`));
} finally {
  psql(`update accounting_settings set purchases_account_id='${purchasesDefault}' where company_id='${COMPANY_ID}'`);
}

console.log('Confirmar con cuenta por defecto...');
// La empresa de prueba exige centro de costo (TSK-583): se apaga solo para este caso.
const requireCC = psql(`select require_cost_center from accounting_settings where company_id='${COMPANY_ID}'`);
psql(`update accounting_settings set require_cost_center=false where company_id='${COMPANY_ID}'`);
await openConfirm();
psql(`update accounting_settings set require_cost_center=${requireCC === 't'} where company_id='${COMPANY_ID}'`);
const toast2 = page.locator('[data-sonner-toast]').first();
console.log('  toast:', (await toast2.innerText().catch(() => '(sin toast)')).replace(/\s+/g, ' '));
await shot('07-confirmar-ok', null, { clip: { x: 0, y: 0, width: 1500, height: 950 } });
console.log('  status:', psql(`select status, journal_entry_id is not null as con_asiento from purchase_invoices where id='${draft}'`));

// --- 4. Gastos bancarios: cuenta preseleccionada ---
console.log('Modal gastos bancarios...');
await page.goto(`${BASE}/dashboard/commercial/treasury/fund-movements`, { waitUntil: 'load' });
await page.waitForTimeout(3500);
await page.getByRole('button', { name: /Nuevo Movimiento/ }).waitFor({ state: 'visible', timeout: 30000 });
await page.getByRole('button', { name: /Nuevo Movimiento/ }).click();
await page.waitForTimeout(800);
const dialog = page.getByRole('dialog');
await dialog.getByRole('combobox').first().click();
await page.waitForTimeout(400);
await page.getByRole('option', { name: /Gastos e impuestos bancarios/ }).click();
await page.waitForTimeout(800);
await dialog.getByRole('button', { name: /Agregar/ }).first().click();
await page.waitForTimeout(800);
await shot('08-gastos-bancarios-preseleccion', dialog);
console.log((await dialog.innerText()).split('\n').filter((l) => /por defecto|imputan/.test(l)).map((l) => '     ' + l).join('\n'));
await page.keyboard.press('Escape');

await browser.close();
console.log('Listo.');
