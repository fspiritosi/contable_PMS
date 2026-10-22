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
 * Sección Gestión — formulario de movimientos de fondo (tarea 6), Tesorería → Movimientos de fondos:
 *   - Gastos bancarios: combo de conceptos por línea, sin cuenta en pantalla; se confirma un
 *     movimiento de dos líneas y el asiento (psql) tiene las cuentas de los conceptos
 *   - Aporte: campo Concepto, aviso según el concepto, y se limpia al cambiar de tipo
 *   - Empresa sin conceptos de Gastos bancarios: aviso y Guardar deshabilitado (se desactivan
 *     los conceptos de ese uso con psql y se restauran en un finally)
 *   Capturas: tsk791-04-gastos-bancarios-conceptos, tsk791-05-aporte-concepto, tsk791-06-sin-conceptos
 *   Deja en dev el concepto `Comisión de mantenimiento` (Gastos bancarios) y un movimiento
 *   confirmado `TSK791 gastos bancarios` por corrida.
 *
 * Sección Gestión — movimiento bancario manual (tarea 7), Tesorería → Cuentas bancarias → detalle:
 *   - "Nuevo Movimiento" no tiene ningún campo de cuenta, solo Concepto
 *   - el combo ofrece los conceptos del tipo y pasar de Comisión a Depósito limpia el concepto
 *   - se registra una comisión con concepto: queda conceptId/concept_name y el asiento usa la
 *     cuenta del concepto (psql); el movimiento se ve en la tabla con su Concepto
 *   Captura: tsk791-07-movimiento-bancario
 *   Deja en dev los conceptos `Comisión bancaria` (BANK_FEE) y `Depósito de efectivo`
 *   (BANK_DEPOSIT) y un movimiento `TSK791 comisión bancaria` por corrida.
 *
 * Opciones: --only=fondos  (salta la sección de Contabilidad)
 *           --only=banco   (solo la sección del movimiento bancario)
 *           --recapture-forms  (solo vuelve a sacar tsk791-02 y tsk791-03 abriendo el alta SIN guardar,
 *                              con el combo de cuentas cerrado y sin avisos; no crea conceptos)
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
const RUN = Date.now(); // descripciones únicas por corrida: los chequeos no se mezclan con datos de corridas previas

const ONLY_BANK = process.argv.includes('--only=banco');
const RECAPTURE = process.argv.includes('--recapture-forms');
const ONLY_FUND = process.argv.includes('--only=fondos') || ONLY_BANK || RECAPTURE;

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

if (RECAPTURE) try {
  const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);
  const forms = [
    { shotName: 'tsk791-02-alta-gasto', name: 'Impuesto ley 25.413', usages: ['Gastos e impuestos bancarios'], accountSearch: 'Débitos y Créditos' },
    { shotName: 'tsk791-03-alta-aporte-radio', name: 'Aporte para obra', usages: ['Aporte de socio'], partnerMode: 'Usar otra cuenta', accountSearch: 'Aportes Irrevocables' },
  ];
  for (const { shotName, ...form } of forms) {
    await openList(page);
    const dialog = await fillForm(page, form);
    // cierra el combo de cuentas haciendo clic en el título del diálogo
    await dialog.getByRole('heading', { name: 'Nuevo concepto' }).click();
    await page.waitForTimeout(700);
    await shot(page, shotName);
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  await context.close();
} catch (error) {
  console.error(error);
  failures++;
}

if (!ONLY_FUND) try {
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
}

// ---------------------------------------------------------------- Gestión (tarea 6)
const ACCOUNT_CODE = /\d\.\d\.\d\/\d\d(\/\d\d)?/; // código de cuenta tipo 4.2.1/07/06
const MOV_DESC = `TSK791 gastos bancarios ${RUN}`;
const FUND_URL = `${BASE}/dashboard/commercial/treasury/fund-movements`;

const openFundModal = async (page) => {
  await page.goto(FUND_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Nuevo Movimiento' }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Nuevo Movimiento' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  return dialog;
};

const pickOption = async (page, trigger, optionName) => {
  await trigger.click();
  await page.getByRole('option', { name: optionName }).click();
};

const chooseType = (page, dialog, label) => pickOption(page, dialog.getByRole('combobox').first(), label);

const waitToastsGone = async (page) => {
  await page.waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length === 0, null, {
    timeout: 20000,
  });
};

const conceptsOf = (usage) =>
  psql(`select id from movement_concepts where company_id='${COMPANY}' and '${usage}' = any(usages) and is_active`)
    .split('\n')
    .filter(Boolean);

if (!ONLY_BANK && !RECAPTURE) try {
  // Segundo concepto de Gastos bancarios (cuenta distinta), para tener dos líneas distintas.
  if (!conceptExists('Comisión de mantenimiento')) {
    const accId = psql(`select id from accounts where company_id='${COMPANY}' and code='4.2.1/03/09'`);
    psql(
      `insert into movement_concepts (company_id, name, usages, account_mode, account_id, created_by, updated_at) ` +
        `values ('${COMPANY}', 'Comisión de mantenimiento', '{FUND_BANK_CHARGES}', 'OWN_ACCOUNT', '${accId}', 'tsk791-script', now())`,
    );
  }
  const acct = (name) =>
    psql(
      `select a.code from movement_concepts c join accounts a on a.id=c.account_id where c.company_id='${COMPANY}' and c.name='${name}'`,
    );
  const CODE_IMPUESTO = acct('Impuesto ley 25.413');
  const CODE_COMISION = acct('Comisión de mantenimiento');

  const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);

  console.log('Gastos bancarios con conceptos');
  let dialog = await openFundModal(page);
  await chooseType(page, dialog, 'Gastos e impuestos bancarios');
  await pickOption(page, dialog.getByRole('combobox').nth(1), /Banco Santander/);
  await dialog.getByRole('button', { name: 'Agregar concepto' }).click();
  await dialog.getByRole('button', { name: 'Agregar concepto' }).click();
  // Los combos de concepto de línea siguen al tipo (0) y al fondo (1).
  const lineSelect = (i) => dialog.getByRole('combobox').nth(2 + i);
  await lineSelect(0).click();
  const offered = await page.getByRole('option').allInnerTexts();
  check(
    offered.includes('Impuesto ley 25.413') && offered.includes('Comisión de mantenimiento'),
    `el combo ofrece los conceptos activos (${offered.join(' | ')})`,
  );
  check(!offered.some((t) => ACCOUNT_CODE.test(t)), 'las opciones del combo no muestran código de cuenta');
  await page.getByRole('option', { name: 'Impuesto ley 25.413' }).click();
  await pickOption(page, lineSelect(1), 'Comisión de mantenimiento');
  await dialog.getByPlaceholder('Detalle (opcional)').nth(0).fill('Débitos del mes');
  // El segundo detalle queda vacío a propósito: el asiento usa el nombre del concepto.
  await dialog.getByPlaceholder('0,00').nth(0).fill('1500');
  await dialog.getByPlaceholder('0,00').nth(1).fill('800');
  await dialog.locator('textarea').fill(MOV_DESC);
  await page.waitForTimeout(500);
  const modalText = await dialog.innerText();
  check(!ACCOUNT_CODE.test(modalText), 'el modal no contiene ningún código de cuenta');
  check(!modalText.includes(CODE_IMPUESTO) && !modalText.includes('Débitos y Créditos Bancarios'), 'no aparece la cuenta del concepto');
  check((await dialog.getByPlaceholder('Detalle (opcional)').count()) === 2, 'el detalle es opcional (placeholder "Detalle (opcional)")');
  await dialog.getByText('Total').scrollIntoViewIfNeeded();
  await shot(page, 'tsk791-04-gastos-bancarios-conceptos');

  psql(`delete from fund_movements where company_id='${COMPANY}' and status='DRAFT' and description='${MOV_DESC}'`);
  await dialog.getByRole('button', { name: 'Guardar y Confirmar' }).click();
  await page.getByText('Movimiento confirmado').first().waitFor({ timeout: 30000 });
  check(true, 'el movimiento de dos líneas se confirmó');
  const movId = psql(
    `select id from fund_movements where company_id='${COMPANY}' and description='${MOV_DESC}' order by created_at desc limit 1`,
  );
  const entryLines = psql(
    `select a.code || ':' || l.debit || ':' || coalesce(l.description,'') from journal_entry_lines l ` +
      `join accounts a on a.id=l.account_id join fund_movements m on m.journal_entry_id=l.entry_id ` +
      `where m.id='${movId}' and l.debit > 0 order by l.debit desc`,
  ).split('\n');
  console.log(`  asiento (débitos): ${entryLines.join(' ; ')}`);
  check(
    entryLines.length === 2 &&
      entryLines[0].startsWith(`${CODE_IMPUESTO}:1500`) &&
      entryLines[0].endsWith('Débitos del mes') &&
      entryLines[1].startsWith(`${CODE_COMISION}:800`) &&
      entryLines[1].endsWith('Comisión de mantenimiento'),
    'el asiento tiene las cuentas de los conceptos (y el nombre del concepto si no hay detalle)',
  );
  await waitToastsGone(page);

  console.log('Vista del movimiento confirmado');
  await page.goto(FUND_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Nuevo Movimiento' }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(1000);
  await page.getByRole('row', { name: new RegExp(MOV_DESC) }).first().getByRole('button', { name: 'Abrir menú' }).click();
  await page.getByRole('menuitem', { name: 'Ver' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByText('Impuesto ley 25.413').first().waitFor({ timeout: 30000 });
  const viewText = await dialog.innerText();
  check(viewText.includes('Comisión de mantenimiento') && !ACCOUNT_CODE.test(viewText), 'la vista muestra el concepto de cada línea y ninguna cuenta');
  await dialog.getByRole('button', { name: 'Cerrar' }).click();

  console.log('Aporte con concepto');
  dialog = await openFundModal(page);
  const conceptTrigger = dialog.getByRole('combobox', { name: /Concepto/ });
  check((await conceptTrigger.count()) === 1, 'Aporte muestra el campo Concepto');
  await pickOption(page, dialog.getByRole('combobox', { name: /Socio/ }), /Juan Perez/);
  await conceptTrigger.click();
  const aporteOptions = await page.getByRole('option').allInnerTexts();
  check(
    aporteOptions.includes('Aporte para obra') && aporteOptions.includes('Aporte común') && !aporteOptions.some((t) => ACCOUNT_CODE.test(t)),
    `el campo Concepto ofrece los conceptos de Aporte (${aporteOptions.join(' | ')})`,
  );
  await page.getByRole('option', { name: 'Aporte para obra' }).click();
  await page.waitForTimeout(500);
  const aporteText = await dialog.innerText();
  check(
    aporteText.includes('El asiento se imputará según el concepto «Aporte para obra».') && !ACCOUNT_CODE.test(aporteText) && !aporteText.includes('Aportes Irrevocables'),
    'concepto con cuenta propia: aviso "según el concepto" y sin cuenta',
  );
  await dialog.getByPlaceholder('0,00').fill('1000');
  await dialog.locator('textarea').fill('TSK791 aporte (captura)');
  await pickOption(page, dialog.getByRole('combobox', { name: /Banco\/caja donde ingresan/ }), /Banco Santander/);
  await page.waitForTimeout(300);
  await shot(page, 'tsk791-05-aporte-concepto');

  await pickOption(page, conceptTrigger, 'Aporte común');
  await page.waitForTimeout(400);
  check(!(await dialog.innerText()).includes('según el concepto'), 'concepto con cuenta del socio: el aviso es el de la cuenta del socio');

  await chooseType(page, dialog, 'Retiro de socio');
  await page.waitForTimeout(400);
  check((await dialog.getByRole('combobox', { name: /Concepto/ }).count()) === 0, 'Retiro sin conceptos: no se muestra el campo');
  await chooseType(page, dialog, 'Aporte de socio');
  await page.waitForTimeout(400);
  check(
    (await dialog.getByRole('combobox', { name: /Concepto/ }).innerText()).includes('Seleccionar concepto'),
    'al cambiar de tipo y volver, el concepto quedó limpio',
  );
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await context.close();

  console.log('Empresa sin conceptos de Gastos bancarios');
  const ids = conceptsOf('FUND_BANK_CHARGES');
  check(ids.length >= 2, `hay ${ids.length} conceptos de Gastos bancarios activos antes de la prueba`);
  const ctx2 = await browser.newContext({ locale: 'es-AR', viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  try {
    psql(`update movement_concepts set is_active=false where id in (${ids.map((i) => `'${i}'`).join(',')})`);
    await login(page2);
    const d2 = await openFundModal(page2);
    await chooseType(page2, d2, 'Gastos e impuestos bancarios');
    await page2.waitForTimeout(600);
    const text2 = await d2.innerText();
    check(
      text2.includes('No hay conceptos configurados para «Gastos e impuestos bancarios». Pedile a Contabilidad que los cree en Empresa → Contabilidad → Conceptos.'),
      'aparece el aviso con el texto acordado',
    );
    await d2.getByRole('link', { name: 'Ir a Conceptos' }).waitFor({ timeout: 15000 }).catch(() => {});
    check(
      (await d2.getByRole('link', { name: 'Ir a Conceptos' }).count()) === 1,
      'con permiso sobre Conceptos el aviso trae el link',
    );
    check(await d2.getByRole('button', { name: 'Guardar', exact: true }).isDisabled(), 'Guardar está deshabilitado');
    check(await d2.getByRole('button', { name: 'Guardar y Confirmar' }).isDisabled(), 'Guardar y Confirmar está deshabilitado');
    await shot(page2, 'tsk791-06-sin-conceptos');
  } finally {
    psql(`update movement_concepts set is_active=true where id in (${ids.map((i) => `'${i}'`).join(',')})`);
  }
  check(conceptsOf('FUND_BANK_CHARGES').length === ids.length, 'restaurado: los conceptos de Gastos bancarios volvieron a estar activos');
  await ctx2.close();
} catch (error) {
  console.error(error);
  failures++;
}

// ---------------------------------------------------------------- Movimiento bancario (tarea 7)
const BANK_ID = '63f3b949-5107-4b81-b903-da1766be23ae'; // Banco Santander 1085628-1
const BANK_DESC = `TSK791 comisión bancaria ${RUN}`;

const ensureBankConcept = (name, usage, accountCode) => {
  if (conceptExists(name)) return;
  const accId = psql(`select id from accounts where company_id='${COMPANY}' and code='${accountCode}'`);
  psql(
    `insert into movement_concepts (company_id, name, usages, account_mode, account_id, created_by, updated_at) ` +
      `values ('${COMPANY}', '${name}', '{${usage}}', 'OWN_ACCOUNT', '${accId}', 'tsk791-script', now())`,
  );
};

try {
  console.log('Movimiento bancario manual');
  ensureBankConcept('Comisión bancaria', 'BANK_FEE', '1.1.4/01/30');
  ensureBankConcept('Depósito de efectivo', 'BANK_DEPOSIT', '1.1.4/02/07');
  const feeAccount = psql(
    `select a.id from movement_concepts c join accounts a on a.id=c.account_id where c.company_id='${COMPANY}' and c.name='Comisión bancaria'`,
  );
  psql(`delete from bank_movements where company_id='${COMPANY}' and description='${BANK_DESC}'`);

  const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);
  await page.goto(`${BASE}/dashboard/commercial/treasury/bank-accounts/${BANK_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Nuevo Movimiento' }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Nuevo Movimiento' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();

  await pickOption(page, dialog.getByRole('combobox', { name: /Tipo de Movimiento/ }), 'Comisión');
  await page.waitForTimeout(600);
  const text = await dialog.innerText();
  check(!/Cuenta Contable|Contrapartida/i.test(text), 'el formulario no tiene ningún campo de cuenta');
  check(!ACCOUNT_CODE.test(text), 'el formulario no muestra códigos de cuenta');
  const conceptTrigger = dialog.getByRole('combobox', { name: /Concepto/ });
  check((await conceptTrigger.count()) === 1, 'el formulario tiene el campo Concepto');
  await conceptTrigger.click();
  await page.getByRole('option').first().waitFor({ timeout: 10000 });
  const feeOptions = await page.getByRole('option').allInnerTexts();
  check(feeOptions.includes('Comisión bancaria') && !feeOptions.includes('Depósito de efectivo'), `Comisión ofrece solo sus conceptos (${feeOptions.join(' | ')})`);
  await page.getByRole('option', { name: 'Comisión bancaria' }).click();
  check((await conceptTrigger.innerText()).includes('Comisión bancaria'), 'queda elegido el concepto Comisión bancaria');

  await pickOption(page, dialog.getByRole('combobox', { name: /Tipo de Movimiento/ }), 'Depósito');
  await page.waitForTimeout(600);
  check((await conceptTrigger.innerText()).includes('Seleccionar concepto'), 'Comisión → Depósito limpia el concepto');
  await conceptTrigger.click();
  await page.getByRole('option').first().waitFor({ timeout: 10000 });
  const depOptions = await page.getByRole('option').allInnerTexts();
  check(depOptions.includes('Depósito de efectivo') && !depOptions.includes('Comisión bancaria'), `Depósito ofrece solo sus conceptos (${depOptions.join(' | ')})`);
  await page.keyboard.press('Escape');

  await pickOption(page, dialog.getByRole('combobox', { name: /Tipo de Movimiento/ }), 'Comisión');
  await page.waitForTimeout(400);
  await pickOption(page, conceptTrigger, 'Comisión bancaria');
  await dialog.getByPlaceholder('0.00').fill('1234.5');
  await dialog.getByPlaceholder('Descripción del movimiento...').fill(BANK_DESC);
  await page.waitForTimeout(300);
  await shot(page, 'tsk791-07-movimiento-bancario');

  const balanceBefore = Number(psql(`select balance from bank_accounts where id='${BANK_ID}'`));
  await dialog.getByRole('button', { name: 'Registrar Movimiento' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
  await page.waitForTimeout(1500);
  const row = psql(
    `select concept_name, amount from bank_movements where company_id='${COMPANY}' and description='${BANK_DESC}'`,
  );
  check(row === 'Comisión bancaria|1234.50', `el movimiento quedó con su concepto (${row})`);
  const lines = psql(
    `select count(*) from journal_entry_lines l join journal_entries e on e.id=l.entry_id where e.company_id='${COMPANY}' and e.description like '%${BANK_DESC}%' and l.account_id='${feeAccount}' and l.debit=1234.5`,
  );
  check(lines === '1', 'el asiento debita la cuenta del concepto');
  check(Number(psql(`select balance from bank_accounts where id='${BANK_ID}'`)) === balanceBefore - 1234.5, 'el saldo bajó el monto de la comisión');
  check((await page.getByRole('row', { name: new RegExp(BANK_DESC) }).first().innerText()).includes('Comisión bancaria'), 'la tabla muestra el concepto del movimiento');
  await context.close();
} catch (error) {
  console.error(error);
  failures++;
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nOK' : `\n${failures} chequeo(s) fallaron`);
process.exit(failures === 0 ? 0 : 1);
