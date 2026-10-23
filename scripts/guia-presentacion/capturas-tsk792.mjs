/**
 * Capturas del TSK-792 (editar, eliminar y anular comprobantes confirmados con corrección en cadena).
 *
 * Crea sus propios datos por la app (descripciones y números únicos por corrida) en la empresa
 * activa de dev, y los deja ahí. Recorrido:
 *   1. FC de $1.000.000 confirmada + OP que la paga completa.
 *   2. Editar la FC a $800.000 -> propuesta (variante A) -> Confirmar -> FC pagada y OP en $800.000.
 *   3. Asiento Registrado: la propuesta muestra "Podés resolverlo"; se vuelve a borrador en Asientos.
 *   4. Período cerrado: la propuesta muestra "No se puede" (se cierra el mes por SQL y se reabre al final).
 *   5. OP con dos medios de pago: al bajar la FC hay que elegir de cuál se descuenta.
 *   6. Anular una OP: propuesta (vista previa).
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk792.mjs [baseUrl] [--only=editar|asiento|periodo|medios|anular]
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const run = (name) => !ONLY || ONLY === name;
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY = '02885d43-1358-4eb2-b774-c52d5be372f3';
const RUN = Date.now();
const PI_LIST = '/dashboard/commercial/purchases';
const OP_LIST = '/dashboard/commercial/treasury/payment-orders';

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};
const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -Atc "${sql}"`).toString().trim();

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const cleanups = [];

const hide = () => page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});
const shot = async (name, target) => {
  await hide();
  await (target ?? page).screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  → ${OUT}/${name}.png`);
};
const goto = async (path, ms = 3500) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(ms);
  await hide();
};
const rowMenu = async (list, text, item) => {
  await goto(list);
  const row = page.locator('table tbody tr').filter({ hasText: text }).first();
  await row.waitFor({ state: 'visible', timeout: 30000 });
  // los permisos del cliente cargan después de la tabla: se reabre el menú hasta que aparezca el ítem
  for (let i = 0; i < 8; i++) {
    await row.locator('button').last().click();
    if (await page.getByRole('menuitem', { name: item }).first().isVisible({ timeout: 1500 }).catch(() => false)) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  }
  await page.getByRole('menuitem', { name: item }).first().click();
};
const confirmAlert = async () => {
  const dlg = page.getByRole('alertdialog');
  await dlg.waitFor({ state: 'visible', timeout: 10000 });
  await dlg.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.waitForTimeout(3000);
};

const login = async () => {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};

/** Listado de FC filtrado al mes de `isoDate` (el listado abre en el mes actual). */
const monthList = (isoDate) => {
  const [y, m] = isoDate.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)).toISOString();
  return `${PI_LIST}?issueDate=${start},${end}`;
};

/** Crea una FC por el formulario y la confirma desde el listado. Devuelve el número completo. */
let seq = 0;
const createInvoice = async (desc, amount, { issueDate } = {}) => {
  const number = String(RUN + seq++).slice(-8);
  const full = `0001-${number}`;
  await goto('/dashboard/commercial/purchases/new', 4000);
  await page.getByRole('combobox').filter({ hasText: 'Selecciona un proveedor' }).click();
  await page.getByRole('option').first().click();
  await page.locator('input[name=pointOfSale]').fill('0001');
  await page.locator('input[name=number]').fill(number);
  if (issueDate) await page.locator('input[name=issueDate]').fill(issueDate);
  await page.getByRole('button', { name: 'Agregar Ítem' }).click();
  await page.getByPlaceholder('Descripción del ítem').fill(desc);
  await page.locator('input[name="lines.0.unitCost"]').fill(String(amount));
  await page.getByRole('combobox').filter({ hasText: '21%' }).click();
  await page.getByRole('option', { name: '0%', exact: true }).click();
  await page.getByRole('button', { name: 'Agregar centro' }).click();
  await page.getByRole('combobox').filter({ hasText: /centro de costo/ }).click();
  await page.getByRole('option', { name: 'Administración' }).click();
  await page.getByRole('button', { name: 'Guardar Factura' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/new'), { timeout: 30000 });
  await rowMenu(issueDate ? monthList(issueDate) : PI_LIST, full, /Confirmar/);
  await confirmAlert();
  const status = psql(`select status from purchase_invoices where company_id='${COMPANY}' and full_number='${full}'`);
  check(status === 'CONFIRMED', `FC ${full} confirmada (${desc})`);
  return full;
};

/** Crea una OP que paga `parts` ([{ invoice, amount }]) con los medios `methods` y la confirma. */
const createOrder = async (parts, methods) => {
  await goto(OP_LIST, 4000);
  const before = psql(`select coalesce(max(number),0) from payment_orders where company_id='${COMPANY}'`);
  await page.getByRole('button', { name: /Nueva Orden de Pago/ }).click();
  const modal = page.getByRole('dialog');
  await modal.waitFor({ state: 'visible' });
  await modal.getByRole('tab', { name: 'Facturas' }).click();
  await modal.getByRole('combobox').filter({ hasText: /Seleccionar proveedor/ }).first().click();
  await page.getByRole('option').first().click();
  await page.waitForTimeout(2500);
  for (const { invoice, amount } of parts) {
    await modal.getByRole('combobox').filter({ hasText: /Agregar factura/ }).first().click();
    await page.getByRole('option', { name: new RegExp(invoice) }).click();
    await page.waitForTimeout(500);
    await modal.getByRole('button', { name: /Agregar/ }).first().click();
    await page.waitForTimeout(500);
    const input = modal.locator('tr', { hasText: invoice }).locator('input').first();
    await input.fill(String(amount));
  }
  for (const [i, m] of methods.entries()) {
    // la primera forma de pago aparece sola al agregar una factura; las siguientes se agregan a mano
    if (i > 0) await modal.getByText('FORMAS DE PAGO').locator('..').getByRole('button', { name: 'Agregar' }).click();
    await page.waitForTimeout(400);
    await modal.getByText('Monto *', { exact: true }).nth(i).locator('xpath=following::input[1]').fill(String(m.amount));
    await modal.getByRole('combobox').filter({ hasText: /Seleccionar cuenta/ }).first().click();
    await page.getByRole('option').first().click();
  }
  await modal.getByRole('button', { name: /Crear Orden de Pago/ }).click();
  await modal.waitFor({ state: 'hidden', timeout: 30000 });
  await page.waitForTimeout(1500);
  const number = psql(`select full_number from payment_orders where company_id='${COMPANY}' and number>${before} order by number desc limit 1`);
  await rowMenu(OP_LIST, number, /Confirmar/);
  await confirmAlert();
  check(psql(`select status from payment_orders where company_id='${COMPANY}' and full_number='${number}'`) === 'CONFIRMED', `OP ${number} confirmada`);
  return number;
};

const piId = (full) => psql(`select id from purchase_invoices where company_id='${COMPANY}' and full_number='${full}'`);
const dialog = () => page.getByRole('dialog');
const alert = () => page.getByRole('alertdialog');

/** Abre la edición de la FC, cambia el valor unitario y llega a la propuesta ("Revisar cambios"). */
const openEditProposal = async (full, newAmount) => {
  await goto(`${PI_LIST}/${piId(full)}/edit`, 5000);
  const input = page.locator('input[name="lines.0.unitCost"]');
  await input.waitFor({ state: 'visible', timeout: 30000 });
  await input.fill(String(newAmount));
  await page.getByRole('button', { name: /Revisar cambios/ }).click();
  await dialog().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2500);
};

try {
  await login();
  // el diálogo es alto: se toma con una ventana alta para que se vean todas las tarjetas
  const tall = async (name) => {
    await page.setViewportSize({ width: 1440, height: 1500 });
    await page.waitForTimeout(800);
    await shot(name, dialog());
    await page.setViewportSize({ width: 1440, height: 900 });
  };

  if (run('editar')) {
    console.log('Editar la FC de $1.000.000 a $800.000');
    const fc = await createInvoice(`TSK792 Servicio ${RUN}`, 1000000);
    const op = await createOrder([{ invoice: fc, amount: 1000000 }], [{ amount: 1000000 }]);
    await openEditProposal(fc, 800000);
    const text = await dialog().innerText();
    check(/Se modifica/.test(text) && /Se reescribe/.test(text), 'la propuesta muestra FC, asiento y OP');
    await tall('tsk792-02-propuesta-fc');
    await dialog().getByRole('button', { name: 'Confirmar corrección' }).click();
    await page.waitForURL(new RegExp(`${PI_LIST}/${piId(fc)}$`), { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3500);
    await hide();
    check(psql(`select status||'/'||total from purchase_invoices where full_number='${fc}' and company_id='${COMPANY}'`) === 'PAID/800000.00', 'la FC quedó pagada por $800.000');
    check(psql(`select total_amount from payment_orders where full_number='${op}' and company_id='${COMPANY}'`) === '800000.00', `la ${op} bajó a $800.000`);
    await shot('tsk792-06-factura-editada');
  }
  const entryNumber = (table, full) =>
    psql(`select je.number from ${table} t join journal_entries je on je.id=t.journal_entry_id where t.company_id='${COMPANY}' and t.full_number='${full}'`);
  const entriesRow = async (number) => {
    await goto('/dashboard/company/accounting/entries', 4000);
    const button = page.getByRole('button', { name: `Acciones del asiento ${number}` });
    await button.waitFor({ state: 'visible', timeout: 30000 });
    return button;
  };

  if (run('asiento')) {
    console.log('Asiento Registrado: "Podés resolverlo" y volver a borrador');
    const fc2 = await createInvoice(`TSK792 Asiento registrado ${RUN}`, 1000000);
    const op2 = await createOrder([{ invoice: fc2, amount: 1000000 }], [{ amount: 1000000 }]);
    const n = entryNumber('purchase_invoices', fc2);
    const nOp = entryNumber('payment_orders', op2).replace(/\n.*/s, '');
    for (const num of [n, nOp]) {
      const button = await entriesRow(num);
      await button.click();
      await page.getByRole('menuitem', { name: 'Registrar' }).click();
      await alert().getByRole('button', { name: /Registrar/ }).click();
      await page.waitForTimeout(2500);
    }
    check(psql(`select status from journal_entries where company_id='${COMPANY}' and number=${n}`) === 'POSTED', `el asiento ${n} quedó Registrado`);

    await openEditProposal(fc2, 800000);
    const text = await dialog().innerText();
    check(/Podés resolverlo/.test(text), 'la propuesta indica "Podés resolverlo"');
    await tall('tsk792-03-impedimentos-manual');
    await dialog().getByRole('button', { name: /Volver a editar|Cerrar/ }).first().click().catch(() => page.keyboard.press('Escape'));

    const button = await entriesRow(n);
    await button.click();
    await page.getByRole('menuitem', { name: 'Volver a borrador' }).waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await shot('tsk792-01-asientos-volver-a-borrador');
    await page.getByRole('menuitem', { name: 'Volver a borrador' }).click();
    await alert().waitFor({ state: 'visible' });
    await page.waitForTimeout(1500);
    await shot('tsk792-01b-volver-a-borrador-dialogo', alert());
    await alert().getByRole('button', { name: /Volver a borrador/ }).click();
    await page.waitForTimeout(2500);
    check(psql(`select status from journal_entries where company_id='${COMPANY}' and number=${n}`) === 'DRAFT', `el asiento ${n} volvió a borrador`);
  }

  if (run('periodo')) {
    console.log('Período cerrado: "No se puede"');
    const fc3 = await createInvoice(`TSK792 Período cerrado ${RUN}`, 500000, { issueDate: '2026-09-15' });
    const closePeriod = (closed) =>
      psql(`update accounting_periods set is_closed=${closed}, closed_at=${closed ? 'now()' : 'null'} where type='MONTHLY' and year=2026 and month=9 and fiscal_year_id in (select id from fiscal_years where company_id='${COMPANY}')`);
    closePeriod(true);
    cleanups.push(() => closePeriod(false)); // se reabre el mes al terminar
    await rowMenu(monthList('2026-09-15'), fc3, /Anular/);
    await dialog().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2500);
    const text = await dialog().innerText();
    console.log(text);
    check(/No se puede/.test(text), 'la propuesta indica "No se puede" por el período cerrado');
    await tall('tsk792-04-impedimentos-bloqueado');
    await page.keyboard.press('Escape');
    closePeriod(false);
  }

  if (run('medios')) {
    console.log('OP con dos medios de pago: elegir de cuál se descuenta');
    const fc4 = await createInvoice(`TSK792 Dos medios ${RUN}`, 1000000);
    const op4 = await createOrder([{ invoice: fc4, amount: 1000000 }], [{ amount: 600000 }, { amount: 400000 }]);
    await openEditProposal(fc4, 800000);
    const text = await dialog().innerText();
    console.log(text);
    check(/medio|Medio/.test(text), 'la propuesta pide elegir el medio de pago');
    await tall('tsk792-05-eleccion-medio-de-pago');
    await page.keyboard.press('Escape');
    console.log({ fc4, op4 });
  }

  if (run('anular')) {
    console.log('Anular una OP');
    const fc5 = await createInvoice(`TSK792 Anular OP ${RUN}`, 1000000);
    const op5 = await createOrder([{ invoice: fc5, amount: 1000000 }], [{ amount: 1000000 }]);
    await rowMenu(OP_LIST, op5, /Anular/);
    await dialog().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2500);
    const text = await dialog().innerText();
    console.log(text);
    check(/Vuelve a cartera|Se anula|Contraasiento|Se recalcula/.test(text), 'la propuesta de anular la OP muestra los efectos');
    await tall('tsk792-07-anular-op');
    await page.keyboard.press('Escape');
  }

} catch (e) {
  console.error(e);
  failures++;
} finally {
  for (const fn of cleanups.reverse()) await Promise.resolve(fn()).catch(() => {});
  await browser.close();
}
process.exit(failures ? 1 : 0);
