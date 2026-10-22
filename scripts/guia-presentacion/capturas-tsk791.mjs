/**
 * Capturas y verificación en navegador del TSK-791 (Conceptos de movimientos).
 * Las secciones se agregan por tarea; esta es la de Contabilidad (tarea 4).
 *
 * Sección Contabilidad — pantalla Empresa → Contabilidad → Conceptos:
 *   - el ítem "Conceptos" aparece en el sidebar
 *   - se crean (si no existen) `Impuesto ley 25.413`, `Aporte para obra` y `Aporte común`
 *     y se DEJAN en la base de dev: las tareas siguientes los usan
 *   - marcar Gastos bancarios oculta el radio "¿Qué cuenta usa?"
 *   - eliminar un concepto usado muestra el error. Para eso se crea un concepto temporal
 *     `TSK791 temporal`, se siembra con psql un movimiento de fondo BORRADOR que lo usa, se
 *     intenta borrar desde la UI y al final se limpia todo (movimiento y concepto).
 *   Capturas: tsk791-01-listado, tsk791-02-alta-gasto, tsk791-03-alta-aporte-radio
 *
 * Es idempotente: si un concepto ya existe, no lo vuelve a crear.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk791.mjs [baseUrl]   (dev :3010)
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY = '02885d43-1358-4eb2-b774-c52d5be372f3'; // empresa activa habitual en dev
const TEMP_NAME = 'TSK791 temporal';

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};

const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -Atc "${sql}"`).toString().trim();

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

const hideDevBadges = (page) =>
  page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});

const login = async (page) => {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};

const openList = async (page) => {
  await page.goto(`${BASE}/dashboard/company/accounting/concepts`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Conceptos' }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await hideDevBadges(page);
};

const conceptExists = (name) =>
  psql(`select count(*) from movement_concepts where company_id='${COMPANY}' and name='${name}'`) !== '0';

const shot = async (page, name) => {
  await hideDevBadges(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  → ${OUT}/${name}.png`);
};

/** Abre el diálogo de alta, tilda los usos y elige cuenta; devuelve el diálogo sin guardar. */
const fillForm = async (page, { name, usages, partnerMode, accountSearch }) => {
  await page.getByRole('button', { name: 'Nuevo concepto' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill(name);
  for (const usage of usages) await dialog.getByLabel(usage, { exact: true }).click();
  if (partnerMode) await dialog.getByLabel(partnerMode).click();
  if (accountSearch) {
    await dialog.getByRole('combobox').click();
    await page.getByPlaceholder(/buscar/i).fill(accountSearch);
    await page.getByRole('option').first().click();
  }
  return dialog;
};

const save = async (page, dialog) => {
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
  await page.waitForTimeout(1000);
};

try {
  const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);

  console.log('Sidebar');
  await openList(page);
  check((await page.getByRole('link', { name: 'Conceptos' }).count()) > 0, 'el ítem "Conceptos" aparece en el sidebar');

  console.log('Alta de Impuesto ley 25.413 (Gastos bancarios)');
  if (conceptExists('Impuesto ley 25.413')) {
    console.log('  (ya existe, se omite)');
  } else {
    const dialog = await fillForm(page, {
      name: 'Impuesto ley 25.413',
      usages: ['Gastos e impuestos bancarios'],
      accountSearch: 'Débitos y Créditos',
    });
    check((await dialog.getByText('¿Qué cuenta usa?').count()) === 0, 'con Gastos bancarios marcado no se muestra el radio');
    await shot(page, 'tsk791-02-alta-gasto');
    await save(page, dialog);
  }
  check(conceptExists('Impuesto ley 25.413'), 'existe el concepto Impuesto ley 25.413');

  console.log('Alta de Aporte para obra (cuenta propia de PN)');
  if (!conceptExists('Aporte para obra')) {
    const dialog = await fillForm(page, {
      name: 'Aporte para obra',
      usages: ['Aporte de socio'],
      partnerMode: 'Usar otra cuenta',
      accountSearch: 'Aportes Irrevocables',
    });
    check((await dialog.getByText('¿Qué cuenta usa?').count()) === 1, 'con solo Aporte de socio se muestra el radio');
    await shot(page, 'tsk791-03-alta-aporte-radio');
    await save(page, dialog);
  }
  check(conceptExists('Aporte para obra'), 'existe el concepto Aporte para obra');

  console.log('Alta de Aporte común (cuenta del socio)');
  if (!conceptExists('Aporte común')) {
    const dialog = await fillForm(page, {
      name: 'Aporte común',
      usages: ['Aporte de socio'],
      partnerMode: 'Mantener la cuenta del socio',
    });
    await save(page, dialog);
  }
  check(
    psql(`select account_mode from movement_concepts where company_id='${COMPANY}' and name='Aporte común'`) === 'PARTNER_ACCOUNT',
    'Aporte común quedó con la cuenta del socio',
  );

  console.log('Radio oculto al sumar un uso que no es de socio');
  await page.getByRole('button', { name: 'Nuevo concepto' }).click();
  {
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Aporte de socio', { exact: true }).click();
    check((await dialog.getByText('¿Qué cuenta usa?').count()) === 1, 'Aporte de socio: radio visible');
    await dialog.getByLabel('Gastos e impuestos bancarios', { exact: true }).click();
    check((await dialog.getByText('¿Qué cuenta usa?').count()) === 0, 'Aporte + Gastos bancarios: radio oculto');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
  }

  console.log('Eliminar un concepto usado muestra el error');
  if (!conceptExists(TEMP_NAME)) {
    const dialog = await fillForm(page, {
      name: TEMP_NAME,
      usages: ['Aporte de socio'],
      partnerMode: 'Mantener la cuenta del socio',
    });
    await save(page, dialog);
  }
  const tempId = psql(`select id from movement_concepts where company_id='${COMPANY}' and name='${TEMP_NAME}'`);
  psql(`delete from fund_movements where company_id='${COMPANY}' and description='TSK791 siembra'`);
  psql(
    `insert into fund_movements (company_id, date, type, amount, description, created_by, updated_at, status, concept_id, concept_name) ` +
      `values ('${COMPANY}', current_date, 'PARTNER_CONTRIBUTION', 1, 'TSK791 siembra', 'tsk791-script', now(), 'DRAFT', '${tempId}', '${TEMP_NAME}')`,
  );
  try {
    await openList(page);
    const row = page.getByRole('row', { name: new RegExp(TEMP_NAME) });
    await row.getByRole('button', { name: 'Abrir menú' }).click();
    await page.getByRole('menuitem', { name: 'Eliminar' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Eliminar' }).click();
    const toast = page.getByText(/ya se usó en movimientos/).first();
    await toast.waitFor({ timeout: 15000 });
    check(true, 'aparece el error "ya se usó en movimientos"');
    check(conceptExists(TEMP_NAME), 'el concepto usado sigue existiendo');
  } finally {
    psql(`delete from fund_movements where company_id='${COMPANY}' and description='TSK791 siembra'`);
    psql(`delete from movement_concepts where id='${tempId}'`);
  }
  check(!conceptExists(TEMP_NAME), 'limpieza: el concepto temporal y su movimiento fueron borrados');

  console.log('Captura del listado');
  await openList(page);
  await shot(page, 'tsk791-01-listado');
  await context.close();
} catch (error) {
  console.error(error);
  failures++;
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nOK' : `\n${failures} chequeo(s) fallaron`);
process.exit(failures === 0 ? 0 : 1);
