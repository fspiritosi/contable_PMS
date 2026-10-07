/**
 * Capturas y verificación en navegador del TSK-757 (cuenta contable por categoría de egreso).
 *
 * Recorre, sobre la Empresa de Prueba 01 SA:
 *   01 listado de Egresos con el botón "Categorías"
 *   02 modal "Categorías de egreso" con la columna de cuenta (dos con cuenta, una "Por defecto")
 *   03 edición de "Viáticos de obra" con el combo de cuentas abierto (búsqueda "viát")
 *   04 alta de egreso con categoría "Alquiler de oficina" y el aviso "Se imputa a: …"
 *   05 detalle del borrador "Alquiler de oficina octubre" → "(de la categoría)"
 *      05b detalle del borrador de viáticos → "(por defecto)"
 *   06 confirmación OK (toast) y 06b detalle del confirmado → "(del asiento N° …)"
 *   07 asiento en Contabilidad → Asientos con la cuenta de la categoría (+ SQL de las líneas)
 *      07b egreso de categoría sin cuenta confirmado → cuenta de egresos por defecto (+ SQL)
 *   08 confirmar "ABL octubre" con la cuenta de su categoría dada de baja → toast rojo, sigue en borrador
 *   09 Contabilidad → Configuración: "Cuenta de egresos por defecto" y su ayuda
 *   10 celular 375×812 (isMobile): modal de categorías; 10b con una fila en edición
 *
 * Chequeos: cada paso registra OK/FAIL y el script sale con código 1 si alguno falla.
 *
 * Nota sobre el celular: el listado de Egresos desborda a 375 px por la paginación compartida
 * del DataTable (`space-x-6`, sin wrap) — es previo a este ticket y su arreglo vive en el PR #33
 * (TSK-726, otra rama, aún sin mergear). Con `isMobile` ese desborde ensancha el layout viewport
 * y, con él, el diálogo. Por eso el "sin scroll horizontal" de la PÁGINA es informativo (warning),
 * y lo que sí se exige es que el contenido del modal de categorías no desborde por sí mismo
 * (`scrollWidth ≤ clientWidth` del diálogo y de cada fila, también con una fila en edición).
 *
 * Uso:
 *   node scripts/guia-presentacion/capturas-tsk757.mjs [baseUrl]   # recorrido completo (dev :3010)
 *   node scripts/guia-presentacion/capturas-tsk757.mjs --restore   # solo limpieza
 *
 * Siembra por SQL tres categorías de ejemplo, una cuenta raíz temporal inactiva y tres egresos en
 * borrador. Las capturas van a la clienta, así que la siembra NO lleva marcas visibles: todo se
 * inserta con IDs fijos (`SEED_IDS`, prefijo 00000757-…) y la limpieza borra solo esas filas (y los
 * asientos que generaron al confirmarse). Los textos que se ven son realistas (sin notas, cuenta
 * "4.2.1/07/90 - Tasas municipales (dada de baja)"). Si ya existe una categoría o una cuenta real con
 * el mismo nombre/código pero otro ID, se aborta sin tocar nada. Pone temporalmente una "Cuenta de
 * egresos por defecto" si la empresa no tiene. Todo se limpia y restaura al inicio y al final
 * (también ante error). Los datos de las fases 4-6 (GTO-00004/05, renombrados a "Factura de luz
 * septiembre" / "Artículos de librería") no se tocan.
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const RESTORE_ONLY = args.includes('--restore');
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY_ID = '02885d43-1358-4eb2-b774-c52d5be372f3';
const USER_ID = '848d69ff-198d-4588-975e-d3691ea2333f';
// IDs fijos de lo sembrado: es la única "marca", invisible en pantalla.
const SEED_IDS = {
  catRent: '00000757-0000-4000-8000-000000000001',
  catTax: '00000757-0000-4000-8000-000000000002',
  catTravel: '00000757-0000-4000-8000-000000000003',
  expRent: '00000757-0000-4000-8000-000000000011',
  expTax: '00000757-0000-4000-8000-000000000012',
  expTravel: '00000757-0000-4000-8000-000000000013',
  tempAccount: '00000757-0000-4000-8000-000000000021',
};
const SEED_CATEGORY_IDS = [SEED_IDS.catRent, SEED_IDS.catTax, SEED_IDS.catTravel];
const SEED_EXPENSE_IDS = [SEED_IDS.expRent, SEED_IDS.expTax, SEED_IDS.expTravel];
const TEMP_ACCOUNT_CODE = '4.2.1/07/90';
const TEMP_ACCOUNT_NAME = 'Tasas municipales (dada de baja)';
const DEMO_CATEGORIES = ['Alquiler de oficina', 'Tasas municipales', 'Viáticos de obra'];
const MOBILE_WIDTH = 375;
const EXP_LIST = '/dashboard/commercial/expenses';

mkdirSync(OUT, { recursive: true });
rmSync(`${OUT}/tsk757-error.png`, { force: true });

const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -qtAc "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  }).trim();
const q = (s) => `'${s.replace(/'/g, "''")}'`;

const accByCode = (code) => psql(`select id from accounts where company_id='${COMPANY_ID}' and code='${code}' limit 1`);
const accLabel = (id) => psql(`select code || ' - ' || name from accounts where id='${id}'`);
/** Cuenta EXPENSE imputable (hoja, activa) cuyo nombre matchea el primer patrón posible. */
const pickExpenseAccount = (patterns, excludeIds) => {
  const excl = excludeIds.filter(Boolean).map((id) => `'${id}'`).join(',');
  const base = `select id from accounts where company_id='${COMPANY_ID}' and type='EXPENSE' and is_leaf and is_active and parent_id is not null${excl ? ` and id not in (${excl})` : ''}`;
  // Los patrones van en orden de preferencia: gana el primero que encuentre una cuenta.
  for (const p of patterns) {
    const id = psql(`${base} and name ilike ${q(p)} order by code limit 1`);
    if (id) return id;
  }
  return psql(`${base} order by code limit 1`);
};

const expensesSetting = () =>
  psql(`select coalesce(expenses_account_id::text,'NULL') from accounting_settings where company_id='${COMPANY_ID}'`);
const setExpensesSetting = (v) =>
  psql(`update accounting_settings set expenses_account_id=${v === 'NULL' ? 'NULL' : `'${v}'`} where company_id='${COMPANY_ID}'`);
const ORIG_EXPENSES_ACCOUNT = expensesSetting();

const entryLines = (fullNumber) =>
  psql(
    `select je.number, a.code, a.name, l.debit, l.credit from journal_entry_lines l join journal_entries je on je.id=l.entry_id join accounts a on a.id=l.account_id where je.company_id='${COMPANY_ID}' and je.description like 'Gasto ${fullNumber}%' order by l.debit desc, a.code`
  );
const indent = (text) => text.split('\n').map((l) => '     ' + l).join('\n');

// =====================================================================
// Limpieza y siembra
// =====================================================================
const inList = (list) => list.map((id) => `'${id}'`).join(',');
const SEED_EXPENSES = `company_id='${COMPANY_ID}' and id in (${inList(SEED_EXPENSE_IDS)})`;
const SEED_CATEGORIES = `company_id='${COMPANY_ID}' and id in (${inList(SEED_CATEGORY_IDS)})`;
const SEED_ACCOUNT = `company_id='${COMPANY_ID}' and id='${SEED_IDS.tempAccount}'`;

const cleanup = () => {
  const entries = psql(
    `select string_agg(journal_entry_id::text, ',') from expenses where ${SEED_EXPENSES} and journal_entry_id is not null`
  );
  psql(`update expenses set journal_entry_id=null where ${SEED_EXPENSES}`);
  if (entries) {
    const ids = inList(entries.split(','));
    psql(`delete from journal_entry_lines where entry_id in (${ids})`);
    psql(`delete from journal_entries where id in (${ids})`);
  }
  psql(`delete from expenses where ${SEED_EXPENSES}`);
  psql(`delete from expense_categories where ${SEED_CATEGORIES}`);
  psql(`delete from accounts where ${SEED_ACCOUNT}`);
  setExpensesSetting(ORIG_EXPENSES_ACCOUNT);
  const counts = psql(
    `select (select count(*) from expenses where ${SEED_EXPENSES}) || '|' || (select count(*) from expense_categories where ${SEED_CATEGORIES}) || '|' || (select count(*) from accounts where ${SEED_ACCOUNT})`
  );
  console.log(`  limpieza (egresos|categorías|cuenta temporal): ${counts}; cuenta de egresos por defecto: ${expensesSetting()}`);
  return counts === '0|0|0';
};

const ids = {};

const seed = () => {
  cleanup();
  // Una categoría real con el mismo nombre (sin la marca) no se toca: se aborta.
  const clash = psql(
    `select string_agg(name, ', ') from expense_categories where company_id='${COMPANY_ID}' and name in (${DEMO_CATEGORIES.map(q).join(',')})`
  );
  if (clash) throw new Error(`Ya existen categorías reales con nombre de ejemplo: ${clash}. No se tocan.`);
  const codeClash = psql(`select name from accounts where company_id='${COMPANY_ID}' and code='${TEMP_ACCOUNT_CODE}'`);
  if (codeClash) throw new Error(`Ya existe una cuenta real con código ${TEMP_ACCOUNT_CODE} (${codeClash}). No se toca.`);

  // Cuenta de egresos por defecto: se respeta la de la empresa; si no tiene, una temporal.
  ids.defaultAccount =
    ORIG_EXPENSES_ACCOUNT !== 'NULL' ? ORIG_EXPENSES_ACCOUNT : accByCode('4.2.1/03/10') || pickExpenseAccount(['%gastos varios%'], []);
  setExpensesSetting(ids.defaultAccount);

  ids.rentAccount = pickExpenseAccount(['%alquiler%'], [ids.defaultAccount]);
  ids.taxAccount = pickExpenseAccount(['tasas', '%tasa%', '%impuesto%'], [ids.defaultAccount, ids.rentAccount]);
  ids.tempAccount = psql(
    `insert into accounts (id, company_id, code, name, type, nature, is_active, is_leaf, updated_at) values ('${SEED_IDS.tempAccount}','${COMPANY_ID}','${TEMP_ACCOUNT_CODE}',${q(TEMP_ACCOUNT_NAME)},'EXPENSE','DEBIT',false,true,now()) returning id`
  );

  const cat = (id, name, description, accountId) =>
    psql(
      `insert into expense_categories (id, name, description, company_id, account_id, updated_at) values ('${id}',${q(name)},${q(description)},'${COMPANY_ID}',${accountId ? `'${accountId}'` : 'NULL'},now()) returning id`
    );
  ids.catRent = cat(SEED_IDS.catRent, 'Alquiler de oficina', 'Alquiler mensual de la oficina central', ids.rentAccount);
  ids.catTax = cat(SEED_IDS.catTax, 'Tasas municipales', 'ABL y otras tasas del municipio', ids.taxAccount);
  ids.catTravel = cat(SEED_IDS.catTravel, 'Viáticos de obra', 'Comidas, traslados y alojamiento del personal en obra', null);

  const next = () => Number(psql(`select coalesce(max(number),0)+1 from expenses where company_id='${COMPANY_ID}'`));
  const expense = (id, description, amount, categoryId) => {
    const n = next();
    const fullNumber = `GTO-${String(n).padStart(5, '0')}`;
    psql(
      `insert into expenses (id, number, full_number, description, amount, date, status, notes, category_id, company_id, created_by, updated_at) values ('${id}',${n},'${fullNumber}',${q(description)},${amount},current_date,'DRAFT',NULL,'${categoryId}','${COMPANY_ID}','${USER_ID}',now())`
    );
    return fullNumber;
  };
  ids.expRent = expense(SEED_IDS.expRent, 'Alquiler de oficina octubre', 350000, ids.catRent);
  ids.expTax = expense(SEED_IDS.expTax, 'ABL octubre', 18500, ids.catTax);
  ids.expTravel = expense(SEED_IDS.expTravel, 'Viáticos obra Neuquén', 42300, ids.catTravel);

  console.log('Datos sembrados:');
  console.log(`  Alquiler de oficina → ${accLabel(ids.rentAccount)}`);
  console.log(`  Tasas municipales   → ${accLabel(ids.taxAccount)}`);
  console.log('  Viáticos de obra    → (por defecto)');
  console.log(`  Cuenta de egresos por defecto: ${accLabel(ids.defaultAccount)}${ORIG_EXPENSES_ACCOUNT === 'NULL' ? ' (temporal)' : ''}`);
  console.log(`  Egresos en borrador: ${ids.expRent} (alquiler), ${ids.expTax} (ABL), ${ids.expTravel} (viáticos)`);
};

if (RESTORE_ONLY) {
  cleanup();
  process.exit(0);
}

// =====================================================================
// Navegador
// =====================================================================
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const warn = (msg) => console.log(`  WARN ${msg}`);

const hideNextBadge = (page) =>
  page
    .evaluate(() => {
      document
        .querySelectorAll('nextjs-portal, [data-next-badge-root], #next-logo, .tsqd-parent-container')
        .forEach((el) => el.remove());
    })
    .catch(() => {});

const shot = async (page, name, locator, opts = {}) => {
  await page.waitForTimeout(600);
  await hideNextBadge(page);
  await (locator ?? page).screenshot({ path: `${OUT}/tsk757-${name}.png`, ...opts });
  console.log(`  ✓ ${name}`);
};

const readToasts = async (page, ms = 15000) => {
  await page.waitForSelector('[data-sonner-toast]', { timeout: ms }).catch(() => {});
  await page.waitForTimeout(500);
  const toasts = page.locator('[data-sonner-toast]');
  const out = [];
  for (let i = 0; i < (await toasts.count()); i++) {
    const t = toasts.nth(i);
    out.push({
      type: await t.getAttribute('data-type').catch(() => null),
      text: (await t.innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
    });
  }
  for (const t of out) console.log(`  toast [${t.type}]: ${t.text}`);
  if (!out.length) console.log('  toast: (sin toast)');
  return out;
};

const shotToast = async (page, name, width) => {
  const t = page.locator('[data-sonner-toast]').first();
  if (!(await t.count())) return shot(page, name);
  await t.hover().catch(() => {});
  await page.waitForTimeout(300);
  const b = await t.boundingBox();
  const x = Math.max(b.x - 12, 0);
  const y = Math.max(b.y - 12, 0);
  await shot(page, name, null, { clip: { x, y, width: Math.min(b.width + 24, width - x), height: b.height + 24 } });
};

const login = async (page) => {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 120000, waitUntil: 'commit' });
  await page.waitForTimeout(2000);
};

const gotoList = async (page) => {
  await page.goto(`${BASE}${EXP_LIST}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Categorías' }).waitFor({ timeout: 60000 });
  await page.locator('table tbody tr').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
};

const rowOf = (page, text) => page.locator('table tbody tr').filter({ hasText: text }).first();

/** Abre el menú de la fila y elige un ítem. Los ítems con permiso aparecen cuando
 * `usePermissions` termina de cargar: si todavía no están, se reintenta. */
const rowMenu = async (page, text, item) => {
  const row = rowOf(page, text);
  await row.waitFor({ state: 'visible', timeout: 20000 });
  let items = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    await row.getByRole('button', { name: 'Abrir menú' }).click();
    await page.getByRole('menu').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(300);
    items = (await page.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
    if (items.includes(item)) {
      await page.getByRole('menuitem', { name: item, exact: true }).click();
      return;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  }
  throw new Error(`El menú de ${text} no tiene "${item}": ${items.join(' | ')}`);
};

const openCategories = async (page) => {
  await page.getByRole('button', { name: 'Categorías' }).click();
  // El combo de cuentas también es role="dialog" (popover): se apunta al contenido del Dialog.
  const dlg = page.locator('[data-slot="dialog-content"]');
  await dlg.getByText('Categorías de egreso').waitFor({ timeout: 10000 });
  await dlg.locator('[data-testid="category-row"]').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  return dlg;
};

const categoryRow = (dlg, name) => dlg.locator('[data-testid="category-row"]').filter({ hasText: name }).first();
const categoryAccountText = async (dlg, name) =>
  (await categoryRow(dlg, name).locator('[data-testid="category-account"]').innerText()).trim();

const openDetail = async (page, fullNumber) => {
  await rowMenu(page, fullNumber, 'Ver Detalle');
  const dlg = page.getByRole('dialog');
  await dlg.getByText('Detalle de Egreso').waitFor({ timeout: 10000 });
  await dlg.locator('[data-testid="expense-debit-account"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  return dlg;
};
const debitAccountText = async (dlg) =>
  (await dlg.locator('[data-testid="expense-debit-account"]').innerText()).replace(/\s+/g, ' ').trim();

const closeDialog = async (page) => {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
};

const confirmFromList = async (page, fullNumber) => {
  await gotoList(page);
  await rowMenu(page, fullNumber, 'Confirmar');
  const alert = page.getByRole('alertdialog');
  await alert.waitFor({ state: 'visible', timeout: 10000 });
  await alert.getByRole('button', { name: 'Confirmar', exact: true }).click();
  return readToasts(page);
};

const expenseState = (fullNumber) =>
  psql(`select status || '|' || (journal_entry_id is not null) from expenses where company_id='${COMPANY_ID}' and full_number='${fullNumber}'`);
const entryNumber = (fullNumber) =>
  psql(`select je.number from expenses e join journal_entries je on je.id=e.journal_entry_id where e.company_id='${COMPANY_ID}' and e.full_number='${fullNumber}'`);

const shotEntry = async (page, name, fullNumber) => {
  await page.goto(`${BASE}/dashboard/company/accounting/entries`, { waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  const row = rowOf(page, `Gasto ${fullNumber}`);
  if (!(await row.count())) {
    check(`${name}: fila del asiento de ${fullNumber} en Contabilidad → Asientos`, false);
    return;
  }
  await row.scrollIntoViewIfNeeded();
  await row.locator('button').first().click(); // chevron: expande las líneas
  await page.waitForTimeout(900);
  await row.scrollIntoViewIfNeeded();
  const rb = await row.boundingBox();
  const top = Math.max(rb.y - 40, 0);
  await shot(page, name, null, { clip: { x: Math.max(rb.x - 8, 0), y: top, width: rb.width + 16, height: Math.min(260, 900 - top) } });
};

// --- Escritorio --------------------------------------------------------------
const desktopRun = async (page) => {
  console.log('\n== Escritorio 1440 ==');
  const rentLabel = accLabel(ids.rentAccount);
  const taxLabel = accLabel(ids.taxAccount);
  const defaultLabel = accLabel(ids.defaultAccount);

  console.log('01. Listado con el botón "Categorías"...');
  // A 1440 la tabla de Egresos ya es más ancha que el panel (previo a este ticket): la
  // captura del listado se toma a 1600 para que se vea la barra entera.
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoList(page);
  check('01 botón "Categorías" en la barra del listado', await page.getByRole('button', { name: 'Categorías' }).isVisible());
  const tableBox = await page.locator('table').first().boundingBox();
  await shot(page, '01-listado-boton-categorias', null, {
    clip: { x: 0, y: 0, width: 1600, height: Math.min(900, Math.round((tableBox?.y ?? 400) + 330)) },
  });
  // El modal de categorías se captura con un viewport alto para que entren todas las filas.
  await page.setViewportSize({ width: 1440, height: 1350 });
  await gotoList(page);

  console.log('02. Modal de categorías con la cuenta de cada una...');
  let dlg = await openCategories(page);
  const rentText = await categoryAccountText(dlg, 'Alquiler de oficina');
  const taxText = await categoryAccountText(dlg, 'Tasas municipales');
  const travelText = await categoryAccountText(dlg, 'Viáticos de obra');
  check('02 "Alquiler de oficina" muestra su cuenta', rentText === rentLabel, rentText);
  check('02 "Tasas municipales" muestra su cuenta', taxText === taxLabel, taxText);
  check('02 "Viáticos de obra" muestra "Por defecto"', travelText === 'Por defecto', travelText);
  await shot(page, '02-modal-categorias', dlg);

  console.log('03. Edición de "Viáticos de obra" con el combo abierto...');
  await categoryRow(dlg, 'Viáticos de obra').getByRole('button', { name: 'Editar Viáticos de obra' }).click();
  await page.waitForTimeout(500);
  const editRow = dlg.locator('[data-testid="category-row"]').filter({ has: page.getByRole('button', { name: 'Guardar' }) });
  const combo = editRow.getByRole('combobox');
  await combo.waitFor({ timeout: 10000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector('[data-testid="category-row"] button[role="combobox"]');
      return c && !c.hasAttribute('disabled');
    },
    { timeout: 15000 }
  );
  await combo.click();
  const search = page.getByPlaceholder('Buscar por código o nombre...');
  await search.waitFor({ timeout: 10000 });
  await search.fill('viát');
  await page.waitForTimeout(600);
  const options = await page.locator('[cmdk-item]').allInnerTexts();
  check('03 el combo encuentra cuentas de viáticos', options.some((o) => /Vi[aá]ticos/i.test(o)), options.join(' | '));
  const db = await dlg.boundingBox();
  await shot(page, '03-edicion-combo-cuenta', null, { clip: { x: db.x - 8, y: db.y - 8, width: db.width + 16, height: db.height + 16 } });
  await page.keyboard.press('Escape'); // cierra el combo
  await page.waitForTimeout(300);
  if (await editRow.count()) await editRow.getByRole('button', { name: 'Cancelar' }).click().catch(() => {});
  await closeDialog(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  console.log('04. Alta de egreso con "Alquiler de oficina" y el aviso "Se imputa a"...');
  await gotoList(page);
  await page.getByRole('button', { name: 'Nuevo Egreso' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByText('Nuevo Egreso').first().waitFor({ timeout: 10000 });
  await dlg.getByPlaceholder(/descripci/i).first().fill('Alquiler de oficina noviembre').catch(() => {});
  await dlg.getByRole('combobox').filter({ hasText: 'Seleccionar categoría' }).click();
  await page.getByRole('option', { name: 'Alquiler de oficina', exact: true }).click();
  const hint = dlg.locator('[data-testid="expense-account-hint"]');
  await hint.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const hintText = (await hint.innerText()).trim();
  check('04 aviso "Se imputa a" con la cuenta de la categoría', hintText === `Se imputa a: ${rentLabel}`, hintText);
  await hint.scrollIntoViewIfNeeded();
  await shot(page, '04-alta-aviso-se-imputa', dlg);
  await dlg.getByRole('combobox').filter({ hasText: 'Alquiler de oficina' }).click();
  await page.getByRole('option', { name: 'Viáticos de obra', exact: true }).click();
  await page.waitForTimeout(1200);
  const hintDefault = (await hint.innerText()).trim();
  check('04b aviso con la cuenta de egresos por defecto', hintDefault === `Se imputa a la cuenta de egresos por defecto: ${defaultLabel}`, hintDefault);
  await shot(page, '04b-alta-aviso-por-defecto', dlg);
  await closeDialog(page);
  check('04 el alta no creó egresos (se cerró sin guardar)',
    psql(`select count(*) from expenses where company_id='${COMPANY_ID}' and description like 'Alquiler de oficina noviembre%'`) === '0');

  console.log('05. Detalle de los borradores...');
  await gotoList(page);
  dlg = await openDetail(page, ids.expRent);
  let info = await debitAccountText(dlg);
  check('05 borrador con cuenta de la categoría', info.includes(rentLabel) && info.includes('(de la categoría)'), info);
  await shot(page, '05-detalle-borrador-de-la-categoria', dlg);
  await closeDialog(page);
  dlg = await openDetail(page, ids.expTravel);
  info = await debitAccountText(dlg);
  check('05b borrador de categoría sin cuenta → por defecto', info.includes(defaultLabel) && info.includes('(por defecto)'), info);
  await shot(page, '05b-detalle-borrador-por-defecto', dlg);
  await closeDialog(page);

  console.log(`06. Confirmar ${ids.expRent} (Alquiler de oficina)...`);
  let toasts = await confirmFromList(page, ids.expRent);
  check('06 toast de éxito', toasts.some((t) => t.type === 'success'), toasts.map((t) => t.text).join(' / '));
  await shotToast(page, '06-confirmado-toast', 1440);
  check('06 egreso CONFIRMED con asiento', expenseState(ids.expRent) === 'CONFIRMED|true', expenseState(ids.expRent));
  const rentLines = entryLines(ids.expRent);
  console.log('  SQL asiento:\n' + indent(rentLines));
  const rentCode = rentLabel.split(' - ')[0];
  check('06 el Debe del asiento va a la cuenta de la categoría', rentLines.split('\n')[0]?.split('|')[1] === rentCode, rentLines.split('\n')[0]);
  await page.waitForTimeout(4500); // que se vaya el toast
  dlg = await openDetail(page, ids.expRent);
  info = await debitAccountText(dlg);
  const rentEntry = entryNumber(ids.expRent);
  check('06b detalle del confirmado → cuenta del asiento', info.includes(rentLabel) && info.includes(`del asiento N° ${rentEntry}`), info);
  await shot(page, '06b-detalle-confirmado-del-asiento', dlg);
  await closeDialog(page);

  console.log('07. Asiento en Contabilidad → Asientos...');
  await shotEntry(page, '07-asiento-cuenta-categoria', ids.expRent);

  console.log(`07b. Confirmar ${ids.expTravel} (Viáticos de obra, sin cuenta)...`);
  toasts = await confirmFromList(page, ids.expTravel);
  check('07b toast de éxito', toasts.some((t) => t.type === 'success'), toasts.map((t) => t.text).join(' / '));
  const travelLines = entryLines(ids.expTravel);
  console.log('  SQL asiento:\n' + indent(travelLines));
  check('07b el Debe va a la cuenta de egresos por defecto', travelLines.split('\n')[0]?.split('|')[1] === defaultLabel.split(' - ')[0], travelLines.split('\n')[0]);
  await page.waitForTimeout(4500);
  await shotEntry(page, '07b-asiento-por-defecto', ids.expTravel);

  console.log(`08. Confirmar ${ids.expTax} con la cuenta de "Tasas municipales" dada de baja...`);
  psql(`update expense_categories set account_id='${ids.tempAccount}' where id='${ids.catTax}'`);
  toasts = await confirmFromList(page, ids.expTax);
  const err = toasts.find((t) => t.type === 'error');
  check('08 toast de error legible (categoría y cuenta)',
    err && err.text.includes('Tasas municipales') && err.text.includes(TEMP_ACCOUNT_CODE) && /no está activa/.test(err.text), err?.text ?? '(sin toast de error)');
  await shotToast(page, '08-error-cuenta-inactiva-toast', 1440);
  check('08 el egreso sigue en borrador y sin asiento', expenseState(ids.expTax) === 'DRAFT|false', expenseState(ids.expTax));
  psql(`update expense_categories set account_id='${ids.taxAccount}' where id='${ids.catTax}'`);

  console.log('09. Contabilidad → Configuración: "Cuenta de egresos por defecto"...');
  await page.goto(`${BASE}/dashboard/company/accounting/settings`, { waitUntil: 'domcontentloaded' });
  const label = page.getByText('Cuenta de egresos por defecto', { exact: true }).first();
  await label.waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  const helpOk = await page.getByText(/Se usa al confirmar egresos cuya categoría no tiene cuenta contable propia/).first().isVisible();
  check('09 label "Cuenta de egresos por defecto" con su ayuda', helpOk);
  check('09 sin el label viejo "Cuenta de Gastos Operativos"', (await page.getByText('Cuenta de Gastos Operativos').count()) === 0);
  // Recorte de la sección "Cuentas de Resultado" (de su título al de la sección siguiente).
  const from = page.getByText('Cuentas de Resultado', { exact: true }).first();
  const to = page.getByText('Cuentas de Crédito y Deuda', { exact: true }).first();
  await from.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const fb = await from.boundingBox();
  const tb = await to.boundingBox();
  const cardBox = await from.locator('xpath=ancestor::div[contains(@class,"rounded")][1]').boundingBox().catch(() => null);
  const x = Math.max((cardBox?.x ?? fb.x - 16), 0);
  const width = cardBox?.width ?? 900;
  await shot(page, '09-ajustes-cuenta-egresos-por-defecto', null, {
    clip: { x, y: Math.max(fb.y - 12, 0), width, height: Math.min(tb.y - fb.y + 4, 900 - fb.y) },
  });
};

// --- Celular -----------------------------------------------------------------
const mobileRun = async (page) => {
  console.log('\n== Celular 375×812 (isMobile) ==');
  await gotoList(page);
  const pageM = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (pageM.scrollWidth > MOBILE_WIDTH) {
    warn(`listado: scrollWidth ${pageM.scrollWidth} > ${MOBILE_WIDTH} (preexistente: paginación del DataTable, arreglo en PR #33). Informativo.`);
  } else {
    console.log(`  info listado: scrollWidth ${pageM.scrollWidth} (sin scroll horizontal)`);
  }

  const dlg = await openCategories(page);
  const measure = async (scenario) => {
    const m = await page.evaluate(() => {
      const d = document.querySelector('[data-slot="dialog-content"]');
      const rows = [...(d?.querySelectorAll('[data-testid="category-row"]') ?? [])];
      const r = d?.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        dialogX: r ? Math.round(r.x) : null,
        dialogWidth: r ? Math.round(r.width) : null,
        dialogOverflow: d ? d.scrollWidth - d.clientWidth : null,
        rowsOverflow: rows.map((row) => row.scrollWidth - row.clientWidth).filter((o) => o > 0).length,
        rows: rows.length,
      };
    });
    console.log(`  medición ${scenario}: ${JSON.stringify(m)}`);
    check(`${scenario}: el modal no desborda por sí mismo`, m.dialogOverflow !== null && m.dialogOverflow <= 0, `overflow ${m.dialogOverflow}`);
    check(`${scenario}: ninguna fila desborda`, m.rows > 0 && m.rowsOverflow === 0, `${m.rowsOverflow}/${m.rows} filas`);
    if (m.scrollWidth > MOBILE_WIDTH || m.dialogX + m.dialogWidth > m.innerWidth) {
      warn(`${scenario}: página scrollWidth ${m.scrollWidth}, diálogo x=${m.dialogX} ancho=${m.dialogWidth} (ensanchado por el desborde del listado; PR #33). Informativo.`);
    }
  };
  await measure('10 modal de categorías');
  await shot(page, '10-movil-modal-categorias');

  await categoryRow(dlg, 'Alquiler de oficina').getByRole('button', { name: 'Editar Alquiler de oficina' }).click();
  await page.waitForTimeout(1500);
  await measure('10b modal con una fila en edición');
  await dlg.locator('[data-testid="category-row"]').filter({ has: page.getByRole('button', { name: 'Guardar' }) }).scrollIntoViewIfNeeded();
  await shot(page, '10b-movil-fila-en-edicion');
  await dlg.getByRole('button', { name: 'Cancelar' }).click().catch(() => {});
  await closeDialog(page);
};

// =====================================================================
let currentPage = null;
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
try {
  seed();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dpage = await desktop.newPage();
  currentPage = dpage;
  await login(dpage);
  await desktopRun(dpage);
  const state = await desktop.storageState();
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: MOBILE_WIDTH, height: 812 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    storageState: state,
  });
  currentPage = await mobile.newPage();
  await mobileRun(currentPage);
  await mobile.close();
} catch (error) {
  console.error(error);
  // Captura del estado en que falló, para diagnosticar.
  if (currentPage) await currentPage.screenshot({ path: `${OUT}/tsk757-error.png` }).catch(() => {});
  check('recorrido sin excepciones', false, error instanceof Error ? error.message : String(error));
} finally {
  try {
    check('limpieza: sin egresos, categorías ni cuenta temporal de la demo', cleanup());
  } catch (error) {
    console.error('No se pudo limpiar la siembra:', error);
    check('limpieza', false);
  }
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\nChequeos: ${checks.length - failed.length}/${checks.length} OK`);
for (const f of failed) console.log(`  FAIL ${f.name} ${f.detail}`);
if (failed.length) process.exitCode = 1;
console.log(process.exitCode ? 'Terminó con errores.' : 'Listo.');
