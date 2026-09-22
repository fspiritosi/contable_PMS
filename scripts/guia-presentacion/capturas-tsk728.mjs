/**
 * Capturas y verificación en navegador del TSK-728 (recibos, órdenes de pago y
 * gastos ya no se confirman sin asiento en silencio).
 *
 * Recorre, sobre la Empresa de Prueba 01 SA:
 *   01 OP bloqueada por Ajustes ("Cuentas por Pagar" vacía)     → notice rojo, botón deshabilitado
 *   02 OP bloqueada por banco sin cuenta contable                → notice rojo que nombra el banco
 *   03 OP OK (transferencia)                                     → notice neutro con las cuentas
 *   04 asiento de la OP en Contabilidad → Asientos               (+ SQL de las líneas)
 *   05 OP mixta transferencia + cheque propio                    → notice ámbar (aviso del cheque)
 *   06 toast "se confirmó con avisos contables"                  (+ SQL: Pagar por total − cheque)
 *   07 OP solo con cheque propio                                 → notice rojo "una sola línea"
 *   08 Recibo OK (efectivo en caja con cuenta)                   → notice neutro + confirmación
 *   09 Recibo bloqueado ("Cuentas por Cobrar" vacía)             → notice rojo
 *   10 Egreso sin "Cuenta de Gastos Operativos"                  → toast rojo con el label
 *   11 Egreso con la cuenta                                      → toast verde + asiento
 *   12 Modal de nueva OP: Efectivo sin caja                      → "Debe seleccionar la caja" (Zod)
 *   13-15 (modo --prod) egreso sin cuenta y OP bloqueada/confirmada contra el build de producción
 *
 * Uso:
 *   node scripts/guia-presentacion/capturas-tsk728.mjs [baseUrl]          # recorrido completo (dev :3010)
 *   node scripts/guia-presentacion/capturas-tsk728.mjs [baseUrl] --prod   # solo 13-15 (build de prod :3011)
 *   node scripts/guia-presentacion/capturas-tsk728.mjs [baseUrl] --solo-zod # solo 12 (modal de nueva OP)
 *   node scripts/guia-presentacion/capturas-tsk728.mjs [baseUrl] --solo-egreso # solo 10-11 (retoma con GTO-00003)
 *   node scripts/guia-presentacion/capturas-tsk728.mjs --restore          # solo restaura Ajustes/banco
 *
 * Requiere el servidor corriendo y la base de dev. Siembra por SQL (si no existen)
 * una caja "Caja Principal" con sesión abierta, un cliente con una factura de
 * venta confirmada, una categoría de egreso, cuatro OP, un recibo y dos egresos en
 * borrador (marcados con notes = 'TSK728-demo'); si ya existen de una corrida
 * anterior se borran con sus asientos/movimientos. Cambia temporalmente los
 * Ajustes contables (Cuentas por Pagar/Cobrar, Cuenta de Gastos Operativos) y la
 * cuenta contable del banco; todo se restaura al terminar (también ante error).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const RESTORE_ONLY = args.includes('--restore');
const SOLO_ZOD = args.includes('--solo-zod'); // solo el caso 12, sin sembrar ni tocar Ajustes
const SOLO_EGRESO = args.includes('--solo-egreso'); // solo 10 y 11 sobre un GTO-00003 nuevo
const BASE = args.find((a) => !a.startsWith('--')) ?? (PROD ? 'http://localhost:3011' : 'http://localhost:3010');
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY_ID = '02885d43-1358-4eb2-b774-c52d5be372f3';
const USER_ID = '848d69ff-198d-4588-975e-d3691ea2333f';
const SUPPLIER_ID = '398ae92a-c27c-425f-8367-3141a9a3f3d6'; // Distribuidora de Combustibles SRL
const BANK_ID = '63f3b949-5107-4b81-b903-da1766be23ae'; // Banco Santander 1085628-1
const PURCHASE_A = 'fe896679-d4ef-4cc3-852e-07b0eceead5b'; // 0001-97379998 CONFIRMED
const PURCHASE_B = 'fd17aee8-5920-45f9-bb65-bd62c0e8d0ca'; // 0001-97643935 CONFIRMED
const MARK = 'TSK728-demo';

mkdirSync(OUT, { recursive: true });

const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -qtAc "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  }).trim();

const acc = (code) => psql(`select id from accounts where company_id='${COMPANY_ID}' and code='${code}' limit 1`);
const settingsRow = () =>
  psql(
    `select coalesce(receivables_account_id::text,'NULL'), coalesce(payables_account_id::text,'NULL'), coalesce(expenses_account_id::text,'NULL'), coalesce(default_cash_account_id::text,'NULL'), coalesce(default_bank_account_id::text,'NULL') from accounting_settings where company_id='${COMPANY_ID}'`
  ).split('|');
const bankAccountId = () => psql(`select coalesce(account_id::text,'NULL') from bank_accounts where id='${BANK_ID}'`);

const sqlVal = (v) => (v === 'NULL' ? 'NULL' : `'${v}'`);
const setSetting = (col, v) => psql(`update accounting_settings set ${col}=${sqlVal(v)} where company_id='${COMPANY_ID}'`);
const setBankAccount = (v) => psql(`update bank_accounts set account_id=${sqlVal(v)} where id='${BANK_ID}'`);

const entryLines = (descLike) =>
  psql(
    `select je.number, a.code, a.name, l.debit, l.credit from journal_entry_lines l join journal_entries je on je.id=l.entry_id join accounts a on a.id=l.account_id where je.company_id='${COMPANY_ID}' and je.description like '${descLike}' order by je.number, l.debit desc, a.code`
  );
const indent = (text) => text.split('\n').map((l) => '     ' + l).join('\n');

// --- Estado original de Ajustes/banco (se restaura siempre) ---
const ORIG = { settings: settingsRow(), bank: bankAccountId() };
const restoreAll = () => {
  const [rec, pay, exp, dcash, dbank] = ORIG.settings;
  setSetting('receivables_account_id', rec);
  setSetting('payables_account_id', pay);
  setSetting('expenses_account_id', exp);
  setSetting('default_cash_account_id', dcash);
  setSetting('default_bank_account_id', dbank);
  setBankAccount(ORIG.bank);
};
const printState = (label) => {
  console.log(`  [${label}] settings (cobrar|pagar|gastos|caja def|banco def): ${settingsRow().join(' | ')}`);
  console.log(`  [${label}] banco account_id: ${bankAccountId()}`);
};

if (RESTORE_ONLY) {
  restoreAll();
  printState('restore');
  process.exit(0);
}

// =====================================================================
// Siembra de datos (solo en modo dev; en --prod se reutilizan OP-00004 y GTO-00002)
// =====================================================================
/** Crea (o recrea, borrando su asiento) el egreso demo GTO-0000n en borrador. */
const seedExpense = (n, description, amount) => {
  const fullNumber = `GTO-${String(n).padStart(5, '0')}`;
  const prevEntry = psql(`select journal_entry_id from expenses where company_id='${COMPANY_ID}' and full_number='${fullNumber}' and journal_entry_id is not null`);
  psql(`delete from expenses where company_id='${COMPANY_ID}' and full_number='${fullNumber}'`);
  if (prevEntry) {
    psql(`delete from journal_entry_lines where entry_id='${prevEntry}'`);
    psql(`delete from journal_entries where id='${prevEntry}'`);
  }
  const catId = psql(`select id from expense_categories where company_id='${COMPANY_ID}' and name='Servicios generales'`);
  psql(
    `insert into expenses (number, full_number, description, amount, date, status, notes, category_id, supplier_id, company_id, created_by, updated_at) values (${n},'${fullNumber}','${description}',${amount},current_date,'DRAFT','${MARK}','${catId}','${SUPPLIER_ID}','${COMPANY_ID}','${USER_ID}',now())`
  );
};

const seed = () => {
  // Limpieza de una corrida anterior: asientos, movimientos, cheques y comprobantes demo
  const demoEntries = psql(
    `select string_agg(journal_entry_id::text, ',') from (select journal_entry_id from payment_orders where company_id='${COMPANY_ID}' and notes='${MARK}' union all select journal_entry_id from receipts where company_id='${COMPANY_ID}' and notes='${MARK}' union all select journal_entry_id from expenses where company_id='${COMPANY_ID}' and notes='${MARK}') t where journal_entry_id is not null`
  );
  psql(`update payment_orders set journal_entry_id=null where company_id='${COMPANY_ID}' and notes='${MARK}'`);
  psql(`update receipts set journal_entry_id=null where company_id='${COMPANY_ID}' and notes='${MARK}'`);
  psql(`update expenses set journal_entry_id=null where company_id='${COMPANY_ID}' and notes='${MARK}'`);
  if (demoEntries) {
    const ids = demoEntries.split(',').map((id) => `'${id}'`).join(',');
    psql(`delete from journal_entry_lines where entry_id in (${ids})`);
    psql(`delete from journal_entries where id in (${ids})`);
  }
  // Movimientos bancarios de OP/recibos demo: se devuelve el saldo y se borran
  psql(
    `update bank_accounts b set balance = balance + coalesce((select sum(case when m.type='WITHDRAWAL' then m.amount else -m.amount end) from bank_movements m where m.bank_account_id=b.id and (m.payment_order_id in (select id from payment_orders where notes='${MARK}') or m.receipt_id in (select id from receipts where notes='${MARK}'))),0) where b.id='${BANK_ID}'`
  );
  psql(
    `delete from bank_movements where payment_order_id in (select id from payment_orders where notes='${MARK}') or receipt_id in (select id from receipts where notes='${MARK}')`
  );
  psql(`delete from checks where payment_order_payment_id in (select p.id from payment_order_payments p join payment_orders o on o.id=p.payment_order_id where o.notes='${MARK}')`);
  psql(`delete from checks where receipt_payment_id in (select p.id from receipt_payments p join receipts r on r.id=p.receipt_id where r.notes='${MARK}')`);
  psql(
    `update cash_register_sessions s set expected_balance = expected_balance - coalesce((select sum(case when m.type='INCOME' then m.amount else -m.amount end) from cash_movements m where m.session_id=s.id and m.reference in (select full_number from payment_orders where notes='${MARK}' union select full_number from receipts where notes='${MARK}')),0) where s.company_id='${COMPANY_ID}'`
  );
  psql(`delete from cash_movements where company_id='${COMPANY_ID}' and reference in (select full_number from payment_orders where notes='${MARK}' union select full_number from receipts where notes='${MARK}')`);
  psql(`delete from payment_order_payments where payment_order_id in (select id from payment_orders where notes='${MARK}')`);
  psql(`delete from payment_order_items where payment_order_id in (select id from payment_orders where notes='${MARK}')`);
  psql(`delete from payment_orders where company_id='${COMPANY_ID}' and notes='${MARK}'`);
  psql(`delete from receipt_payments where receipt_id in (select id from receipts where notes='${MARK}')`);
  psql(`delete from receipt_items where receipt_id in (select id from receipts where notes='${MARK}')`);
  psql(`delete from receipts where company_id='${COMPANY_ID}' and notes='${MARK}'`);
  psql(`delete from expenses where company_id='${COMPANY_ID}' and notes='${MARK}'`);
  psql(`update purchase_invoices set status='CONFIRMED' where id in ('${PURCHASE_A}','${PURCHASE_B}')`);

  // Caja con cuenta contable y sesión abierta
  let cashId = psql(`select id from cash_registers where company_id='${COMPANY_ID}' and code='CAJA-01'`);
  if (!cashId) {
    cashId = psql(
      `insert into cash_registers (code, name, location, status, is_default, company_id, updated_at, created_by, account_id) values ('CAJA-01','Caja Principal','Casa Central','ACTIVE',true,'${COMPANY_ID}',now(),'${USER_ID}','${acc('1.1.1/01/01')}') returning id`
    );
  }
  psql(`update cash_registers set account_id='${acc('1.1.1/01/01')}' where id='${cashId}'`);
  const openSession = psql(`select id from cash_register_sessions where cash_register_id='${cashId}' and status='OPEN'`);
  if (!openSession) {
    psql(
      `insert into cash_register_sessions (session_number, opening_balance, expected_balance, cash_register_id, company_id, opened_by, updated_at) values ((select coalesce(max(session_number),0)+1 from cash_register_sessions where cash_register_id='${cashId}'), 100000, 100000, '${cashId}', '${COMPANY_ID}', '${USER_ID}', now())`
    );
  }

  // Categoría de egreso
  let catId = psql(`select id from expense_categories where company_id='${COMPANY_ID}' and name='Servicios generales'`);
  if (!catId) {
    catId = psql(`insert into expense_categories (name, description, company_id, updated_at) values ('Servicios generales','Limpieza, mantenimiento y servicios varios','${COMPANY_ID}',now()) returning id`);
  }

  // Cliente + punto de venta + factura de venta confirmada (para el recibo)
  let customerId = psql(`select id from contractors where company_id='${COMPANY_ID}' and name='Cliente Demo SA'`);
  if (!customerId) {
    customerId = psql(
      `insert into contractors (name, tax_id, email, company_id, updated_at, tax_condition) values ('Cliente Demo SA','30-71234567-8','compras@clientedemo.com.ar','${COMPANY_ID}',now(),'RESPONSABLE_INSCRIPTO') returning id`
    );
  }
  let posId = psql(`select id from sales_points_of_sale where company_id='${COMPANY_ID}' and number=1`);
  if (!posId) {
    posId = psql(`insert into sales_points_of_sale (company_id, number, name, updated_at, created_by) values ('${COMPANY_ID}',1,'Casa Central',now(),'${USER_ID}') returning id`);
  }
  let saleId = psql(`select id from sales_invoices where company_id='${COMPANY_ID}' and full_number='0001-00000001'`);
  if (!saleId) {
    saleId = psql(
      `insert into sales_invoices (company_id, customer_id, point_of_sale_id, voucher_type, number, full_number, issue_date, due_date, subtotal, vat_amount, total, status, created_by, updated_at, total_before_discount, net_taxed) values ('${COMPANY_ID}','${customerId}','${posId}','FACTURA_A',1,'0001-00000001',now() - interval '10 days',now() + interval '20 days',50000,10500,60500,'CONFIRMED','${USER_ID}',now(),50000,50000) returning id`
    );
  }
  psql(`update sales_invoices set status='CONFIRMED' where id='${saleId}'`);

  // Órdenes de pago en borrador
  const op = (n, total, invoiceId) => {
    const id = psql(
      `insert into payment_orders (company_id, supplier_id, number, full_number, date, total_amount, notes, status, created_by, updated_at) values ('${COMPANY_ID}','${SUPPLIER_ID}',${n},'OP-${String(n).padStart(5, '0')}',now(),${total},'${MARK}','DRAFT','${USER_ID}',now()) returning id`
    );
    psql(`insert into payment_order_items (payment_order_id, invoice_id, amount) values ('${id}','${invoiceId}',${total})`);
    return id;
  };
  const op1 = op(1, 50000, PURCHASE_A);
  psql(`insert into payment_order_payments (payment_order_id, payment_method, amount, bank_account_id, reference) values ('${op1}','TRANSFER',50000,'${BANK_ID}','Transf. 778812')`);
  const op2 = op(2, 50000, PURCHASE_B);
  psql(`insert into payment_order_payments (payment_order_id, payment_method, amount, bank_account_id, reference) values ('${op2}','TRANSFER',30000,'${BANK_ID}','Transf. 778813')`);
  psql(
    `insert into payment_order_payments (payment_order_id, payment_method, amount, check_number, check_bank_name, check_issue_date, check_due_date, check_drawer_name) values ('${op2}','CHECK',20000,'10001','Banco Santander',now(),now() + interval '30 days','Empresa de Prueba 01 SA')`
  );
  const op3 = op(3, 10000, PURCHASE_B);
  psql(
    `insert into payment_order_payments (payment_order_id, payment_method, amount, check_number, check_bank_name, check_issue_date, check_due_date, check_drawer_name) values ('${op3}','CHECK',10000,'10002','Banco Santander',now(),now() + interval '30 days','Empresa de Prueba 01 SA')`
  );
  const op4 = op(4, 5000, PURCHASE_A);
  psql(`insert into payment_order_payments (payment_order_id, payment_method, amount, bank_account_id, reference) values ('${op4}','TRANSFER',5000,'${BANK_ID}','Transf. 778814')`);

  // Recibo en borrador: efectivo en caja
  const rec = psql(
    `insert into receipts (company_id, customer_id, number, full_number, date, total_amount, notes, status, created_by, updated_at) values ('${COMPANY_ID}','${customerId}',1,'R-00001',now(),20000,'${MARK}','DRAFT','${USER_ID}',now()) returning id`
  );
  psql(`insert into receipt_items (receipt_id, invoice_id, amount) values ('${rec}','${saleId}',20000)`);
  psql(`insert into receipt_payments (receipt_id, payment_method, amount, cash_register_id) values ('${rec}','CASH',20000,'${cashId}')`);

  // Egresos en borrador
  seedExpense(1, 'Servicio de limpieza de oficinas', 15000);
  seedExpense(2, 'Mantenimiento de aire acondicionado', 8500);
  console.log('Datos sembrados: caja CAJA-01 con sesión abierta, Cliente Demo SA + FA 0001-00000001, OP-00001..4, R-00001, GTO-00001/2');
};

// =====================================================================
// Navegador
// =====================================================================
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const hideNextBadge = () =>
  page
    .evaluate(() => {
      document
        .querySelectorAll('nextjs-portal, [data-next-badge-root], #next-logo, .tsqd-parent-container')
        .forEach((el) => el.remove());
    })
    .catch(() => {});

const shot = async (name, locator, opts = {}) => {
  await page.waitForTimeout(700);
  await hideNextBadge();
  await (locator ?? page).screenshot({ path: `${OUT}/tsk728-${name}.png`, ...opts });
  console.log(`  ✓ ${name}`);
};

const lastToast = async (ms = 4000) => {
  await page.waitForSelector('[data-sonner-toast]', { timeout: ms }).catch(() => {});
  const toasts = page.locator('[data-sonner-toast]');
  const n = await toasts.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = toasts.nth(i);
    out.push({
      type: await t.getAttribute('data-type').catch(() => null),
      text: (await t.innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
};
const printToasts = (toasts) => {
  if (!toasts.length) console.log('  toast: (sin toast)');
  for (const t of toasts) console.log(`  toast [${t.type}]: ${t.text}`);
};
const shotToasts = async (name) => {
  await page.waitForTimeout(400); // animación de entrada del toast (los de error duran 4 s)
  await hideNextBadge();
  const toaster = page.locator('[data-sonner-toaster]').first();
  // Con dos toasts (éxito + avisos) Sonner los apila: al pasar el mouse se expanden
  const firstToast = page.locator('[data-sonner-toast]').first();
  if (await firstToast.count()) await firstToast.hover().catch(() => {});
  await page.waitForTimeout(500);
  const boxes = [];
  const toasts = page.locator('[data-sonner-toast]');
  for (let i = 0; i < (await toasts.count()); i++) {
    const b = await toasts.nth(i).boundingBox();
    if (b) boxes.push(b);
  }
  if (!boxes.length) {
    await shot(name, toaster);
    return;
  }
  const x = Math.min(...boxes.map((b) => b.x)) - 12;
  const y = Math.min(...boxes.map((b) => b.y)) - 12;
  const r = Math.max(...boxes.map((b) => b.x + b.width)) + 12;
  const btm = Math.max(...boxes.map((b) => b.y + b.height)) + 12;
  await shot(name, null, { clip: { x: Math.max(x, 0), y: Math.max(y, 0), width: Math.min(r, 1500) - Math.max(x, 0), height: Math.min(btm, 950) - Math.max(y, 0) } });
};

const login = async () => {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  await page.waitForTimeout(2000);
};

/** Abre el diálogo de confirmar de un recibo/OP desde el menú de la fila y espera la vista previa. */
const openConfirmDialog = async (listPath, fullNumber, menuItem) => {
  await page.goto(`${BASE}${listPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const row = page.locator('table tbody tr').filter({ hasText: fullNumber }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.locator('button').last().click();
  await page.waitForTimeout(500);
  await page.getByRole('menuitem', { name: menuItem }).click();
  const dlg = page.getByRole('alertdialog');
  await dlg.waitFor({ state: 'visible', timeout: 10000 });
  await dlg.getByText('Verificando cuentas contables').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  return dlg;
};

const describeDialog = async (dlg) => {
  const text = (await dlg.innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
  const disabled = await dlg.getByRole('button', { name: 'Confirmar', exact: true }).isDisabled();
  console.log(indent(text.join('\n')));
  console.log(`  botón Confirmar deshabilitado: ${disabled}`);
  return { text, disabled };
};

const confirmDialog = async (dlg) => {
  await dlg.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.waitForSelector('[data-sonner-toast]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  const toasts = await lastToast();
  printToasts(toasts);
  return toasts;
};

const shotEntry = async (name, descriptionText) => {
  await page.goto(`${BASE}/dashboard/company/accounting/entries`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const entryRow = page.locator('table tbody tr').filter({ hasText: descriptionText }).first();
  if (!(await entryRow.count())) {
    console.log(`  ⚠ no se encontró la fila "${descriptionText}" en el listado de asientos`);
    return;
  }
  await entryRow.scrollIntoViewIfNeeded();
  await entryRow.locator('button').first().click(); // chevron: expande las líneas
  await page.waitForTimeout(900);
  await entryRow.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const rb = await entryRow.boundingBox();
  const top = Math.max(rb.y - 40, 0);
  await shot(name, null, { clip: { x: Math.max(rb.x - 8, 0), y: top, width: rb.width + 16, height: Math.min(420, 950 - top) } });
};

const OP_LIST = '/dashboard/commercial/treasury/payment-orders';
const REC_LIST = '/dashboard/commercial/treasury/receipts';
const EXP_LIST = '/dashboard/commercial/expenses';

const confirmExpense = async (fullNumber) => {
  await page.goto(`${BASE}${EXP_LIST}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const row = page.locator('table tbody tr').filter({ hasText: fullNumber }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.locator('button').last().click();
  await page.waitForTimeout(500);
  await page.getByRole('menuitem', { name: 'Confirmar', exact: true }).click();
  const dlg = page.getByRole('alertdialog');
  await dlg.waitFor({ state: 'visible', timeout: 10000 });
  await dlg.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.waitForSelector('[data-sonner-toast]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  const toasts = await lastToast();
  printToasts(toasts);
  return toasts;
};

const expenseState = (fullNumber) =>
  psql(`select status, journal_entry_id is not null as con_asiento from expenses where company_id='${COMPANY_ID}' and full_number='${fullNumber}'`);
const opState = (fullNumber) =>
  psql(`select status, journal_entry_id is not null as con_asiento from payment_orders where company_id='${COMPANY_ID}' and full_number='${fullNumber}'`);

// =====================================================================
// Modo --prod: 13-15 contra el build de producción
// =====================================================================
if (PROD) {
  try {
    await login();
    printState('inicio prod');

    console.log('13. Egreso GTO-00002 sin "Cuenta de Gastos Operativos" (prod)...');
    setSetting('expenses_account_id', 'NULL');
    const t13 = await confirmExpense('GTO-00002');
    await shotToasts('13-prod-egreso-sin-cuenta-toast');
    console.log('  estado:', expenseState('GTO-00002'));
    console.log(`  mensaje completo (no digest): ${t13.some((t) => /Cuenta de Gastos Operativos/.test(t.text))}`);

    console.log('14. OP-00004 bloqueada por Ajustes (prod)...');
    setSetting('payables_account_id', 'NULL');
    const dlg14 = await openConfirmDialog(OP_LIST, 'OP-00004', /Confirmar Orden/);
    await describeDialog(dlg14);
    await shot('14-prod-op-bloqueada-ajustes', dlg14);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    restoreAll();

    console.log('15. OP-00004 confirmada (prod)...');
    const dlg15 = await openConfirmDialog(OP_LIST, 'OP-00004', /Confirmar Orden/);
    await describeDialog(dlg15);
    await confirmDialog(dlg15);
    await shotToasts('15-prod-op-confirmada-toast');
    console.log('  estado:', opState('OP-00004'));
    console.log('  SQL asiento OP-00004:\n' + indent(entryLines('Orden de pago OP-00004%')));
  } finally {
    restoreAll();
    printState('final prod');
    await browser.close();
  }
  console.log('Listo (prod).');
  process.exit(0);
}

// =====================================================================
// Recorrido completo en dev
// =====================================================================
if (!SOLO_ZOD && !SOLO_EGRESO) seed();
printState('inicio');

try {
  await login();

  if (SOLO_EGRESO) {
    seedExpense(3, 'Servicio de limpieza de oficinas', 15000);
    console.log('10. GTO-00003 sin "Cuenta de Gastos Operativos"...');
    setSetting('expenses_account_id', 'NULL');
    await confirmExpense('GTO-00003');
    await shotToasts('10-egreso-sin-cuenta-toast');
    console.log('  estado:', expenseState('GTO-00003'));
    console.log('11. GTO-00003 con la cuenta configurada...');
    setSetting('expenses_account_id', acc('4.2.1/03/10'));
    await confirmExpense('GTO-00003');
    await shotToasts('11-egreso-ok-toast');
    console.log('  estado:', expenseState('GTO-00003'));
    console.log('  SQL asiento GTO-00003:\n' + indent(entryLines('Gasto GTO-00003%')));
    restoreAll();
  }

  if (!SOLO_ZOD && !SOLO_EGRESO) {
  // --- 1. OP bloqueada por Ajustes ---
  console.log('1. OP-00001 bloqueada por "Cuentas por Pagar" vacía...');
  setSetting('payables_account_id', 'NULL');
  const dlg1 = await openConfirmDialog(OP_LIST, 'OP-00001', /Confirmar Orden/);
  await describeDialog(dlg1);
  await shot('01-op-bloqueada-ajustes', dlg1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  restoreAll();

  // --- 2. OP bloqueada por banco sin cuenta ---
  console.log('2. OP-00001 bloqueada por banco sin cuenta contable (y sin Banco por Defecto)...');
  setBankAccount('NULL');
  setSetting('default_bank_account_id', 'NULL');
  const dlg2 = await openConfirmDialog(OP_LIST, 'OP-00001', /Confirmar Orden/);
  await describeDialog(dlg2);
  await shot('02-op-bloqueada-banco-sin-cuenta', dlg2);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  restoreAll();
  console.log('  estado OP-00001 tras los bloqueos:', opState('OP-00001'));

  // --- 3/4. OP OK ---
  console.log('3. OP-00001 OK (transferencia con banco con cuenta)...');
  const dlg3 = await openConfirmDialog(OP_LIST, 'OP-00001', /Confirmar Orden/);
  await describeDialog(dlg3);
  await shot('03-op-ok-cuentas', dlg3);
  await confirmDialog(dlg3);
  console.log('  estado:', opState('OP-00001'));
  console.log('  SQL asiento OP-00001:\n' + indent(entryLines('Orden de pago OP-00001%')));
  console.log('4. Asiento en Contabilidad → Asientos...');
  await shotEntry('04-op-asiento', 'Orden de pago OP-00001');

  // --- 5/6. OP mixta transferencia + cheque propio ---
  console.log('5. OP-00002 mixta (transferencia + cheque propio)...');
  const dlg5 = await openConfirmDialog(OP_LIST, 'OP-00002', /Confirmar Orden/);
  await describeDialog(dlg5);
  await shot('05-op-mixta-aviso-cheque', dlg5);
  await confirmDialog(dlg5);
  await shotToasts('06-op-mixta-toast-avisos');
  console.log('  estado:', opState('OP-00002'));
  console.log('  SQL asiento OP-00002:\n' + indent(entryLines('Orden de pago OP-00002%')));
  console.log('  cheque emitido:', psql(`select check_number, type, status, amount from checks where company_id='${COMPANY_ID}' and check_number='10001'`));

  // --- 7. OP solo con cheque ---
  console.log('7. OP-00003 solo con cheque propio (una sola línea)...');
  const dlg7 = await openConfirmDialog(OP_LIST, 'OP-00003', /Confirmar Orden/);
  await describeDialog(dlg7);
  await shot('07-op-solo-cheque-bloqueada', dlg7);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  console.log('  estado:', opState('OP-00003'));

  // --- 9. Recibo bloqueado (Cuentas por Cobrar vacía: estado original de la empresa) ---
  console.log('9. R-00001 bloqueado por "Cuentas por Cobrar" vacía...');
  setSetting('receivables_account_id', 'NULL');
  const dlg9 = await openConfirmDialog(REC_LIST, 'R-00001', /Confirmar Recibo/);
  await describeDialog(dlg9);
  await shot('09-recibo-bloqueado-ajustes', dlg9);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // --- 8. Recibo OK con caja ---
  console.log('8. R-00001 OK (efectivo en Caja Principal con cuenta)...');
  setSetting('receivables_account_id', acc('1.1.3/01/01'));
  const dlg8 = await openConfirmDialog(REC_LIST, 'R-00001', /Confirmar Recibo/);
  await describeDialog(dlg8);
  await shot('08-recibo-ok-cuentas', dlg8);
  await confirmDialog(dlg8);
  console.log('  estado:', psql(`select status, journal_entry_id is not null as con_asiento from receipts where company_id='${COMPANY_ID}' and full_number='R-00001'`));
  console.log('  factura de venta:', psql(`select full_number, status from sales_invoices where company_id='${COMPANY_ID}' and full_number='0001-00000001'`));
  console.log('  SQL asiento R-00001:\n' + indent(entryLines('Recibo de cobro R-00001%')));
  console.log('  caja (sesión):', psql(`select expected_balance from cash_register_sessions s join cash_registers c on c.id=s.cash_register_id where c.code='CAJA-01' and s.status='OPEN'`));
  restoreAll();

  // --- 10/11. Egreso sin cuenta / con cuenta ---
  console.log('10. GTO-00001 sin "Cuenta de Gastos Operativos"...');
  setSetting('expenses_account_id', 'NULL');
  await confirmExpense('GTO-00001');
  await shotToasts('10-egreso-sin-cuenta-toast');
  console.log('  estado:', expenseState('GTO-00001'));

  console.log('11. GTO-00001 con la cuenta configurada...');
  setSetting('expenses_account_id', acc('4.2.1/03/10'));
  await confirmExpense('GTO-00001');
  await shotToasts('11-egreso-ok-toast');
  console.log('  estado:', expenseState('GTO-00001'));
  console.log('  SQL asiento GTO-00001:\n' + indent(entryLines('Gasto GTO-00001%')));
  restoreAll();
  }

  // --- 12. Zod: nueva OP con Efectivo sin caja ---
  if (!SOLO_EGRESO) {
  console.log('12. Modal de nueva OP: Efectivo sin caja...');
  await page.goto(`${BASE}${OP_LIST}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: /Nueva Orden de Pago/ }).click();
  const modal = page.getByRole('dialog');
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(800);
  // El modal abre en la pestaña "Gastos" cuando no viene prellenado: pasar a "Facturas"
  await modal.getByRole('tab', { name: 'Facturas' }).click();
  await page.waitForTimeout(500);
  const supplierSelect = modal.getByRole('combobox').filter({ hasText: /Seleccionar proveedor/ }).first();
  await supplierSelect.waitFor({ state: 'visible', timeout: 10000 });
  await supplierSelect.click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name: /Distribuidora de Combustibles/ }).click();
  await page.waitForTimeout(2500);
  const invoiceSelect = modal.getByRole('combobox').filter({ hasText: /Agregar factura/ }).first();
  await invoiceSelect.waitFor({ state: 'visible', timeout: 15000 });
  await invoiceSelect.click();
  await page.waitForTimeout(400);
  await page.getByRole('option').first().click();
  await page.waitForTimeout(600);
  await modal.getByRole('button', { name: /Agregar/ }).first().click();
  await page.waitForTimeout(600);
  const methodSelect = modal.getByRole('combobox').filter({ hasText: /Transferencia/ }).first();
  await methodSelect.click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name: 'Efectivo', exact: true }).click();
  await page.waitForTimeout(500);
  await modal.getByRole('button', { name: /Resto/ }).first().click();
  await page.waitForTimeout(400);
  await modal.getByRole('button', { name: /Crear Orden de Pago/ }).click();
  await page.waitForTimeout(1200);
  const zodMsg = modal.getByText('Debe seleccionar la caja').first();
  const zodVisible = await zodMsg.isVisible().catch(() => false);
  console.log(`  mensaje "Debe seleccionar la caja" visible: ${zodVisible}`);
  if (zodVisible) {
    await zodMsg.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const card = zodMsg.locator('xpath=ancestor::div[contains(@class,"rounded-md") and contains(@class,"border")][1]');
    await shot('12-nueva-op-efectivo-sin-caja', (await card.count()) ? card : modal);
  } else {
    await shot('12-nueva-op-efectivo-sin-caja', modal);
  }
  console.log('  OP creadas por el modal (debe ser 0):', psql(`select count(*) from payment_orders where company_id='${COMPANY_ID}' and number>4`));
  await page.keyboard.press('Escape');
  }
} finally {
  restoreAll();
  printState('final');
  await browser.close();
}
console.log('Listo.');
