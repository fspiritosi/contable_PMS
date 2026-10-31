/**
 * Capturas del TSK-735 (cuentas contables para cheques, tarjetas y devolución a socio).
 *
 * Empresa demo (Empresa de Prueba 01 SA). Siembra por SQL, marcados con notes = 'TSK735-demo':
 *   - 4 cuentas contables (Cheques rechazados, Valores diferidos a pagar, Tarjetas de crédito a pagar,
 *     Deudas con socios) si no existen, y las 5 cuentas de Configuración;
 *   - R-00002: cobro de la factura 0001-00000004 con un cheque de terceros y efectivo;
 *   - OP-00016: pago de una compra con un cheque propio (T735-0001);
 *   - una tarjeta de débito del socio Juan Perez y OP-00017 pagada con ella;
 *   - OP-00018: devolución al socio, en efectivo.
 * Los comprobantes se confirman por la pantalla (acciones reales del servidor).
 *
 *   1. Contabilidad → Configuración → Cheques y tarjetas, vacía y completa
 *   2. Confirmar el recibo con cheque (vista previa del asiento) y su asiento
 *   3. Confirmar la OP con cheque propio y su asiento
 *   4. Tesorería → Cheques → Debitar (modal) y su asiento
 *   5. OP con tarjeta del socio, y la devolución al socio con su asiento
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk735.mjs [baseUrl]
 * Es reanudable: salta lo que ya está sembrado o confirmado. Sale con código ≠ 0 si un chequeo falla.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const C = '02885d43-1358-4eb2-b774-c52d5be372f3';
const USER_ID = '848d69ff-198d-4588-975e-d3691ea2333f';
const CUSTOMER = '13cb8ab1-d509-445c-9816-f33bc061f91a'; // Cliente Demo SA
const SALE_INV = 'd6fcdc79-48d3-43f1-bddf-409b16477d96'; // 0001-00000004, 49.005
const SUPPLIER = '398ae92a-c27c-425f-8367-3141a9a3f3d6';
const PURCH_A = '480801ed-9186-4903-a6dc-e8d95fe66221';
const PURCH_B = 'bf7faf13-25d3-4f8d-8f2f-18ac3c2e8fbe';
const PARTNER = '9793d3cd-35cb-445c-a839-c2695244db0b'; // Juan Perez
const BANK = '63f3b949-5107-4b81-b903-da1766be23ae'; // Banco Santander
const CASH = '4b18f419-55f8-4d0c-9e9f-333bbb2aa354'; // Caja Principal
const MARK = 'TSK735-demo';

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};
const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -qtAc "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  }).trim();
const acc = (code) => psql(`select id from accounts where company_id='${C}' and code='${code}'`);
const indent = (t) => t.split('\n').map((l) => '     ' + l).join('\n');
const entryLines = (entryId) =>
  psql(
    `select a.code || ' ' || a.name || '  D ' || l.debit || '  H ' || l.credit from journal_entry_lines l join accounts a on a.id=l.account_id where l.entry_id='${entryId}' order by l.debit desc, a.code`
  );

// --- Siembra ---
const ensureAccount = (code, name, type, nature, parentCode) => {
  if (acc(code)) return;
  psql(
    `insert into accounts (company_id, code, name, type, nature, parent_id, is_leaf, updated_at) values ('${C}','${code}','${name}','${type}','${nature}','${acc(parentCode)}',true,now())`
  );
};
const ACCOUNTS = {
  rejected: ['1.1.3/01/03', 'Cheques rechazados', 'ASSET', 'DEBIT', '1.1.3/01/00'],
  payableChecks: ['2.1.1/03/01', 'Valores diferidos a pagar', 'LIABILITY', 'CREDIT', '2.1.1/00/00'],
  cards: ['2.1.1/03/02', 'Tarjetas de crédito a pagar', 'LIABILITY', 'CREDIT', '2.1.1/00/00'],
  partners: ['2.1.5/03/01', 'Deudas con socios', 'LIABILITY', 'CREDIT', '2.1.5/00/00'],
};
const SETTINGS_COLS = {
  checks_received_account_id: '1.1.1/01/06',
  checks_rejected_account_id: ACCOUNTS.rejected[0],
  checks_payable_account_id: ACCOUNTS.payableChecks[0],
  credit_cards_payable_account_id: ACCOUNTS.cards[0],
  partner_debts_account_id: ACCOUNTS.partners[0],
};
const setSettings = (filled) =>
  psql(
    `update accounting_settings set ${Object.entries(SETTINGS_COLS)
      .map(([col, code]) => `${col}=${filled ? `'${acc(code)}'` : 'NULL'}`)
      .join(', ')} where company_id='${C}'`
  );

const seed = () => {
  for (const a of Object.values(ACCOUNTS)) ensureAccount(...a);
  if (psql(`select count(*) from receipts where company_id='${C}' and notes='${MARK}'`) === '0') {
    const rec = psql(
      `insert into receipts (company_id, customer_id, number, full_number, date, total_amount, notes, status, created_by, updated_at) values ('${C}','${CUSTOMER}',2,'R-00002',now(),49005,'${MARK}','DRAFT','${USER_ID}',now()) returning id`
    ).split('\n')[0];
    psql(`insert into receipt_items (receipt_id, invoice_id, amount) values ('${rec}','${SALE_INV}',49005)`);
    psql(
      `insert into receipt_payments (receipt_id, payment_method, amount, check_number, check_bank_name, check_issue_date, check_due_date, check_drawer_name) values ('${rec}','CHECK',30000,'48210','Banco Galicia',now(),now() + interval '20 days','Cliente Demo SA')`
    );
    psql(`insert into receipt_payments (receipt_id, payment_method, amount, cash_register_id) values ('${rec}','CASH',19005,'${CASH}')`);
  }
  const op = (n, invoice, amount) => {
    const id = psql(
      `insert into payment_orders (company_id, supplier_id, number, full_number, date, total_amount, notes, status, created_by, updated_at) values ('${C}','${SUPPLIER}',${n},'OP-000${n}',now(),${amount},'${MARK}','DRAFT','${USER_ID}',now()) returning id`
    ).split('\n')[0];
    psql(`insert into payment_order_items (payment_order_id, invoice_id, amount) values ('${id}','${invoice}',${amount})`);
    return id;
  };
  if (psql(`select count(*) from payment_orders where company_id='${C}' and full_number='OP-00016'`) === '0') {
    const op16 = op(16, PURCH_A, 200000);
    psql(
      `insert into payment_order_payments (payment_order_id, payment_method, amount, check_number, check_bank_name, check_issue_date, check_due_date, check_drawer_name) values ('${op16}','CHECK',200000,'T735-0001','Banco Santander',now(),now() + interval '30 days','Empresa de Prueba 01 SA')`
    );
  }
  if (psql(`select count(*) from payment_orders where company_id='${C}' and full_number='OP-00017'`) === '0') {
    let card = psql(`select id from cards where company_id='${C}' and name='Visa débito Juan Perez'`);
    if (!card) {
      card = psql(
        `insert into cards (company_id, name, card_type, owner_type, partner_id, brand, last_four, created_by, updated_at) values ('${C}','Visa débito Juan Perez','DEBIT','PARTNER','${PARTNER}','Visa','4242','${USER_ID}',now()) returning id`
      ).split('\n')[0];
    }
    const op17 = op(17, PURCH_B, 25000);
    psql(
      `insert into payment_order_payments (payment_order_id, payment_method, amount, card_id, card_last4) values ('${op17}','DEBIT_CARD',25000,'${card}','4242')`
    );
  }
};

// --- Navegador ---
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const context = await browser.newContext({
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const hide = async () => {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});
  // El widget de soporte (elementos fijos a la derecha) tapa las capturas.
  await page.evaluate(() => {
    for (const el of document.body.querySelectorAll('*')) {
      // Los menús y diálogos de Radix también son fixed: no se ocultan.
      if (el.closest('[data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [role="alertdialog"], [data-sonner-toaster]')) continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.position === 'fixed' && rect.left > window.innerWidth - 200 && rect.width < 200) {
        el.style.visibility = 'hidden';
      }
    }
  });
};
const shot = async (name, target, opts = {}) => {
  await page.waitForTimeout(700);
  await hide();
  await (target ?? page).screenshot({ path: `${OUT}/tsk735-${name}.png`, ...opts });
  console.log(`  → tsk735-${name}.png`);
};
const toastTexts = async () => {
  await page.waitForSelector('[data-sonner-toast]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  return page.locator('[data-sonner-toast]').allInnerTexts();
};

const login = async () => {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });
  await page.waitForTimeout(2000);
};

const openRowMenu = async (listPath, text) => {
  await page.goto(`${BASE}${listPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000); // hidratación: antes el menú no abre
  const row = page.locator('table tbody tr').filter({ hasText: text }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.locator('button').last().click();
  await page.waitForTimeout(900);
};

/** Abre el diálogo de confirmar de un RC/OP y espera la vista previa del asiento. */
const openConfirm = async (listPath, fullNumber, menuItem) => {
  await openRowMenu(listPath, fullNumber);
  await page.getByRole('menuitem', { name: menuItem }).click();
  const dlg = page.getByRole('alertdialog');
  await dlg.waitFor({ state: 'visible', timeout: 10000 });
  await dlg.getByText('Verificando cuentas contables').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  return dlg;
};

const confirmFlow = async ({ list, number, menu, shotPreview, status }) => {
  if (status() === 'CONFIRMED') {
    console.log(`  ${number} ya estaba confirmado`);
    return;
  }
  const dlg = await openConfirm(list, number, menu);
  console.log(indent((await dlg.innerText()).split('\n').filter(Boolean).join('\n')));
  const disabled = await dlg.getByRole('button', { name: 'Confirmar', exact: true }).isDisabled();
  check(!disabled, `${number}: el botón Confirmar está habilitado (sin cuentas faltantes)`);
  if (shotPreview) await shot(shotPreview, dlg);
  await dlg.getByRole('button', { name: 'Confirmar', exact: true }).click();
  console.log('  toasts:', JSON.stringify(await toastTexts()));
  await page.waitForTimeout(800);
  check(status() === 'CONFIRMED', `${number} quedó confirmado`);
};

/** Captura el asiento de un comprobante en Contabilidad → Asientos. */
const shotEntry = async (name, entryId, expectedMin = 2) => {
  const desc = psql(`select description from journal_entries where id='${entryId}'`);
  console.log(`  asiento "${desc}":\n` + indent(entryLines(entryId)));
  check(Number(psql(`select count(*) from journal_entry_lines where entry_id='${entryId}'`)) >= expectedMin, 'el asiento tiene líneas');
  await page.goto(`${BASE}/dashboard/company/accounting/entries`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const row = page.locator('table tbody tr').filter({ hasText: desc }).first();
  if (!(await row.count())) {
    check(false, `no se encontró "${desc}" en el listado de asientos`);
    return;
  }
  await row.scrollIntoViewIfNeeded();
  await row.locator('button').first().click();
  await page.waitForTimeout(900);
  await row.scrollIntoViewIfNeeded();
  await hide();
  const box = await row.boundingBox();
  const top = Math.max(box.y - 40, 0);
  await shot(name, null, { clip: { x: Math.max(box.x - 8, 0), y: top, width: box.width + 16, height: Math.min(380, 1000 - top) } });
};

const docStatus = (table, number) => () =>
  psql(`select status from ${table} where company_id='${C}' and full_number='${number}'`);

try {
  seed();
  await login();

  // 1. Configuración
  console.log('1. Configuración → Cheques y tarjetas...');
  const section = async () => {
    await page.goto(`${BASE}/dashboard/company/accounting/settings`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const h = page.getByText('Cheques y tarjetas', { exact: true }).first();
    await h.waitFor({ timeout: 30000 });
    await h.scrollIntoViewIfNeeded();
    return h.locator('xpath=../..');
  };
  setSettings(false);
  await shot('00-config-vacia', await section());
  setSettings(true);
  const filled = await section();
  await shot('01-config-cheques-tarjetas', filled);
  const sectionText = await filled.innerText();
  for (const label of ['Valores a depositar', 'Cheques rechazados', 'Valores diferidos a pagar', 'Tarjetas de crédito a pagar', 'Deudas con socios']) {
    check(sectionText.includes(label), `la sección muestra "${label}"`);
  }

  // 2. Recibo con cheque
  console.log('2. R-00002 (cheque de terceros + efectivo)...');
  await confirmFlow({ list: '/dashboard/commercial/treasury/receipts', number: 'R-00002', menu: /Confirmar Recibo/, shotPreview: '02-recibo-confirmar', status: docStatus('receipts', 'R-00002') });
  const rcEntry = psql(`select journal_entry_id from receipts where company_id='${C}' and full_number='R-00002'`);
  await shotEntry('03-recibo-asiento', rcEntry, 3);
  console.log('  cheque:', psql(`select check_number, status, account_id is not null from checks where company_id='${C}' and check_number='48210'`));

  // 3. OP con cheque propio
  console.log('3. OP-00016 (cheque propio)...');
  await confirmFlow({ list: '/dashboard/commercial/treasury/payment-orders', number: 'OP-00016', menu: /Confirmar Orden/, shotPreview: '04-op-cheque-confirmar', status: docStatus('payment_orders', 'OP-00016') });
  await shotEntry('05-op-cheque-asiento', psql(`select journal_entry_id from payment_orders where company_id='${C}' and full_number='OP-00016'`));

  // 4. Debitar
  console.log('4. Debitar el cheque propio T735-0001...');
  if (psql(`select status from checks where company_id='${C}' and check_number='T735-0001'`) !== 'CASHED') {
    await openRowMenu('/dashboard/commercial/treasury/checks', 'T735-0001');
    const menuBox = await page.getByRole('menu').boundingBox();
    const rowBox = await page.locator('table tbody tr').filter({ hasText: 'T735-0001' }).first().boundingBox();
    await shot('06-cheques-menu-debitar', null, {
      clip: { x: 272, y: Math.max(rowBox.y - 60, 0), width: 1160, height: menuBox.y + menuBox.height - rowBox.y + 80 },
    });
    await page.getByRole('menuitem', { name: 'Debitar' }).click();
    const modal = page.getByRole('dialog');
    await modal.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(800);
    await modal.getByRole('combobox').first().click();
    await page.getByRole('option').filter({ hasText: 'Banco Santander' }).first().click();
    await page.waitForTimeout(400);
    await shot('07-debitar-modal', modal);
    await modal.getByRole('button', { name: 'Debitar', exact: true }).click();
    console.log('  toasts:', JSON.stringify(await toastTexts()));
    await page.waitForTimeout(800);
  }
  check(psql(`select status from checks where company_id='${C}' and check_number='T735-0001'`) === 'CASHED', 'el cheque pasó a Cobrado');
  const debitEntry = psql(`select debit_entry_id from checks where company_id='${C}' and check_number='T735-0001'`);
  check(Boolean(debitEntry), 'el cheque guardó el asiento del débito');
  if (debitEntry) await shotEntry('08-debitar-asiento', debitEntry);

  // 5. Tarjeta del socio y devolución
  console.log('5. OP-00017 (tarjeta de débito del socio)...');
  await confirmFlow({ list: '/dashboard/commercial/treasury/payment-orders', number: 'OP-00017', menu: /Confirmar Orden/, shotPreview: '09-op-tarjeta-socio-confirmar', status: docStatus('payment_orders', 'OP-00017') });
  await shotEntry('10-op-tarjeta-socio-asiento', psql(`select journal_entry_id from payment_orders where company_id='${C}' and full_number='OP-00017'`));
  if (psql(`select count(*) from payment_orders where company_id='${C}' and full_number='OP-00018'`) === '0') {
    const op18 = psql(
      `insert into payment_orders (company_id, partner_id, number, full_number, date, total_amount, notes, status, created_by, updated_at) values ('${C}','${PARTNER}',18,'OP-00018',now(),25000,'${MARK}','DRAFT','${USER_ID}',now()) returning id`
    ).split('\n')[0];
    psql(`insert into payment_order_payments (payment_order_id, payment_method, amount, cash_register_id) values ('${op18}','CASH',25000,'${CASH}')`);
    psql(
      `update payment_order_installments set settled_by_payment_order_id='${op18}' where company_id='${C}' and partner_id='${PARTNER}' and status='PENDING' and payment_order_id=(select id from payment_orders where company_id='${C}' and full_number='OP-00017')`
    );
  }
  console.log('6. OP-00018 (devolución al socio)...');
  await confirmFlow({ list: '/dashboard/commercial/treasury/payment-orders', number: 'OP-00018', menu: /Confirmar Orden/, shotPreview: '11-devolucion-confirmar', status: docStatus('payment_orders', 'OP-00018') });
  await shotEntry('12-devolucion-asiento', psql(`select journal_entry_id from payment_orders where company_id='${C}' and full_number='OP-00018'`));
} catch (error) {
  failures++;
  console.error(error);
  await page.screenshot({ path: `${OUT}/tsk735-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
