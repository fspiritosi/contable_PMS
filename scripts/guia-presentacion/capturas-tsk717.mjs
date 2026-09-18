/**
 * Capturas para la guía de presentación del TSK-717.
 *
 * Recorre el flujo real: alta de una socia con su cuenta contable de aportes,
 * listado de socios con la columna nueva, el modal de aporte con el aviso en
 * sus tres estados (cuenta propia / por defecto / falta configurar), la
 * confirmación y el asiento resultante.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk717.mjs [baseUrl]
 * Requiere `npm run dev` corriendo (por defecto en localhost:3000) y la base de dev.
 * El estado "falta configurar" se logra vaciando temporalmente la cuenta por
 * defecto de Ajustes contables; el script la restaura al final.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const COMPANY_ID = '02885d43-1358-4eb2-b774-c52d5be372f3'; // Empresa de Prueba 01 SA (dev)
const PARTNER_NAME = 'María López';
const PARTNER_ACCOUNT = '1.1.4/02/01'; // Cuenta Part. Socio 1

mkdirSync(OUT, { recursive: true });

const psql = (sql) =>
  execSync(`docker exec contable-pms-db psql -U postgres -d contable_pms -tAc "${sql}"`, {
    encoding: 'utf8',
  }).trim();

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const hideNextBadge = () =>
  page
    .evaluate(() => {
      document
        .querySelectorAll('nextjs-portal, [data-next-badge-root], #next-logo')
        .forEach((el) => el.remove());
    })
    .catch(() => {});

const shot = async (name, locator, opts = {}) => {
  await page.waitForTimeout(700);
  await hideNextBadge();
  await (locator ?? page).screenshot({ path: `${OUT}/tsk717-${name}.png`, ...opts });
  console.log(`  ✓ ${name}`);
};

const dialog = () => page.getByRole('dialog');

// --- Login ---
await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 30000 });
await page.waitForTimeout(2000);

// --- 1. Alta de socia con cuenta contable ---
console.log('Alta de socia...');
const existing = psql(`select id from partners where company_id='${COMPANY_ID}' and name='${PARTNER_NAME}' limit 1`);
if (existing) {
  console.log(`  ${PARTNER_NAME} ya existe: se reusa (capturas del form desde edición)`);
  await page.goto(`${BASE}/dashboard/commercial/treasury/partners/${existing}/edit`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await shot('02-form-socio-completo', page.locator('form').first());
} else {
await page.goto(`${BASE}/dashboard/commercial/treasury/partners/new`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.getByPlaceholder('Ej: Juan Pérez').fill(PARTNER_NAME);
await page.getByPlaceholder('20-12345678-9').fill('27-28456123-4');
await page.getByPlaceholder('socio@ejemplo.com').fill('mlopez@demo.local');
const accountTrigger = page.getByRole('combobox').filter({ hasText: /Sin asignar|Cargando/ }).first();
await accountTrigger.click();
await page.waitForTimeout(600);
await page.getByPlaceholder('Buscar por código o nombre...').fill(PARTNER_ACCOUNT);
await page.waitForTimeout(600);
await shot('01-form-socio-combo', page.locator('form').first());
await page.getByRole('option', { name: new RegExp(PARTNER_ACCOUNT.replace(/[/.]/g, '\\$&')) }).first().click();
await page.waitForTimeout(500);
await shot('02-form-socio-completo', page.locator('form').first());
await page.getByRole('button', { name: /Crear|Guardar/ }).first().click();
await page.waitForURL(/partners(?!\/new)/, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);
}

// --- 2. Listado de socios ---
console.log('Listado de socios...');
await page.goto(`${BASE}/dashboard/commercial/treasury/partners`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await shot('03-listado-socios', page.locator('table').first());

// --- 3. Modal de aporte: tres estados del aviso ---
const openContributionModal = async () => {
  await page.goto(`${BASE}/dashboard/commercial/treasury/fund-movements`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Nuevo Movimiento/ }).click();
  await page.waitForTimeout(800);
  // Tipo
  await dialog().getByRole('combobox').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name: 'Aporte de socio' }).click();
  await page.waitForTimeout(500);
};
const pickPartner = async (name) => {
  const socioSelect = dialog().locator('button[role="combobox"]').filter({ hasText: /Seleccionar socio|Juan|María/ }).last();
  await socioSelect.click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name }).click();
  await page.waitForTimeout(700);
};
const pickBank = async () => {
  const bankSelect = dialog().locator('button[role="combobox"]').filter({ hasText: /Seleccionar banco o caja/ }).first();
  await bankSelect.click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name: /Santander/ }).click();
  await page.waitForTimeout(400);
};

console.log('Modal: socia con cuenta propia...');
await openContributionModal();
await pickPartner(PARTNER_NAME);
await shot('04-aviso-cuenta-propia', dialog());

console.log('Modal: socio sin cuenta (por defecto)...');
await pickPartner('Juan Perez');
await shot('05-aviso-por-defecto', dialog());

// Completar y confirmar el aporte de María López (cuenta propia)
console.log('Confirmar aporte...');
await pickPartner(PARTNER_NAME);
await pickBank();
await dialog().getByPlaceholder('0,00').fill('250000');
await dialog().getByPlaceholder('Concepto del movimiento').fill('Aporte inicial de capital');
await page.waitForTimeout(400);
await shot('06-modal-completo', dialog());
await dialog().getByRole('button', { name: 'Guardar y Confirmar' }).click();
await page.waitForTimeout(3500);
await hideNextBadge();
await shot('07-listado-movimientos', page.locator('table').first());

// --- 4. Asiento generado (fila expandible en el listado de asientos) ---
console.log('Asiento...');
const entryNumber = psql(
  `select je.number from fund_movements fm join journal_entries je on je.id=fm.journal_entry_id where fm.company_id='${COMPANY_ID}' and fm.partner_name='${PARTNER_NAME}' order by fm.created_at desc limit 1`
);
await page.goto(`${BASE}/dashboard/company/accounting/entries`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const entryRow = page.locator('table tbody tr').filter({ hasText: 'Aporte inicial de capital' }).first();
if (await entryRow.count()) {
  await entryRow.locator('button').first().click(); // chevron: expande las líneas
  await page.waitForTimeout(800);
  const rowBox = await entryRow.boundingBox();
  await hideNextBadge();
  await page.screenshot({
    path: `${OUT}/tsk717-08-asiento.png`,
    clip: { x: Math.max(rowBox.x - 8, 0), y: Math.max(rowBox.y - 8, 0), width: rowBox.width + 16, height: Math.min(rowBox.height + 200, 950 - rowBox.y) },
  });
  console.log(`  ✓ 08-asiento (nº ${entryNumber})`);
  console.log(psql(`select a.code, a.name, l.debit, l.credit from journal_entry_lines l join journal_entries je on je.id=l.entry_id join accounts a on a.id=l.account_id where je.number='${entryNumber}' and je.company_id='${COMPANY_ID}' order by l.debit desc`));
} else {
  console.log('  ⚠ no se encontró la fila del asiento');
}

// --- 5. Estado "falta configurar": sin cuenta propia y sin cuenta por defecto ---
console.log('Modal: sin cuenta y sin por defecto...');
const defaultAcc = psql(`select partner_contributions_account_id from accounting_settings where company_id='${COMPANY_ID}'`);
psql(`update accounting_settings set partner_contributions_account_id=null where company_id='${COMPANY_ID}'`);
try {
  await openContributionModal();
  await pickPartner('Juan Perez');
  await shot('09-aviso-falta-configurar', dialog());
  await page.keyboard.press('Escape');
} finally {
  psql(`update accounting_settings set partner_contributions_account_id='${defaultAcc}' where company_id='${COMPANY_ID}'`);
  console.log('  cuenta por defecto restaurada');
}

// --- 6. Ajustes contables: el campo renombrado ---
console.log('Ajustes contables...');
await page.goto(`${BASE}/dashboard/company/accounting/settings`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const label = page.getByText('Cuenta de aportes de socios por defecto').first();
await label.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
const box = await label.boundingBox();
if (box) {
  await shot('10-ajustes-por-defecto', null, {
    clip: { x: Math.max(box.x - 24, 0), y: Math.max(box.y - 24, 0), width: 720, height: 170 },
  });
}

await browser.close();
console.log('Listo.');
