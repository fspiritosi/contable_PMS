/**
 * Capturas y verificación en navegador del TSK-724c (cuentas de Bienes de Uso por
 * tipo de equipo / equipo, con las de Ajustes contables como "por defecto").
 *
 * Recorre: módulo Equipos visible (sidebar y Módulos), Ajustes contables, alta del
 * tipo "Rodados" con tres cuentas y "Maquinaria" sin cuentas, alta de dos equipos,
 * depreciación con la card "Cuentas contables", amortización individual (asiento),
 * override por equipo con aviso naranja, error legible en el equipo sin cuentas,
 * masiva con un error, baja por venta con asiento y baja rechazada.
 *
 * Uso:
 *   node scripts/guia-presentacion/capturas-tsk724c.mjs [baseUrl]              # recorrido completo
 *   node scripts/guia-presentacion/capturas-tsk724c.mjs [baseUrl] --solo-error # solo los toasts del
 *                                                        equipo sin cuentas (para el build de prod)
 *   node scripts/guia-presentacion/capturas-tsk724c.mjs [baseUrl] --solo-capturas # retoma 03 y 07
 *
 * Requiere el servidor corriendo y la base de dev. Modifica datos de la Empresa de
 * Prueba 01 SA: siembra por SQL las clasificaciones "Vehículos" y "Maquinaria"
 * (types_of_vehicles, no tienen ABM) y, para la baja por venta, carga temporalmente
 * la cuenta "Resultado por venta/baja de Bienes de Uso" (4.2.2/01/00) que se
 * restaura a NULL al final. Los tipos/equipos TSK724C-* quedan en la base; si ya
 * existen de una corrida anterior se borran (con sus asientos) al empezar.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const SOLO_ERROR = args.includes('--solo-error');
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY_ID = '02885d43-1358-4eb2-b774-c52d5be372f3';
const EQ1 = 'TSK724C-001'; // tipo Rodados (con cuentas)
const EQ2 = 'TSK724C-002'; // tipo Maquinaria (sin cuentas)

mkdirSync(OUT, { recursive: true });

const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -tAc "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  }).trim();

const acc = (code) =>
  psql(`select id from accounts where company_id='${COMPANY_ID}' and code='${code}' limit 1`);

const entryLines = (descLike) =>
  psql(
    `select je.number, a.code, a.name, l.debit, l.credit from journal_entry_lines l join journal_entries je on je.id=l.entry_id join accounts a on a.id=l.account_id where je.company_id='${COMPANY_ID}' and je.description like '${descLike}' order by je.number, l.debit desc`
  );

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
  await (locator ?? page).screenshot({ path: `${OUT}/tsk724c-${name}.png`, ...opts });
  console.log(`  ✓ ${name}`);
};

const clipAround = async (locator, pad = 12, extraBottom = 0) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const b = await locator.boundingBox();
  return {
    clip: {
      x: Math.max(b.x - pad, 0),
      y: Math.max(b.y - pad, 0),
      width: Math.min(b.width + pad * 2, 1500 - Math.max(b.x - pad, 0)),
      height: Math.min(b.height + pad * 2 + extraBottom, 950 - Math.max(b.y - pad, 0)),
    },
  };
};

const lastToast = async (ms = 2500) => {
  await page.waitForSelector('[data-sonner-toast]', { timeout: ms }).catch(() => {});
  const t = page.locator('[data-sonner-toast]').last();
  const text = (await t.innerText().catch(() => '(sin toast)')).replace(/\s+/g, ' ').trim();
  const type = await t.getAttribute('data-type').catch(() => null);
  return { text, type, locator: t };
};

/** Elige una cuenta en un AccountCombobox (botón role=combobox + cmdk). */
const pickAccount = async (triggerLocator, code) => {
  await triggerLocator.click();
  await page.waitForTimeout(400);
  const input = page.locator('[cmdk-input]').last();
  await input.fill(code);
  await page.waitForTimeout(400);
  await page.locator('[cmdk-item]').filter({ hasText: code }).first().click();
  await page.waitForTimeout(300);
};

/** Elige una opción en un Select de shadcn (trigger role=combobox → role=option). */
const pickSelect = async (triggerLocator, optionName) => {
  await triggerLocator.click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name: optionName, exact: true }).click();
  await page.waitForTimeout(300);
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

const vehicleId = (intern) =>
  psql(`select id from vehicles where company_id='${COMPANY_ID}' and intern_number='${intern}' limit 1`);

const gotoDepreciation = async (id) => {
  await page.goto(`${BASE}/dashboard/equipment/${id}?tab=depreciation`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
};

/** Click en el primer "Contabilizar" del cronograma y devuelve el toast. */
const postNextPeriod = async () => {
  const btn = page.getByRole('button', { name: 'Contabilizar', exact: true }).first();
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  await btn.click();
  await page.waitForTimeout(3000);
  return lastToast();
};

const shotAjustes = async () => {
  await page.goto(`${BASE}/dashboard/company/accounting/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const buTitle = page.getByText('Bienes de Uso (cuentas por defecto)').first();
  console.log('  sección visible:', (await buTitle.count()) > 0);
  if (await buTitle.count()) {
    await buTitle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const b = await buTitle.boundingBox();
    await shot('03-ajustes-bienes-de-uso', null, {
      clip: { x: Math.max(b.x - 40, 0), y: Math.max(b.y - 30, 0), width: 1500 - Math.max(b.x - 40, 0), height: Math.min(560, 950 - Math.max(b.y - 30, 0)) },
    });
    const labels = ['Cuenta de Bienes de Uso por defecto', 'Amortización acumulada por defecto', 'Gasto de amortización por defecto', 'Resultado por venta/baja de Bienes de Uso'];
    for (const l of labels) console.log(`  label "${l}":`, (await page.getByText(l, { exact: true }).count()) > 0);
  }
};

const shotAsiento = async () => {
  await page.goto(`${BASE}/dashboard/company/accounting/entries`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const entryRow = page.locator('table tbody tr').filter({ hasText: `Depreciación período 1: Equipo ${EQ1}` }).first();
  if (await entryRow.count()) {
    await entryRow.locator('button').first().click(); // chevron: expande las líneas
    await page.waitForTimeout(900);
    // La fila queda al final (orden desc): se baja todo y se recorta desde la fila hasta el pie
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);
    const rb = await entryRow.boundingBox();
    const top = Math.max(rb.y - 50, 0);
    await shot('07-asiento-amortizacion', null, {
      clip: { x: Math.max(rb.x - 8, 0), y: top, width: rb.width + 16, height: 950 - top },
    });
  } else {
    console.log('  ⚠ no se encontró la fila del asiento de amortización en el listado');
  }
};

// =====================================================================
// Modo --solo-error: solo el caso 7 (equipo sin cuentas) contra el build de prod
// =====================================================================
if (SOLO_ERROR) {
  const id2 = vehicleId(EQ2);
  if (!id2) {
    console.log(`No existe ${EQ2}: corré primero el recorrido completo.`);
    process.exit(1);
  }
  await login();
  await gotoDepreciation(id2);
  const toast = await postNextPeriod();
  console.log(`  toast [${toast.type}]: ${toast.text}`);
  await shot('14-prod-toast-sin-cuentas', null, { clip: { x: 0, y: 0, width: 1500, height: 950 } });
  console.log(
    '  períodos contabilizados de ' + EQ2 + ':',
    psql(
      `select count(*) from depreciation_schedule_entries e join vehicle_depreciations d on d.id=e.depreciation_id join vehicles v on v.id=d.vehicle_id where v.intern_number='${EQ2}' and e.is_posted`
    )
  );
  // Baja rechazada del mismo equipo (también debe llegar con el mensaje completo)
  await page.goto(`${BASE}/dashboard/equipment`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.getByTestId(`equipment-actions-${id2}`).click();
  await page.waitForTimeout(500);
  await page.getByTestId(`equipment-delete-${id2}`).click();
  await page.waitForTimeout(2500);
  await page.getByTestId('terminate-equipment-dialog').getByTestId('terminate-confirm-button').click();
  await page.waitForTimeout(3000);
  const toastBaja = await lastToast();
  console.log(`  toast baja [${toastBaja.type}]: ${toastBaja.text}`);
  console.log('  equipo sigue activo:', psql(`select is_active from vehicles where id='${id2}'`));
  await browser.close();
  console.log('Listo (solo error).');
  process.exit(0);
}

// =====================================================================
// Modo --solo-capturas: retoma 03 (Ajustes) y 07 (asiento) sin tocar datos
// =====================================================================
if (args.includes('--solo-capturas')) {
  await login();
  await shotAjustes();
  await shotAsiento();
  await browser.close();
  console.log('Listo (solo capturas).');
  process.exit(0);
}

// =====================================================================
// 0. Datos: limpiar corrida anterior y sembrar clasificaciones
// =====================================================================
console.log('Datos...');
const settingsBefore = psql(
  `select coalesce(fixed_asset_account_id::text,'NULL')||' '||coalesce(accumulated_depreciation_account_id::text,'NULL')||' '||coalesce(depreciation_expense_account_id::text,'NULL')||' '||coalesce(asset_disposal_gain_loss_account_id::text,'NULL') from accounting_settings where company_id='${COMPANY_ID}'`
);
console.log('  settings (BU, AA, gasto, resultado) antes:', settingsBefore);

// Limpieza de una corrida anterior (asientos → cronograma → depreciación → equipos → tipos)
psql(`delete from journal_entry_lines where entry_id in (select id from journal_entries where company_id='${COMPANY_ID}' and description like '%Equipo TSK724C-%')`);
psql(`delete from journal_entries where company_id='${COMPANY_ID}' and description like '%Equipo TSK724C-%'`);
psql(`delete from asset_value_adjustments where vehicle_id in (select id from vehicles where company_id='${COMPANY_ID}' and intern_number like 'TSK724C-%')`);
psql(`delete from depreciation_schedule_entries where depreciation_id in (select d.id from vehicle_depreciations d join vehicles v on v.id=d.vehicle_id where v.company_id='${COMPANY_ID}' and v.intern_number like 'TSK724C-%')`);
psql(`delete from vehicle_depreciations where vehicle_id in (select id from vehicles where company_id='${COMPANY_ID}' and intern_number like 'TSK724C-%')`);
psql(`delete from vehicles where company_id='${COMPANY_ID}' and intern_number like 'TSK724C-%'`);
psql(`delete from vehicle_types where company_id='${COMPANY_ID}' and name in ('Rodados','Maquinaria') and not exists (select 1 from vehicles v where v.type_id=vehicle_types.id)`);

// Clasificaciones (types_of_vehicles no tiene ABM: se siembran por SQL)
for (const name of ['Vehículos', 'Maquinaria']) {
  psql(
    `insert into types_of_vehicles (name, company_id, updated_at) select '${name}', '${COMPANY_ID}', now() where not exists (select 1 from types_of_vehicles where company_id='${COMPANY_ID}' and name='${name}')`
  );
}
console.log('  clasificaciones:', psql(`select string_agg(name, ', ') from types_of_vehicles where company_id='${COMPANY_ID}'`));

await login();

// =====================================================================
// 1. Módulo visible: sidebar y Módulos
// =====================================================================
console.log('Módulo Equipos visible...');
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const sidebarLink = page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: 'Equipos' }).first();
console.log('  sidebar tiene "Equipos":', (await sidebarLink.count()) > 0);
await shot('01-sidebar-equipos', page.locator('[data-sidebar="sidebar"]').first());

await page.goto(`${BASE}/dashboard/company/modules`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
const equiposCard = page.locator('[data-slot="card"], .rounded-xl').filter({ has: page.getByText('Equipos', { exact: true }) }).first();
console.log('  Módulos lista "Equipos":', (await page.getByText('Equipos', { exact: true }).count()) > 0);
if (await equiposCard.count()) {
  await shot('02-modulos-equipos', null, await clipAround(equiposCard, 16));
} else {
  await shot('02-modulos-equipos', null, { clip: { x: 0, y: 0, width: 1500, height: 950 } });
}

// =====================================================================
// 2. Ajustes contables: sección "Bienes de Uso (cuentas por defecto)"
// =====================================================================
console.log('Ajustes contables...');
await shotAjustes();

// =====================================================================
// 3. Tipos de equipo: "Rodados" con cuentas, "Maquinaria" sin cuentas
// =====================================================================
console.log('Tipos de equipo...');
await page.goto(`${BASE}/dashboard/company/vehicle-types`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.getByTestId('new-vehicle-type-button').first().click();
await page.waitForTimeout(800);
const typeModal = page.getByTestId('vehicle-type-form-modal');
await typeModal.getByTestId('vehicle-type-name-input').fill('Rodados');
await page.waitForTimeout(1200); // espera a que carguen las cuentas
await pickAccount(page.locator('#vehicle-type-fixedAssetAccountId'), '1.2.2/04/01');
await pickAccount(page.locator('#vehicle-type-accumulatedDepreciationAccountId'), '1.2.2/04/03');
await pickAccount(page.locator('#vehicle-type-depreciationExpenseAccountId'), '4.2.1/02/10');
await shot('04-tipo-rodados-modal', typeModal);
await typeModal.getByTestId('vehicle-type-submit-button').click();
await page.waitForTimeout(2500);
console.log('  toast:', (await lastToast()).text);

await page.getByTestId('new-vehicle-type-button').first().click();
await page.waitForTimeout(800);
await page.getByTestId('vehicle-type-form-modal').getByTestId('vehicle-type-name-input').fill('Maquinaria');
await page.getByTestId('vehicle-type-form-modal').getByTestId('vehicle-type-submit-button').click();
await page.waitForTimeout(2500);
console.log('  toast:', (await lastToast()).text);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await shot('05-tipos-listado-cuentas', page.locator('table').first());
console.log('  tipos:', psql(`select name, (fixed_asset_account_id is not null)::int + (accumulated_depreciation_account_id is not null)::int + (depreciation_expense_account_id is not null)::int as cuentas from vehicle_types where company_id='${COMPANY_ID}' and name in ('Rodados','Maquinaria') order by name`));

// =====================================================================
// 4. Equipos: alta por UI + depreciación
// =====================================================================
const createEquipment = async ({ intern, domain, clasificacion, tipo, engine }) => {
  await page.goto(`${BASE}/dashboard/equipment/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const combos = page.getByRole('combobox');
  await pickSelect(combos.nth(0), clasificacion); // Clasificación *
  await pickSelect(combos.nth(1), tipo); // Tipo de equipo *
  await page.getByPlaceholder('Ej: 001').fill(intern);
  await page.getByPlaceholder('Ej: AB123CD').fill(domain);
  await page.getByTestId('equipment-engine-input').fill(engine);
  await page.getByTestId('equipment-year-input').fill('2024');
  await page.getByTestId('equipment-submit-button').click();
  await page.waitForURL(/\/dashboard\/equipment(\?|$)/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const id = vehicleId(intern);
  console.log(`  equipo ${intern}: ${id || 'NO CREADO'}`);
  return id;
};

const configureDepreciation = async ({ grossValue, months, startDate }) => {
  await page.getByRole('button', { name: 'Configurar Depreciación' }).click();
  await page.waitForTimeout(800);
  const dlg = page.getByRole('dialog');
  await dlg.locator('input[name="grossValue"]').fill(String(grossValue));
  await dlg.locator('#usefulLifeMonths').fill(String(months));
  await dlg.locator('#startDate').fill(startDate);
  await page.waitForTimeout(300);
  await dlg.getByRole('button', { name: /Guardar|Crear|Configurar/ }).last().click();
  await page.waitForTimeout(3000);
  console.log('  toast:', (await lastToast()).text);
};

const startDate = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 3, 1); // 1° de hace 3 meses → 3 o 4 períodos pendientes
  return d.toISOString().slice(0, 10);
})();

console.log('Equipo Rodados + depreciación...');
const id1 = await createEquipment({ intern: EQ1, domain: 'AB123CD', clasificacion: 'Vehículos', tipo: 'Rodados', engine: 'MOT-724C-001' });
await gotoDepreciation(id1);
await configureDepreciation({ grossValue: 1200000, months: 60, startDate });
await page.waitForTimeout(1500);
const accountsCard = page.locator('[data-slot="card"], .rounded-xl').filter({ has: page.getByText('Cuentas contables', { exact: true }) }).first();
await shot('06-card-cuentas-del-tipo', null, await clipAround(accountsCard, 12));
console.log((await accountsCard.innerText()).split('\n').filter((l) => /1\.2\.2|4\.2\.1|del tipo|por defecto/.test(l)).map((l) => '     ' + l).join('\n'));

// =====================================================================
// 5. Amortizar un período → asiento con las cuentas del tipo
// =====================================================================
console.log('Contabilizar período 1...');
const t1 = await postNextPeriod();
console.log(`  toast [${t1.type}]: ${t1.text}`);
await shotAsiento();
console.log('  SQL asiento período 1:\n' + entryLines(`Depreciación período 1: Equipo ${EQ1}`).split('\n').map((l) => '     ' + l).join('\n'));

// =====================================================================
// 6. Override por equipo: otra acumulada → aviso naranja → siguiente período la usa
// =====================================================================
console.log('Override de cuentas...');
await gotoDepreciation(id1);
await page.getByRole('button', { name: 'Editar cuentas' }).click();
await page.waitForTimeout(1500);
const accDlg = page.getByRole('dialog').filter({ hasText: 'Cuentas contables del equipo' });
await pickAccount(accDlg.locator('#account-accumulatedDepreciation'), '1.2.2/02/03');
await page.waitForTimeout(600);
console.log('  aviso naranja visible:', (await accDlg.getByText(/período\(s\) contabilizado\(s\)/).count()) > 0);
await shot('08-override-aviso-naranja', accDlg);
await accDlg.getByRole('button', { name: 'Guardar' }).click();
await page.waitForTimeout(2500);
console.log('  toast:', (await lastToast()).text);
await page.waitForTimeout(1500);
const accountsCard2 = page.locator('[data-slot="card"], .rounded-xl').filter({ has: page.getByText('Cuentas contables', { exact: true }) }).first();
await shot('09-card-cuentas-override', null, await clipAround(accountsCard2, 12));
const t2 = await postNextPeriod();
console.log(`  toast [${t2.type}]: ${t2.text}`);
console.log('  SQL asiento período 2:\n' + entryLines(`Depreciación período 2: Equipo ${EQ1}`).split('\n').map((l) => '     ' + l).join('\n'));

// =====================================================================
// 7. Equipo sin cuentas (tipo Maquinaria, globales en NULL) → error legible
// =====================================================================
console.log('Equipo Maquinaria sin cuentas...');
const id2 = await createEquipment({ intern: EQ2, domain: 'MQ-724C', clasificacion: 'Maquinaria', tipo: 'Maquinaria', engine: 'MOT-724C-002' });
await gotoDepreciation(id2);
await configureDepreciation({ grossValue: 500000, months: 36, startDate });
await page.waitForTimeout(1500);
const t3 = await postNextPeriod();
console.log(`  toast [${t3.type}]: ${t3.text}`);
await shot('10-toast-error-sin-cuentas', null, { clip: { x: 0, y: 0, width: 1500, height: 950 } });
console.log(
  '  períodos contabilizados de ' + EQ2 + ':',
  psql(`select count(*) from depreciation_schedule_entries e join vehicle_depreciations d on d.id=e.depreciation_id where d.vehicle_id='${id2}' and e.is_posted`)
);

// =====================================================================
// 8. Masiva con los dos equipos → uno se contabiliza, el otro en la lista de errores
// =====================================================================
console.log('Contabilización masiva...');
await page.goto(`${BASE}/dashboard/equipment`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.getByRole('button', { name: /Contabilizar Depreciaciones/ }).click();
await page.waitForTimeout(2500);
const bulk = page.getByRole('dialog').filter({ hasText: 'Contabilizar Depreciaciones' });
console.log('  aviso previo "se van a omitir":', (await bulk.getByText(/se van a omitir/).count()) > 0);
await shot('11a-masiva-aviso-previo', bulk);
await bulk.getByRole('button', { name: /^Contabilizar \d+ período/ }).click();
await page.waitForTimeout(4000);
console.log('  toast:', (await lastToast()).text);
await shot('11-masiva-errores', bulk);
console.log((await bulk.innerText()).split('\n').filter((l) => /no se pudieron|TSK724C/.test(l)).map((l) => '     ' + l).join('\n'));
await bulk.getByRole('button', { name: 'Cerrar' }).click().catch(() => page.keyboard.press('Escape'));
console.log(
  '  posteados:',
  psql(`select v.intern_number, count(*) filter (where e.is_posted) as posteados, count(*) as total from depreciation_schedule_entries e join vehicle_depreciations d on d.id=e.depreciation_id join vehicles v on v.id=d.vehicle_id where v.intern_number like 'TSK724C-%' group by v.intern_number order by 1`)
);

// =====================================================================
// 9. Baja por venta (Rodados, desde el detalle) y baja rechazada (Maquinaria, desde el listado)
// =====================================================================
console.log('Baja por venta...');
// La baja necesita la cuenta de resultado global: se carga solo para este caso y se restaura al final.
psql(`update accounting_settings set asset_disposal_gain_loss_account_id='${acc('4.2.2/01/00')}' where company_id='${COMPANY_ID}'`);
await page.goto(`${BASE}/dashboard/equipment/${id1}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.getByTestId('terminate-equipment-button').click();
await page.waitForTimeout(2500);
const termDlg = page.getByTestId('terminate-equipment-dialog');
console.log((await termDlg.innerText()).split('\n').filter((l) => /asiento/.test(l)).map((l) => '     ' + l).join('\n'));
await shot('12-baja-dialogo-cuentas', termDlg);
await termDlg.getByTestId('terminate-confirm-button').click();
await page.waitForTimeout(3500);
const t4 = await lastToast();
console.log(`  toast [${t4.type}]: ${t4.text}`);
console.log('  SQL asiento de baja:\n' + entryLines(`Baja por venta de bien de uso: Equipo ${EQ1}`).split('\n').map((l) => '     ' + l).join('\n'));
console.log('  equipo:', psql(`select is_active, termination_reason from vehicles where id='${id1}'`), '| depreciación:', psql(`select status from vehicle_depreciations where vehicle_id='${id1}'`));

console.log('Baja rechazada (Maquinaria sin cuentas)...');
await page.goto(`${BASE}/dashboard/equipment`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.getByTestId(`equipment-actions-${id2}`).click();
await page.waitForTimeout(500);
await page.getByTestId(`equipment-delete-${id2}`).click();
await page.waitForTimeout(2500);
const termDlg2 = page.getByTestId('terminate-equipment-dialog');
console.log('  aviso "La baja va a fallar":', (await termDlg2.getByTestId('terminate-notice-missing').count()) > 0);
console.log((await termDlg2.innerText()).split('\n').filter((l) => /fallar|asiento/.test(l)).map((l) => '     ' + l).join('\n'));
await termDlg2.getByTestId('terminate-confirm-button').click();
await page.waitForTimeout(3000);
const t5 = await lastToast();
console.log(`  toast [${t5.type}]: ${t5.text}`);
await shot('13-baja-rechazada', null, { clip: { x: 0, y: 0, width: 1500, height: 950 } });
console.log('  equipo sigue activo:', psql(`select is_active from vehicles where id='${id2}'`));
await page.keyboard.press('Escape');

// =====================================================================
// 10. Restaurar settings
// =====================================================================
psql(`update accounting_settings set asset_disposal_gain_loss_account_id=null where company_id='${COMPANY_ID}'`);
console.log(
  'settings (BU, AA, gasto, resultado) después:',
  psql(`select coalesce(fixed_asset_account_id::text,'NULL')||' '||coalesce(accumulated_depreciation_account_id::text,'NULL')||' '||coalesce(depreciation_expense_account_id::text,'NULL')||' '||coalesce(asset_disposal_gain_loss_account_id::text,'NULL') from accounting_settings where company_id='${COMPANY_ID}'`)
);

await browser.close();
console.log('Listo.');
