/**
 * Capturas del TSK-798 (FV generada desde remitos descontaba el stock dos veces).
 *
 * Datos de dev (prefijo TSK798): ítem "TSK798 Resma de papel A4" (control de stock) y almacén
 * "TSK798 Depósito Central" en la empresa demo. El script carga 100 unidades por ajuste de stock,
 * crea un remito de entrega de 30 al cliente demo, lo acepta, lo factura con "Facturar Remitos" y
 * confirma la factura. Verifica contra la base que el stock queda en 70 con UN solo movimiento de
 * salida (el del remito).
 *
 * El ítem (con cuenta de ingresos) y el almacén se crean aparte (SQL de dev) si no existen. Al
 * empezar, el script borra los remitos, facturas y movimientos de stock TSK798 de corridas previas.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk798.mjs [baseUrl]
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY = '02885d43-1358-4eb2-b774-c52d5be372f3';
const CODE = 'TSK798-001';
const QTY = 30;
const INITIAL = 100;

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};
const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -Atc "${sql}"`).toString().trim();
const productId = psql(`select id from products where company_id='${COMPANY}' and code='${CODE}'`);
const stockQty = () =>
  Number(psql(`select coalesce(sum(quantity),0) from warehouse_stocks where product_id='${productId}'`));
const movements = () =>
  psql(`select type||':'||quantity||':'||coalesce(reference_type,'') from stock_movements where product_id='${productId}' order by created_at`)
    .split('\n').filter(Boolean);

// Reset de corridas anteriores: solo datos TSK798 de dev (remitos, sus facturas, movimientos, stock)
const wid = psql(`select id from warehouses where company_id='${COMPANY}' and code='TSK798-DEP'`);
const invIds = psql(`select sales_invoice_id from delivery_notes where warehouse_id='${wid}' and sales_invoice_id is not null`).split('\n').filter(Boolean).map((i) => `'${i}'`).join(',');
psql(`update delivery_notes set sales_invoice_id=null where warehouse_id='${wid}'`);
if (invIds) {
  psql(`delete from sales_invoice_lines where invoice_id in (${invIds})`);
  psql(`delete from sales_invoices where id in (${invIds})`);
}
psql(`delete from delivery_note_lines where delivery_note_id in (select id from delivery_notes where warehouse_id='${wid}')`);
psql(`delete from delivery_notes where warehouse_id='${wid}'`);
psql(`delete from stock_movements where warehouse_id='${wid}'`);
psql(`delete from warehouse_stocks where warehouse_id='${wid}'`);

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
  await (target ?? page).screenshot({ path: `${OUT}/tsk798-${name}.png` });
  console.log(`  → ${OUT}/tsk798-${name}.png`);
};
const goto = async (path, ms = 5000) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(ms);
  await hide();
};
const dialog = () => page.getByRole('dialog');
const alert = () => page.getByRole('alertdialog');
const confirmAlert = async () => {
  await alert().waitFor({ state: 'visible' });
  await alert().getByRole('button', { name: /^Confirmar/ }).click();
  await page.waitForTimeout(3500);
};

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  // --- 0. Stock inicial por ajuste de la app
  if (movements().length === 0) {
    console.log('Carga de stock inicial');
    await goto('/dashboard/commercial/movements');
    await page.getByRole('button', { name: 'Ajuste de Stock' }).click();
    await dialog().waitFor({ state: 'visible' });
    await dialog().getByRole('combobox').nth(0).click();
    await page.getByRole('option', { name: /TSK798 Depósito/ }).click();
    await dialog().getByRole('combobox').nth(1).click();
    await page.getByRole('option', { name: /TSK798 Resma/ }).click();
    await dialog().getByPlaceholder('0.000').fill(String(INITIAL));
    await dialog().getByPlaceholder('Describe el motivo del ajuste...').fill('TSK798 inventario inicial');
    await dialog().getByRole('button', { name: /Ajuste|Guardar|Registrar|Crear/ }).last().click();
    await page.waitForTimeout(3500);
  }
  check(stockQty() === INITIAL, `stock inicial = ${INITIAL} (real: ${stockQty()})`);

  const stockByWarehouse = async (name) => {
    await goto('/dashboard/commercial/stock');
    await page.getByText('TSK798 Resma').first().waitFor({ state: 'visible', timeout: 30000 });
    await shot(name, page.locator('main'));
  };

  // --- 1. Antes
  console.log('1. Stock antes');
  await stockByWarehouse('01-stock-antes');

  // --- 2. Remito de entrega
  console.log('2. Remito de entrega');
  await goto('/dashboard/commercial/delivery-notes/new');
  await page.getByRole('combobox').filter({ hasText: 'Selecciona un cliente' }).click();
  await page.getByRole('option', { name: /Cliente Demo/ }).click();
  const wh = page.getByRole('combobox').filter({ hasText: /Selecciona un almac/ });
  if (await wh.count()) {
    await wh.click();
    await page.getByRole('option', { name: /TSK798 Dep/ }).click();
  }
  await page.getByRole('button', { name: 'Agregar Ítem' }).click();
  await page.getByRole('combobox').filter({ hasText: 'Buscar ítem...' }).click();
  await page.getByRole('option', { name: /TSK798 Resma/ }).click();
  await page.getByLabel('Cantidad *').fill(String(QTY));
  await page.getByPlaceholder('Observaciones adicionales').fill('TSK798 entrega de resmas');
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await shot('02-remito-formulario', page.locator('main'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: /Crear|Guardar/ }).last().click();
  await page.waitForURL(/delivery-notes\/[0-9a-f-]{36}$/, { timeout: 30000 });
  await page.waitForTimeout(3000);
  check(stockQty() === INITIAL - QTY, `al crear el remito el stock baja a ${INITIAL - QTY} (real: ${stockQty()})`);
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await confirmAlert();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await shot('03-remito-aceptado', page.locator('main'));

  console.log('   Stock con el remito aceptado');
  await stockByWarehouse('04-stock-tras-remito');

  // --- 3. Facturar remitos
  console.log('3. Facturar remitos');
  await goto('/dashboard/commercial/delivery-notes');
  await page.getByRole('button', { name: 'Facturar Remitos' }).click();
  await dialog().waitFor({ state: 'visible' });
  await dialog().getByRole('combobox').first().click();
  await page.getByRole('option', { name: /Cliente Demo/ }).click();
  await page.waitForTimeout(800);
  await dialog().getByRole('checkbox').first().click();
  await page.waitForTimeout(500);
  await shot('05-facturar-remitos', dialog());
  await dialog().getByRole('button', { name: /^Facturar \(/ }).click();
  await page.waitForTimeout(4000);
  check(stockQty() === INITIAL - QTY, `la factura en borrador no mueve stock (real: ${stockQty()})`);

  // --- 4. Confirmar la factura
  // La factura nace en borrador sin centro de costo en las líneas (no es parte de este ticket); la
  // empresa demo lo exige para confirmar, así que se le asigna el 100% a un centro de costo, que es
  // lo que el usuario haría al editar el borrador.
  psql(`insert into sales_invoice_line_cost_centers (id,line_id,cost_center_id,percentage) select gen_random_uuid(), l.id, (select id from cost_centers where company_id='${COMPANY}' order by name limit 1), 100 from sales_invoice_lines l join delivery_notes d on d.sales_invoice_id=l.invoice_id where d.warehouse_id='${wid}'`);
  console.log('4. Confirmar la factura');
  await goto('/dashboard/commercial/invoices');
  const row = page.locator('table tbody tr').filter({ hasText: /Borrador/ }).first();
  await row.waitFor({ state: 'visible', timeout: 30000 });
  await row.locator('button').last().click();
  await page.getByRole('menuitem', { name: 'Confirmar' }).click();
  await alert().waitFor({ state: 'visible' });
  await alert().getByRole('button', { name: /^Confirmar/ }).click();
  await page.waitForTimeout(1500);
  console.log('   avisos:', await page.locator('[data-sonner-toast]').allInnerTexts());
  await page.waitForTimeout(2000);
  await goto('/dashboard/commercial/invoices');
  const invStatus = psql(`select status from sales_invoices where id=(select sales_invoice_id from delivery_notes where warehouse_id='${wid}' limit 1)`);
  check(invStatus === 'CONFIRMED', `la factura generada quedó CONFIRMED (real: ${invStatus})`);
  await shot('06-factura-confirmada', page.locator('main'));
  console.log('   movimientos:', movements());
  check(stockQty() === INITIAL - QTY, `tras confirmar la factura el stock sigue en ${INITIAL - QTY} (real: ${stockQty()})`);
  const out = movements().filter((m) => m.startsWith('SALE') || Number(m.split(':')[1]) < 0);
  check(out.length === 1 && out[0].endsWith('delivery_note'), `un solo movimiento de salida, el del remito (${out.join(' | ')})`);

  // --- 5. Stock y movimientos después
  console.log('5. Stock y movimientos después');
  await stockByWarehouse('07-stock-despues');
  await goto('/dashboard/commercial/movements');
  await page.getByRole('combobox').filter({ hasText: 'Todos los ítems' }).click();
  await page.getByRole('option', { name: /TSK798 Resma/ }).click();
  await page.getByRole('button', { name: 'Aplicar Filtros' }).click();
  await page.waitForTimeout(3000);
  await page.setViewportSize({ width: 1700, height: 1300 });
  await page.getByText('Historial de Movimientos').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await shot('08-movimientos-del-item');
} catch (e) {
  console.error(e);
  await page.screenshot({ path: '/tmp/tsk798-error.png' }).catch(() => {});
  failures++;
} finally {
  await browser.close();
}
console.log(failures ? `FALLÓ (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
