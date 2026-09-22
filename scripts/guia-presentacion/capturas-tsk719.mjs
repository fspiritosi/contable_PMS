/**
 * Capturas y verificación en navegador del TSK-719 (Movimientos por Centro de Costo).
 *
 * Recorre, sobre la Empresa de Prueba 01 SA:
 *   01 Informe antes de registrar nada        → empty state + aviso de borradores
 *   02 Un centro con asientos registrados     → detalle (Fecha|Asiento|Cuenta|Descripción|Entrada|Salida|Saldo)
 *   03 Tarjetas de totales del mismo centro
 *   04 "Todos los centros"                    → comparativa, una fila por centro, una expandida
 *   05 "(Sin centro de costo)"                → líneas de resultado no imputadas
 *   06 Switch "Incluir borradores" ON         → cambia el total y aparece la columna Estado
 *   07 Aviso de borradores (switch OFF)       → recorte del aviso naranja
 *   08 Nota de crédito                        → la fila que RESTA de las entradas
 *   09 Deep-link desde Empresa → Centros de Costo → "Ver movimientos"
 *   10 (modo --prod) el informe y el deep-link contra el build de producción (:3011)
 *
 * Uso:
 *   node scripts/guia-presentacion/capturas-tsk719.mjs [baseUrl]           # recorrido completo (dev :3010)
 *   node scripts/guia-presentacion/capturas-tsk719.mjs [baseUrl] --prod    # solo 10 (build de prod :3011)
 *   node scripts/guia-presentacion/capturas-tsk719.mjs --seed              # solo siembra, sin navegador
 *   node scripts/guia-presentacion/capturas-tsk719.mjs [baseUrl] --no-seed # no re-siembra (retoma)
 *
 * Siembra (idempotente, por SQL, marcada con el prefijo 'TSK719-demo' en la
 * descripción del asiento): un centro de costo nuevo "Administración" y seis
 * asientos bien formados en septiembre de 2026 — venta con reparto, compra con
 * reparto, nota de crédito de venta, gastos SIN centro, gasto de Administración
 * y una compra que queda **en borrador** a propósito para lucir el aviso.
 * Los asientos POSTED son inmutables (trigger trg_journal_entry_immutable), así
 * que la limpieza de una corrida anterior se hace dentro de una transacción con
 * SET LOCAL session_replication_role = 'replica' (mismo recurso que el test de
 * integración de la fase 3).
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const CRUCE = args.includes('--cruce'); // solo el cruce contra el Libro Mayor
const SEED_ONLY = args.includes('--seed');
const NO_SEED = args.includes('--no-seed');
const BASE =
  args.find((a) => !a.startsWith('--')) ??
  (PROD ? 'http://localhost:3011' : 'http://localhost:3010');
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY_ID = '02885d43-1358-4eb2-b774-c52d5be372f3';
const USER_ID = '848d69ff-198d-4588-975e-d3691ea2333f';
const MARK = 'TSK719-demo';
const FROM = '2026-09-01';
const TO = '2026-09-30';
const REPORTS = '/dashboard/company/accounting/reports';

mkdirSync(OUT, { recursive: true });

const psql = (sql) =>
  execSync(
    `docker exec contable-pms-db psql -U postgres -d contable_pms -qtAc "${sql.replace(/"/g, '\\"')}"`,
    {
      encoding: 'utf8',
    }
  ).trim();

const acc = (code) =>
  psql(`select id from accounts where company_id='${COMPANY_ID}' and code='${code}' limit 1`);
const center = (name) =>
  psql(`select id from cost_centers where company_id='${COMPANY_ID}' and name='${name}' limit 1`);
const indent = (text) =>
  text
    .split('\n')
    .map((l) => '     ' + l)
    .join('\n');

// =====================================================================
// Siembra
// =====================================================================

/** Borra los asientos de una corrida anterior, incluso los POSTED (trigger). */
const wipeDemoEntries = () => {
  const ids = psql(
    `select string_agg(id::text, ',') from journal_entries where company_id='${COMPANY_ID}' and description like '${MARK}%'`
  );
  if (!ids) return 0;
  const list = ids
    .split(',')
    .map((id) => `'${id}'`)
    .join(',');
  psql(
    `begin; set local session_replication_role = 'replica'; delete from journal_entry_lines where entry_id in (${list}); delete from journal_entries where id in (${list}); commit;`
  );
  return ids.split(',').length;
};

/**
 * Crea un asiento con sus líneas. `lines` = [{ code, debit, credit, cc, desc }].
 * `cc` es el nombre del centro de costo (o null).
 */
const seedEntry = ({ number, date, description, status, lines }) => {
  const entryId = psql(
    `insert into journal_entries (company_id, number, date, description, status, created_by, updated_at${status === 'POSTED' ? ', post_date' : ''}) values ('${COMPANY_ID}', ${number}, '${date}', '${description}', '${status}', '${USER_ID}', now()${status === 'POSTED' ? ', now()' : ''}) returning id`
  );
  for (const line of lines) {
    const ccId = line.cc ? center(line.cc) : null;
    psql(
      `insert into journal_entry_lines (entry_id, account_id, description, debit, credit, cost_center_id) values ('${entryId}', '${acc(line.code)}', '${line.desc}', ${line.debit ?? 0}, ${line.credit ?? 0}, ${ccId ? `'${ccId}'` : 'NULL'})`
    );
  }
  return entryId;
};

const seed = () => {
  const wiped = wipeDemoEntries();
  if (wiped) console.log(`  (limpieza) ${wiped} asientos ${MARK}* de una corrida anterior`);

  // Tercer centro, para que la comparativa tenga más de dos filas
  if (!center('Administración')) {
    psql(
      `insert into cost_centers (name, is_active, company_id, updated_at) values ('Administración', true, '${COMPANY_ID}', now())`
    );
    console.log('  centro de costo "Administración" creado');
  }
  psql(`update cost_centers set is_active=true where company_id='${COMPANY_ID}'`);

  let n = Number(
    psql(
      `select coalesce(max(number),0)+1 from journal_entries where company_id='${COMPANY_ID}' and number < 999999`
    )
  );

  // 1) Venta con reparto — queda DRAFT: se registra desde la UI (paso del plan)
  seedEntry({
    number: n++,
    date: '2026-09-03',
    description: `${MARK} Factura de venta 0001-00000101`,
    status: 'DRAFT',
    lines: [
      { code: '1.1.3/01/01', debit: 605000, desc: 'Cliente Demo SA' },
      { code: '4.1.1/01/01', credit: 300000, cc: 'Logística', desc: 'Servicio de logística' },
      {
        code: '4.1.1/01/02',
        credit: 200000,
        cc: 'Mantenimiento',
        desc: 'Servicio de mantenimiento',
      },
      { code: '2.1.3/01/01', credit: 105000, desc: 'IVA 21%' },
    ],
  });

  // 2) Compra con reparto
  seedEntry({
    number: n++,
    date: '2026-09-05',
    description: `${MARK} Factura de compra 0001-00000205`,
    status: 'POSTED',
    lines: [
      { code: '4.2.1/02/23', debit: 150000, cc: 'Logística', desc: 'Gasoil flota' },
      { code: '4.2.1/02/22', debit: 90000, cc: 'Mantenimiento', desc: 'Repuestos taller' },
      { code: '1.1.4/01/05', debit: 50400, desc: 'IVA 21%' },
      { code: '2.1.1/02/01', credit: 290400, desc: 'Distribuidora de Combustibles SRL' },
    ],
  });

  // 3) Nota de crédito de venta: DEBITA una cuenta REVENUE → resta de las entradas
  seedEntry({
    number: n++,
    date: '2026-09-12',
    description: `${MARK} Nota de crédito de venta 0003-00000007`,
    status: 'POSTED',
    lines: [
      {
        code: '4.1.1/01/01',
        debit: 50000,
        cc: 'Logística',
        desc: 'Devolución servicio de logística',
      },
      { code: '2.1.3/01/01', debit: 10500, desc: 'IVA 21%' },
      { code: '1.1.3/01/01', credit: 60500, desc: 'Cliente Demo SA' },
    ],
  });

  // 4) Gastos de resultado SIN centro imputado
  seedEntry({
    number: n++,
    date: '2026-09-10',
    description: `${MARK} Gastos administrativos sin imputar`,
    status: 'POSTED',
    lines: [
      { code: '4.2.1/03/10', debit: 45000, desc: 'Gastos varios de oficina' },
      { code: '4.2.1/03/07', debit: 12000, desc: 'Resma de papel y tóner' },
      { code: '2.1.1/02/01', credit: 57000, desc: 'Proveedor varios' },
    ],
  });

  // 5) Gasto del tercer centro
  seedEntry({
    number: n++,
    date: '2026-09-15',
    description: `${MARK} Energía de oficinas`,
    status: 'POSTED',
    lines: [
      { code: '4.2.1/02/03', debit: 35000, cc: 'Administración', desc: 'Factura de energía' },
      { code: '2.1.1/02/01', credit: 35000, desc: 'Edenor' },
    ],
  });

  // 6) Compra que queda EN BORRADOR a propósito (aviso del informe)
  seedEntry({
    number: n++,
    date: '2026-09-18',
    description: `${MARK} Factura de compra 0001-00000206 (sin registrar)`,
    status: 'DRAFT',
    lines: [
      { code: '4.2.1/02/22', debit: 80000, cc: 'Mantenimiento', desc: 'Service de grúa' },
      { code: '2.1.1/02/01', credit: 80000, desc: 'Taller Mecánico SRL' },
    ],
  });

  console.log(
    '  sembrados 6 asientos TSK719-demo (1 venta DRAFT para registrar por UI, 4 POSTED, 1 DRAFT final)'
  );
};

/** Suma entradas/salidas/saldo por centro con la MISMA regla del helper, pero en SQL. */
const sqlTotals = (status = "'POSTED'") =>
  psql(
    `select coalesce(cc.name,'(Sin centro de costo)'),
            sum(case when a.nature='CREDIT' then l.credit - l.debit else 0 end) as entradas,
            sum(case when a.nature='DEBIT' then l.debit - l.credit else 0 end) as salidas,
            sum(case when a.nature='CREDIT' then l.credit - l.debit else -(l.debit - l.credit) end) as saldo
     from journal_entry_lines l
     join journal_entries je on je.id=l.entry_id
     join accounts a on a.id=l.account_id
     left join cost_centers cc on cc.id=l.cost_center_id
     where je.company_id='${COMPANY_ID}' and je.status in (${status})
       and je.date >= '${FROM}' and je.date < '2026-10-01'
       and (l.cost_center_id is not null or a.type in ('REVENUE','EXPENSE'))
     group by 1 order by 1`
  );

const sqlLines = (centerName) =>
  psql(
    `select je.number, je.date::date, je.status, a.code, a.name, a.nature, l.debit, l.credit
     from journal_entry_lines l
     join journal_entries je on je.id=l.entry_id
     join accounts a on a.id=l.account_id
     join cost_centers cc on cc.id=l.cost_center_id
     where je.company_id='${COMPANY_ID}' and cc.name='${centerName}'
       and je.date >= '${FROM}' and je.date < '2026-10-01'
     order by je.date, je.number`
  );

if (SEED_ONLY) {
  seed();
  console.log('\nSQL POSTED por centro (entradas|salidas|saldo):');
  console.log(indent(sqlTotals()));
  process.exit(0);
}

// =====================================================================
// Navegador
// =====================================================================
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const hideNextBadge = () =>
  page
    .evaluate(() => {
      document
        .querySelectorAll(
          'nextjs-portal, [data-next-badge-root], #next-logo, .tsqd-parent-container'
        )
        .forEach((el) => el.remove());
    })
    .catch(() => {});

const shot = async (name, locator, opts = {}) => {
  await page.waitForTimeout(700);
  await hideNextBadge();
  await (locator ?? page).screenshot({ path: `${OUT}/tsk719-${name}.png`, ...opts });
  console.log(`  ✓ ${name}`);
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

/** La card del informe (lo que se captura en casi todos los pasos). */
const reportCard = () =>
  page.locator('[data-slot="card"]').filter({ hasText: 'Movimientos por Centro de Costo' }).last();

const openReport = async (query = '?report=cost-center-movements') => {
  await page.goto(`${BASE}${REPORTS}${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
};

const setPeriod = async (from = FROM, to = TO) => {
  await page.fill('#fromDate', from);
  await page.fill('#toDate', to);
};

const pickCenter = async (label) => {
  await page.locator('#costCenter').click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.waitForTimeout(400);
};

const generate = async () => {
  await page.getByRole('button', { name: 'Generar', exact: true }).click();
  await page.waitForTimeout(2500);
};

/** Vuelca a consola lo que muestra la pantalla: totales, aviso, empty y filas. */
const describeReport = async () => {
  const cards = await page
    .locator('.grid.gap-3 > div.rounded-md.border')
    .allInnerTexts()
    .catch(() => []);
  if (cards.length)
    console.log(indent('Tarjetas: ' + cards.map((c) => c.replace(/\n/g, ' = ')).join(' | ')));
  const notice = page.locator('[data-testid="cost-center-movements-drafts-notice"]');
  if (await notice.count())
    console.log(indent('AVISO: ' + (await notice.innerText()).replace(/\s+/g, ' ').trim()));
  const empty = page.locator('[data-testid="cost-center-movements-empty"]');
  if (await empty.count())
    console.log(indent('EMPTY: ' + (await empty.innerText()).replace(/\s+/g, ' ').trim()));
  const rows = await page
    .locator('table tbody tr')
    .allInnerTexts()
    .catch(() => []);
  for (const r of rows) console.log(indent('| ' + r.replace(/\n/g, ' | ')));
  return { cards, rows };
};

// =====================================================================
// Modo --cruce: el informe contra el Libro Mayor de las mismas cuentas
// =====================================================================
if (CRUCE) {
  try {
    await login();
    console.log('Cruce con el Libro Mayor (septiembre 2026, solo POSTED)...');
    await page.goto(`${BASE}${REPORTS}?report=general-ledger`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await setPeriod();
    await page.getByRole('button', { name: 'Generar', exact: true }).click();
    await page.waitForTimeout(3000);
    const wanted = [
      '4.1.1/01/01',
      '4.1.1/01/02',
      '4.2.1/02/23',
      '4.2.1/02/22',
      '4.2.1/02/03',
      '4.2.1/03/10',
      '4.2.1/03/07',
    ];
    const rows = await page.locator('table tbody tr').allInnerTexts();
    for (const r of rows) {
      const flat = r.replace(/\n/g, ' | ').trim();
      if (wanted.some((code) => flat.startsWith(code))) console.log(indent('MAYOR | ' + flat));
    }
    console.log('\nSQL por cuenta de resultado (POSTED, septiembre) con y sin centro:');
    console.log(
      indent(
        psql(
          `select a.code, a.name, a.nature, sum(l.debit) debe, sum(l.credit) haber,
                  sum(case when l.cost_center_id is not null then l.debit - l.credit else 0 end) con_centro,
                  sum(case when l.cost_center_id is null then l.debit - l.credit else 0 end) sin_centro
           from journal_entry_lines l join journal_entries je on je.id=l.entry_id join accounts a on a.id=l.account_id
           where je.company_id='${COMPANY_ID}' and je.status='POSTED' and je.date >= '${FROM}' and je.date < '2026-10-01'
             and a.type in ('REVENUE','EXPENSE') group by 1,2,3 order by 1`
        )
      )
    );
  } finally {
    await browser.close();
  }
  process.exit(0);
}

// =====================================================================
// Modo --prod: el informe y el deep-link contra el build de producción
// =====================================================================
if (PROD) {
  try {
    await login();
    console.log('10. Informe + deep-link contra el build de producción...');
    const logisticaId = center('Logística');
    await openReport(`?report=cost-center-movements&costCenterId=${logisticaId}`);
    await page.waitForTimeout(2500);
    console.log('  URL:', page.url());
    await describeReport();
    await shot('10-prod-deep-link', reportCard());
    await setPeriod();
    await generate();
    await describeReport();
    await shot('10b-prod-periodo', reportCard());
  } finally {
    await browser.close();
  }
  process.exit(0);
}

// =====================================================================
// Recorrido completo (dev)
// =====================================================================
try {
  if (!NO_SEED) {
    console.log('Siembra...');
    seed();
  }

  await login();

  // ---------------------------------------------------------------
  // Agosto: el único asiento que toca Logística ahí es el N° 8 de TSK-583, y
  // está en borrador. Es el escenario con el que se encuentra la clienta.
  console.log('\n01. Informe sin nada registrado (agosto, Logística: solo borradores)...');
  await openReport();
  await setPeriod('2026-08-01', '2026-08-31');
  await pickCenter('Logística');
  await generate();
  await describeReport();
  await shot('01-solo-borradores', reportCard());

  console.log('\n01b. Septiembre antes de registrar la venta (Todos los centros)...');
  await openReport();
  await setPeriod();
  await pickCenter('Todos los centros');
  await generate();
  await describeReport();
  await shot('01b-septiembre-previo', reportCard());

  // ---------------------------------------------------------------
  console.log('\n-- Registrar el asiento de la factura de venta desde la UI --');
  const ventaStatus = psql(
    `select status from journal_entries where company_id='${COMPANY_ID}' and description='${MARK} Factura de venta 0001-00000101'`
  );
  if (ventaStatus !== 'DRAFT') {
    console.log(`  (ya estaba ${ventaStatus}: se omite el registro por UI)`);
  } else {
    await page.goto(`${BASE}/dashboard/company/accounting/entries`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(4000);
    const row = page
      .locator('table tbody tr')
      .filter({ hasText: 'Factura de venta 0001-00000101' })
      .first();
    await row.waitFor({ state: 'visible', timeout: 20000 });
    await row.locator('button').last().click();
    await page.waitForTimeout(500);
    await page.getByRole('menuitem', { name: /Registrar/ }).click();
    await page.waitForTimeout(800);
    const dlg = page.getByRole('alertdialog');
    if (await dlg.count()) {
      console.log(indent((await dlg.innerText()).replace(/\n+/g, ' | ')));
      await dlg
        .getByRole('button', { name: /Registrar|Confirmar|Continuar/ })
        .first()
        .click();
    }
    await page.waitForTimeout(2500);
    const toasts = await page
      .locator('[data-sonner-toast]')
      .allInnerTexts()
      .catch(() => []);
    for (const t of toasts) console.log('  toast: ' + t.replace(/\n/g, ' '));
    console.log(
      '  estado en base: ' +
        psql(
          `select status from journal_entries where company_id='${COMPANY_ID}' and description='${MARK} Factura de venta 0001-00000101'`
        )
    );
  }

  // ---------------------------------------------------------------
  console.log('\n02/03. Un centro (Logística) con asientos registrados...');
  await openReport();
  await setPeriod();
  await pickCenter('Logística');
  await generate();
  await describeReport();
  await shot('02-detalle-centro', reportCard());
  const summary = page.locator('.grid.gap-3').first();
  await shot('03-totales', summary);

  console.log('\n  SQL directo (POSTED, septiembre) por centro:');
  console.log(indent(sqlTotals()));
  console.log('  SQL líneas de Logística:');
  console.log(indent(sqlLines('Logística')));

  // ---------------------------------------------------------------
  console.log('\n04. Todos los centros (comparativa, una fila expandida)...');
  await openReport();
  await setPeriod();
  await pickCenter('Todos los centros');
  await generate();
  await page.locator(`[data-testid="cost-center-group-${center('Mantenimiento')}"]`).click();
  await page.waitForTimeout(800);
  await describeReport();
  await shot('04-todos-los-centros', reportCard());

  // ---------------------------------------------------------------
  console.log('\n05. (Sin centro de costo)...');
  await openReport();
  await setPeriod();
  await pickCenter('(Sin centro de costo)');
  await generate();
  await describeReport();
  await shot('05-sin-centro', reportCard());

  // ---------------------------------------------------------------
  console.log('\n06/07. Switch "Incluir borradores" sobre Mantenimiento...');
  await openReport();
  await setPeriod();
  await pickCenter('Mantenimiento');
  await generate();
  console.log('  -- sin borradores --');
  await describeReport();
  await shot('07-aviso-borradores', reportCard());
  await page.locator('[data-testid="cost-center-movements-include-drafts"]').click();
  await page.waitForTimeout(300);
  await generate();
  console.log('  -- con borradores --');
  await describeReport();
  await shot('06-con-borradores', reportCard());

  // ---------------------------------------------------------------
  console.log('\n08. Nota de crédito: resta de las entradas...');
  console.log('  SQL de la NC:');
  console.log(
    indent(
      psql(
        `select je.number, je.status, a.code, a.name, a.nature, l.debit, l.credit, cc.name from journal_entry_lines l join journal_entries je on je.id=l.entry_id join accounts a on a.id=l.account_id left join cost_centers cc on cc.id=l.cost_center_id where je.description='${MARK} Nota de crédito de venta 0003-00000007' order by l.debit desc`
      )
    )
  );
  await openReport();
  await setPeriod();
  await pickCenter('Logística');
  await generate();
  const ncRow = page.locator('table tbody tr').filter({ hasText: 'Devolución servicio' }).first();
  if (await ncRow.count()) {
    console.log(indent('FILA NC: ' + (await ncRow.innerText()).replace(/\n/g, ' | ')));
  } else {
    console.log('  ⚠ no se encontró la fila de la nota de crédito');
  }
  await shot('08-nota-de-credito', reportCard());

  // ---------------------------------------------------------------
  console.log('\n09. Deep-link desde Empresa → Centros de Costo...');
  await page.goto(`${BASE}/dashboard/company/cost-centers`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const ccRow = page.locator('table tbody tr').filter({ hasText: 'Logística' }).first();
  await ccRow.locator('button').last().click();
  await page.waitForTimeout(600);
  await shot('09a-menu-ver-movimientos', page);
  await page.getByRole('menuitem', { name: /Ver movimientos/ }).click();
  await page.waitForTimeout(4000);
  console.log('  URL:', page.url());
  await describeReport();
  await shot('09-deep-link', page);

  // ---------------------------------------------------------------
  console.log('\n-- Export a Excel --');
  await openReport();
  await setPeriod();
  await pickCenter('Todos los centros');
  await generate();
  const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await page.locator('button[title="Exportar a Excel"]').click();
  const download = await dl;
  console.log('  descarga: ' + (download ? download.suggestedFilename() : '⚠ no se disparó'));
  if (download) {
    const path = `/tmp/${download.suggestedFilename()}`;
    await download.saveAs(path);
    console.log('  guardado en ' + path);
  }

  // ---------------------------------------------------------------
  console.log('\n-- Centro inactivo con historia (paso 6 del plan) --');
  psql(
    `update cost_centers set is_active=false where company_id='${COMPANY_ID}' and name='Administración'`
  );
  await openReport();
  await page.locator('#costCenter').click();
  await page.waitForTimeout(600);
  const options = await page.getByRole('option').allInnerTexts();
  console.log(indent('Opciones del selector: ' + options.join(' / ')));
  await page.keyboard.press('Escape');
  psql(
    `update cost_centers set is_active=true where company_id='${COMPANY_ID}' and name='Administración'`
  );

  // ---------------------------------------------------------------
  console.log('\n-- Período sin movimientos (empty state limpio) --');
  await openReport();
  await setPeriod('2026-01-01', '2026-01-31');
  await pickCenter('Logística');
  await generate();
  await describeReport();
} finally {
  await browser.close();
}
