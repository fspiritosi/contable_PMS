/**
 * Capturas y verificación en navegador de TSK-720a + TSK-726 (Movimientos de
 * Fondos: acción "Ver" en solo lectura, sin columna "Asiento", y modal que entra
 * en la pantalla del celular).
 *
 * Recorre, sobre la Empresa de Prueba 01 SA (Tesorería → Movimientos de Fondos):
 *   01 listado sin la columna "Asiento" (a 1600: a 1440 la tabla ya desbordaba) (assert)
 *   02 menú de un movimiento confirmado → solo "Ver"           (assert)
 *   03 menú de un borrador → Ver + Confirmar / Editar / Eliminar (assert)
 *   04-07 "Ver" de los 4 tipos: aporte confirmado (Estado / Confirmado el / Asiento N°),
 *         retiro borrador, transferencia anulada, gastos bancarios confirmado (conceptos y total)
 *   08 "Ver" de un movimiento cuya caja y socio ya no están en los catálogos (snapshot)
 *   09 / 09b barra de paginación en escritorio (Movimientos de Fondos y Socios)
 *   10-13 celular: modal de alta con cada tipo (en gastos, con un concepto: fila apilada)
 *   14-17 celular: "Ver" de los 4 movimientos de 04-07
 *   18 celular: listado con la paginación partida en líneas
 *
 * Criterio de aceptación de TSK-726 (contexto móvil 375×812 con `isMobile: true`,
 * que es lo que reproduce el problema de un teléfono real): en cada escenario
 * 10-17 el diálogo cumple x ≥ 0 y x + width ≤ 375, la X de cerrar es visible y
 * entra en los 375 px, `innerWidth` = 375 y la página no tiene scroll
 * horizontal (`scrollWidth ≤ innerWidth`), sin desborde dentro del diálogo ni del
 * fieldset. También el listado de Movimientos de Fondos sin modal (= 375). Si algo
 * no se cumple, el script termina con código 1. Socios (antes 443) y Dashboard
 * (antes 491) solo se informan y se controla que no empeoren (fuera de alcance).
 *
 * Datos:
 *   - Reutiliza los dos movimientos CONFIRMADOS que dejó la verificación de las
 *     fases 4/5 (aporte con asiento N° 36 y gastos bancarios con asiento N° 37):
 *     confirmar por UI en cada corrida movería otra vez el saldo del banco y la
 *     numeración de asientos. El script solo les pone una descripción legible
 *     para la presentación y no los borra.
 *   - Siembra por SQL (y borra al terminar, también ante error) tres movimientos
 *     marcados con created_by = 'TSK720A-demo' (no se muestra en pantalla, así
 *     las descripciones quedan limpias): un retiro en borrador, una transferencia
 *     anulada y un retiro anulado cuya caja y socio no existen en los catálogos
 *     (ids inexistentes con su nombre guardado: el caso "caja cerrada / socio dado
 *     de baja").
 *
 * Uso:
 *   node scripts/guia-presentacion/capturas-tsk720a-726.mjs [baseUrl]              # todo (dev :3010)
 *   node scripts/guia-presentacion/capturas-tsk720a-726.mjs [baseUrl] --solo-movil # solo 10-18 y mediciones
 *   node scripts/guia-presentacion/capturas-tsk720a-726.mjs --cleanup              # solo borra la siembra
 *
 * Las capturas "antes" (`*-antes.png`: modal de alta y listado en el celular con
 * el código previo a la Fase 2) no las genera este script: se tomaron con el
 * mismo contexto móvil sobre el commit anterior al arreglo de la paginación
 * (7ffaa16) durante la Fase 2 y se copiaron a assets/.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const CLEANUP_ONLY = args.includes('--cleanup');
const SOLO_MOVIL = args.includes('--solo-movil');
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY_ID = '02885d43-1358-4eb2-b774-c52d5be372f3';
const BANK_ID = '63f3b949-5107-4b81-b903-da1766be23ae'; // Banco Santander 1085628-1
const BANK_LABEL = 'Banco Santander - 1085628-1';
const CONTRIBUTION_ID = 'c2250ab9-00ba-4304-bc44-46f7cf526685'; // aporte confirmado, asiento N° 36
const CHARGES_ID = 'f6411cea-9d20-4559-b4c3-85373e88b14d'; // gastos bancarios confirmado, asiento N° 37
const MARK = 'TSK720A-demo';
const LIST_PATH = '/dashboard/commercial/treasury/fund-movements';
const MOBILE_WIDTH = 375;
const LIST_SHOT_WIDTH = 1600; // capturas 01-03 (ver nota en desktopRun)

const DESC = {
  aporte: 'Aporte de capital de María López',
  gastos: 'Comisiones e impuestos del banco',
  retiro: 'Retiro a cuenta de utilidades',
  transferencia: 'Pase de fondos del banco a la caja',
  snapshot: 'Retiro en efectivo de un socio que ya no está',
};
const SNAPSHOT_CASH_LABEL = 'Caja Chica';
const SNAPSHOT_PARTNER_NAME = 'Carlos Gómez';

mkdirSync(OUT, { recursive: true });

const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -qtAc "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  }).trim();

// =====================================================================
// Siembra y limpieza
// =====================================================================
/** Borra los movimientos sembrados. Ninguno está confirmado: no hay asiento ni saldo que revertir. */
const cleanup = () => {
  const n = psql(`select count(*) from fund_movements where company_id='${COMPANY_ID}' and created_by='${MARK}'`);
  psql(`delete from fund_movement_lines where movement_id in (select id from fund_movements where created_by='${MARK}')`);
  psql(`delete from fund_movements where company_id='${COMPANY_ID}' and created_by='${MARK}'`);
  console.log(`  limpieza: ${n} movimiento(s) ${MARK} borrado(s)`);
};

if (CLEANUP_ONLY) {
  cleanup();
  process.exit(0);
}

const insertMovement = (cols) => {
  const keys = Object.keys(cols);
  const vals = keys.map((k) => (cols[k] === null ? 'NULL' : typeof cols[k] === 'number' ? cols[k] : `'${cols[k]}'`));
  return psql(
    `insert into fund_movements (company_id, created_by, updated_at, ${keys.join(', ')}) values ('${COMPANY_ID}', '${MARK}', now(), ${vals.join(', ')}) returning id`
  );
};

const seed = () => {
  cleanup();

  // Datos base: si falta algo, se aborta antes de abrir el navegador
  const confirmed = psql(
    `select count(*) from fund_movements where id in ('${CONTRIBUTION_ID}','${CHARGES_ID}') and status='CONFIRMED' and journal_entry_number is not null`
  );
  if (confirmed !== '2') {
    throw new Error(
      `Faltan los movimientos confirmados ${CONTRIBUTION_ID} / ${CHARGES_ID} (los dejó la verificación de las fases 4/5). Confirmá un aporte y un gasto bancario por la UI y actualizá las constantes.`
    );
  }
  const bank = psql(`select count(*) from bank_accounts where id='${BANK_ID}' and status='ACTIVE'`);
  const partner = psql(`select id from partners where company_id='${COMPANY_ID}' and is_active and name='Juan Perez' limit 1`);
  const cash = psql(
    `select r.id from cash_registers r where r.company_id='${COMPANY_ID}' and r.status='ACTIVE' and exists (select 1 from cash_register_sessions s where s.cash_register_id=r.id and s.status='OPEN') order by r.code limit 1`
  );
  if (bank !== '1' || !partner || !cash) {
    throw new Error(`Faltan datos base: banco activo=${bank}, socio activo "Juan Perez"=${partner || '-'}, caja con sesión abierta=${cash || '-'}`);
  }
  const cashName = psql(`select name from cash_registers where id='${cash}'`);

  // Descripciones legibles para los dos confirmados (idempotente)
  psql(`update fund_movements set description='${DESC.aporte}' where id='${CONTRIBUTION_ID}'`);
  psql(`update fund_movements set description='${DESC.gastos}' where id='${CHARGES_ID}'`);

  insertMovement({
    date: moment(-2),
    type: 'PARTNER_WITHDRAWAL',
    status: 'DRAFT',
    amount: 85000,
    description: DESC.retiro,
    fund_out_kind: 'BANK',
    fund_out_id: BANK_ID,
    fund_out_label: BANK_LABEL,
    partner_id: partner,
    partner_name: 'Juan Perez',
  });
  insertMovement({
    date: moment(-4),
    type: 'ACCOUNT_TRANSFER',
    status: 'CANCELLED',
    amount: 40000,
    description: DESC.transferencia,
    fund_out_kind: 'BANK',
    fund_out_id: BANK_ID,
    fund_out_label: BANK_LABEL,
    fund_in_kind: 'CASH',
    fund_in_id: cash,
    fund_in_label: `Caja ${cashName}`,
  });
  // Snapshot: ids que no están en ningún catálogo, con el nombre que se guardó al cargarlo
  insertMovement({
    date: moment(-20),
    type: 'PARTNER_WITHDRAWAL',
    status: 'CANCELLED',
    amount: 12000,
    description: DESC.snapshot,
    fund_out_kind: 'CASH',
    fund_out_id: psql('select gen_random_uuid()'),
    fund_out_label: SNAPSHOT_CASH_LABEL,
    partner_id: psql('select gen_random_uuid()'),
    partner_name: SNAPSHOT_PARTNER_NAME,
  });
  console.log('  siembra: retiro borrador, transferencia anulada y retiro anulado con snapshot');
};

/** Fecha 'YYYY-MM-DD' relativa a hoy (días), calculada por la base para no depender del huso local. */
function moment(days) {
  return psql(`select (current_date + ${days})::text`);
}

// =====================================================================
// Navegador
// =====================================================================
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const measures = [];

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
  await (locator ?? page).screenshot({ path: `${OUT}/tsk720a-726-${name}.png`, ...opts });
  console.log(`  ✓ ${name}`);
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
  await page.goto(`${BASE}${LIST_PATH}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Nuevo Movimiento/ }).waitFor({ timeout: 60000 });
  await page.locator('table tbody tr').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
};

const rowOf = (page, description) => page.locator('table tbody tr').filter({ hasText: description }).first();

const openRowMenu = async (page, description) => {
  const row = rowOf(page, description);
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.getByRole('button', { name: 'Abrir menú' }).click();
  const menu = page.getByRole('menu');
  await menu.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(300);
  return menu;
};

/** Recorte que incluye la fila (desde la descripción) y el menú abierto. */
const menuClip = async (page, menu, description) => {
  const m = await menu.boundingBox();
  const r = await rowOf(page, description).boundingBox();
  const x = Math.max(0, Math.min(m.x, r.x + r.width) - 760);
  const y = Math.max(0, Math.min(m.y, r.y) - 50);
  const right = Math.min(LIST_SHOT_WIDTH, Math.max(m.x + m.width, r.x + r.width) + 16);
  const bottom = Math.max(m.y + m.height, r.y + r.height) + 16;
  return { x, y, width: right - x, height: bottom - y };
};

const menuItems = async (menu) =>
  (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim()).filter(Boolean);

const openView = async (page, description) => {
  const menu = await openRowMenu(page, description);
  await menu.getByRole('menuitem', { name: 'Ver' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor({ state: 'visible', timeout: 10000 });
  await dlg.getByText('Movimiento de Fondos', { exact: true }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200); // conceptos (useQuery) y animación de entrada
  return dlg;
};

const closeDialog = async (page) => {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
};

/** Texto visible del diálogo más los valores de sus inputs (los conceptos viven en inputs). */
const dialogText = async (dlg) => {
  const values = await dlg.locator('input, textarea').evaluateAll((els) => els.map((e) => e.value));
  return `${await dlg.innerText()} ${values.join(' ')}`.replace(/\s+/g, ' ').trim();
};

/** Mediciones de TSK-726 sobre el diálogo abierto (contexto móvil). */
const measureDialog = async (page, scenario) => {
  const dlg = page.locator('[data-slot="dialog-content"]');
  const b = await dlg.boundingBox();
  const close = dlg.locator('[data-slot="dialog-close"]');
  const cb = await close.boundingBox();
  const closeVisible = await close.isVisible();
  const m = await page.evaluate(() => {
    const d = document.querySelector('[data-slot="dialog-content"]');
    const fs = d?.querySelector('fieldset');
    return {
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogOverflow: d ? d.scrollWidth - d.clientWidth : null,
      fieldsetOverflow: fs ? fs.scrollWidth - fs.clientWidth : 0,
    };
  });
  const ok =
    b && b.x >= 0 && b.x + b.width <= MOBILE_WIDTH &&
    m.innerWidth === MOBILE_WIDTH && m.scrollWidth <= m.innerWidth &&
    cb && cb.x >= 0 && cb.x + cb.width <= MOBILE_WIDTH && closeVisible &&
    m.dialogOverflow <= 0 && m.fieldsetOverflow <= 0;
  measures.push({
    escenario: scenario,
    x: b ? Math.round(b.x) : null,
    width: b ? Math.round(b.width) : null,
    right: b ? Math.round(b.x + b.width) : null,
    closeRight: cb ? Math.round(cb.x + cb.width) : null,
    innerWidth: m.innerWidth,
    scrollWidth: m.scrollWidth,
    desborde: `${m.dialogOverflow}/${m.fieldsetOverflow}`,
    ok,
  });
  check(`TSK-726 ${scenario}`, ok);
};

const measurePage = async (page, path, scenario, max, enforce) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  const ok = m.scrollWidth <= max;
  measures.push({ escenario: scenario, x: null, width: null, right: null, closeRight: null, ...m, desborde: '-', ok });
  if (enforce) check(`TSK-726 ${scenario} sin scroll horizontal`, ok, `scrollWidth ${m.scrollWidth}`);
  else console.log(`  info ${scenario}: scrollWidth ${m.scrollWidth} (no debe superar ${max}: ${ok ? 'OK' : 'EMPEORÓ'})`);
  if (!enforce && !ok) checks.push({ name: `${scenario} no empeora`, ok: false, detail: String(m.scrollWidth) });
};

/** Elige un tipo en el Select del modal de alta. */
const pickType = async (page, dlg, label) => {
  await dlg.locator('button[role="combobox"]').first().click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.waitForTimeout(500);
};

// --- Escritorio --------------------------------------------------------------
const desktopRun = async (page) => {
  console.log('\n== Escritorio 1440 ==');
  await gotoList(page);
  // A 1440 la tabla (con la barra lateral abierta) ya es más ancha que el panel y la página
  // scrollea en horizontal; es previo a este ticket. Se informa y las capturas del listado y
  // los menús se toman a 1600 para que se vea la tabla entera.
  const desktopScroll = await page.evaluate(() => document.documentElement.scrollWidth);
  console.log(`  info listado a 1440: scrollWidth ${desktopScroll}`);
  await page.setViewportSize({ width: LIST_SHOT_WIDTH, height: 900 });
  await page.waitForTimeout(500);
  const headers = (await page.locator('table thead th').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  console.log(`  encabezados: ${headers.join(' | ')}`);
  check('01 listado sin columna "Asiento"', !headers.some((h) => /asiento/i.test(h)));
  await shot(page, '01-listado-sin-asiento');

  let menu = await openRowMenu(page, DESC.aporte);
  let items = await menuItems(menu);
  check('02 menú de un confirmado: solo "Ver"', items.join('|') === 'Ver', items.join(' | '));
  await shot(page, '02-menu-confirmado', null, { clip: await menuClip(page, menu, DESC.aporte) });
  await page.keyboard.press('Escape');

  menu = await openRowMenu(page, DESC.retiro);
  items = await menuItems(menu);
  check('03 menú de un borrador: Ver, Confirmar, Editar, Eliminar', items.join('|') === 'Ver|Confirmar|Editar|Eliminar', items.join(' | '));
  await shot(page, '03-menu-borrador', null, { clip: await menuClip(page, menu, DESC.retiro) });
  await page.keyboard.press('Escape');

  // Diálogos con un viewport alto para que entren enteros en la captura
  await page.setViewportSize({ width: 1440, height: 1400 });

  const views = [
    ['04-ver-aporte-confirmado', DESC.aporte, ['Confirmado:', 'Confirmado el', 'Asiento N°', '36', 'María López', BANK_LABEL]],
    ['05-ver-retiro-borrador', DESC.retiro, ['Borrador:', 'Juan Perez', BANK_LABEL]],
    ['06-ver-transferencia-anulada', DESC.transferencia, ['Anulado:', BANK_LABEL, 'Caja ']],
    ['07-ver-gastos-bancarios', DESC.gastos, ['Asiento N°', '37', 'Comisión mantenimiento', 'IVA comisión', 'Sellado']],
    ['08-ver-snapshot-caja-socio', DESC.snapshot, ['Anulado:', SNAPSHOT_CASH_LABEL, SNAPSHOT_PARTNER_NAME]],
  ];
  for (const [name, desc, expected] of views) {
    const dlg = await openView(page, desc);
    const text = await dialogText(dlg);
    const missing = expected.filter((e) => !text.includes(e));
    check(`${name} muestra ${expected.join(', ')}`, missing.length === 0, missing.length ? `faltan: ${missing.join(', ')}` : '');
    const editButtons = await dlg.getByRole('button', { name: /Guardar|Agregar concepto/ }).count();
    check(`${name} sin Guardar ni Agregar concepto`, editButtons === 0);
    const closeBtn = await dlg.getByRole('button', { name: 'Cerrar', exact: true }).count();
    check(`${name} con botón Cerrar`, closeBtn === 1);

    if (name === '07-ver-gastos-bancarios') {
      // Vista no editable: triggers deshabilitados, un click no abre nada y el texto no queda al 50 %
      const typeTrigger = dlg.locator('button[role="combobox"]').first();
      check('07 Select de tipo deshabilitado', await typeTrigger.isDisabled());
      await typeTrigger.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
      check('07 click en el tipo no abre la lista', (await page.getByRole('listbox').count()) === 0);
      const accountTriggers = dlg.locator('fieldset button[role="combobox"]');
      const nAcc = await accountTriggers.count();
      const allDisabled = await accountTriggers.evaluateAll((els) => els.every((e) => e.disabled));
      check('07 todos los combobox del fieldset deshabilitados', nAcc >= 4 && allDisabled, `${nAcc} combobox`);
      await accountTriggers.last().click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
      check('07 click en una cuenta no abre el buscador', (await page.locator('[data-slot="popover-content"]').count()) === 0);
      const opacities = await dlg.locator('fieldset :disabled').evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).opacity))]);
      check('07 campos deshabilitados con opacidad 1 (D2)', opacities.length === 1 && opacities[0] === '1', opacities.join(','));
    }
    if (name === '08-ver-snapshot-caja-socio') {
      const triggers = (await dlg.locator('button[role="combobox"]').allInnerTexts()).map((t) => t.trim());
      check('08 la caja y el socio se ven por su nombre guardado (no el placeholder)',
        triggers.includes(SNAPSHOT_CASH_LABEL) && triggers.includes(SNAPSHOT_PARTNER_NAME), triggers.join(' | '));
    }
    await shot(page, name, dlg);
    await closeDialog(page);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoList(page);
  const pag = page.getByText(/^Mostrando \d+ a \d+ de \d+ registros$/).locator('xpath=..');
  await pag.scrollIntoViewIfNeeded();
  const pagBox = await pag.boundingBox();
  check('09 paginación de escritorio en una sola línea', pagBox && pagBox.height <= 40, `alto ${pagBox ? Math.round(pagBox.height) : '-'} px`);
  await shot(page, '09-paginacion-escritorio', pag);

  await page.goto(`${BASE}/dashboard/commercial/treasury/partners`, { waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  const pagPartners = page.getByText(/^Mostrando \d+ a \d+ de \d+ registros$/).locator('xpath=..');
  const pbox = await pagPartners.boundingBox();
  check('09b paginación de Socios en una sola línea', pbox && pbox.height <= 40, `alto ${pbox ? Math.round(pbox.height) : '-'} px`);
  await shot(page, '09b-paginacion-escritorio-socios', pagPartners);
};

// --- Celular -------------------------------------------------------------------
const mobileRun = async (page) => {
  console.log('\n== Celular 375 (isMobile) ==');
  await gotoList(page);

  // 10-13: modal de alta con cada tipo
  await page.getByRole('button', { name: /Nuevo Movimiento/ }).click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  const altas = [
    ['10-movil-alta-aporte', 'Aporte de socio'],
    ['11-movil-alta-retiro', 'Retiro de socio'],
    ['12-movil-alta-transferencia', 'Transferencia entre cuentas'],
    ['13-movil-alta-gastos', 'Gastos e impuestos bancarios'],
  ];
  for (const [name, label] of altas) {
    await pickType(page, dlg, label);
    if (label.startsWith('Gastos')) {
      const add = dlg.getByRole('button', { name: /Agregar concepto/ });
      if ((await dlg.locator('input[placeholder="Descripción"]').count()) === 0) await add.click();
      await page.waitForTimeout(400);
      await dlg.locator('input[placeholder="Descripción"]').first().fill('Comisión');
      await dlg.locator('input[placeholder="0,00"]').first().fill('1600');
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
      // Fila apilada: la cuenta ocupa toda la fila y debajo van descripción + importe
      const rows = await page.evaluate(() => {
        const desc = document.querySelector('[data-slot="dialog-content"] input[placeholder="Descripción"]');
        const row = desc?.parentElement;
        return row ? [...row.children].map((c) => Math.round(c.getBoundingClientRect().width)) : [];
      });
      console.log(`  fila de conceptos (anchos de hijos): ${rows.join(' / ')}`);
      await dlg.getByText('Conceptos', { exact: false }).first().scrollIntoViewIfNeeded();
    }
    await measureDialog(page, name);
    await shot(page, name);
  }
  await closeDialog(page);

  // 14-17: vista de los cuatro movimientos
  const vistas = [
    ['14-movil-ver-aporte', DESC.aporte],
    ['15-movil-ver-retiro', DESC.retiro],
    ['16-movil-ver-transferencia', DESC.transferencia],
    ['17-movil-ver-gastos', DESC.gastos],
  ];
  for (const [name, desc] of vistas) {
    await openView(page, desc);
    await measureDialog(page, name);
    if (name === '17-movil-ver-gastos') {
      await page.getByRole('dialog').getByText('Total', { exact: false }).last().scrollIntoViewIfNeeded();
    }
    await shot(page, name);
    await closeDialog(page);
  }

  // 18: listado sin modal + páginas vecinas (no deben empeorar)
  await gotoList(page);
  await measurePage(page, LIST_PATH, '18-movil-listado', MOBILE_WIDTH, true);
  await page.getByText(/^Mostrando \d+ a \d+ de \d+ registros$/).scrollIntoViewIfNeeded();
  await shot(page, '18-movil-listado');
  await measurePage(page, '/dashboard/commercial/treasury/partners', 'socios (antes 443)', 443, false);
  await measurePage(page, '/dashboard', 'dashboard (antes 491)', 491, false);
};

// =====================================================================
try {
  seed();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dpage = await desktop.newPage();
  await login(dpage);
  if (!SOLO_MOVIL) await desktopRun(dpage);
  const state = await desktop.storageState();
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: MOBILE_WIDTH, height: 812 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    storageState: state,
  });
  await mobileRun(await mobile.newPage());
  await mobile.close();

  console.log('\nMediciones en el celular (375×812, isMobile):');
  console.table(measures);
  const failed = checks.filter((c) => !c.ok);
  console.log(`\nChequeos: ${checks.length - failed.length}/${checks.length} OK`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.name} ${f.detail}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    cleanup();
  } catch (error) {
    console.error('No se pudo limpiar la siembra:', error);
    process.exitCode = 1;
  }
  await browser.close();
}
console.log(process.exitCode ? 'Terminó con errores.' : 'Listo.');
