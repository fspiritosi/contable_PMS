/**
 * Capturas y verificación en navegador del TSK-760 (cierre de meses, cierre anual y anulación).
 *
 * Todo ocurre en una empresa propia del script, "Distribuidora del Sur SA", sembrada por SQL con
 * ids fijos (prefijo 76076013-…) y nombres realistas: en pantalla no aparece ninguna marca técnica.
 * El cierre anual es irreversible (asientos POSTED inmutables, ejercicio cerrado), por eso no se
 * hace sobre una empresa de dev existente: la empresa entera se borra al empezar y al terminar
 * (también si el script falla o se interrumpe).
 *
 * Recorrido (ejercicio N° 1 = 2025, enero y febrero cerrados, marzo con 3 borradores):
 *   01 Bloqueo de Períodos: meses cerrados en orden, marzo con 3 borradores y "Cerrar"
 *   02 Diálogo "Marzo 2025 tiene 3 borradores sin registrar" → "Registrar los 3 borradores y cerrar"
 *   03 Todo o nada: un borrador con una cuenta no imputable frena el cierre (toast) y nada cambia
 *   04 Asientos → "Eliminar borrador" del asiento trabado (diálogo) y 05 su toast
 *   06 "Registrar los 2 borradores y cerrar" → toast y grilla cerrada hasta el 31/03/2025
 *   07 Intento fuera de orden (pestaña desactualizada) → "Solo se puede cerrar el primer mes abierto"
 *   08 Reabrir el último mes cerrado (diálogo, se cancela)
 *   09 Asiento manual con fecha de un mes cerrado → toast de período cerrado
 *   10 Confirmar un egreso con fecha de un mes cerrado → toast de período cerrado
 *   11 Ajustes: fechas del ejercicio de solo lectura
 *   12 Cierre anual: checklist con meses abiertos y borradores
 *   (por SQL se cierran abril a diciembre: ya se vio cómo se cierra un mes)
 *   13 Checklist en verde · 14 vista previa · 15 toast de éxito · 16 estado después del cierre
 *   17 Balance al 31/01/2026 (mismos saldos que al 31/12/2025, sin duplicar)
 *   18 Estado de Resultados 2025 (no da cero)
 *   19 Bloqueo de Períodos después del cierre: nota del ejercicio cerrado
 *   20 Anular un asiento manual: "se registra con fecha de hoy" y 21 toast
 *   22 Anular el asiento de un egreso: bloqueado ("anulá el comprobante")
 *   23-24 Móvil 375: grilla de meses y diálogo de anulación
 *
 * Uso:
 *   node scripts/guia-presentacion/capturas-tsk760.mjs [baseUrl]     # recorrido completo (dev :3010)
 *   node scripts/guia-presentacion/capturas-tsk760.mjs --clean        # solo limpieza
 *
 * Limpieza: los asientos POSTED no se pueden borrar (trigger trg_journal_entry_immutable). La
 * limpieza usa `SET LOCAL session_replication_role = 'replica'` SOLO dentro de su transacción, y
 * borra SOLO filas de la empresa sembrada (por su id fijo): líneas de sus asientos, períodos de sus
 * ejercicios y toda fila con `company_id` = la empresa. Con `replica` tampoco corren las cascadas de
 * FK, por eso se borra tabla por tabla. Al final restaura la empresa activa del usuario de dev.
 *
 * Sale con código ≠ 0 si algún chequeo (texto en pantalla o estado en la base) falla.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const CLEAN_ONLY = args.includes('--clean');
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3010';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';
const USER_ID = '848d69ff-198d-4588-975e-d3691ea2333f';
const FALLBACK_COMPANY = '02885d43-1358-4eb2-b774-c52d5be372f3'; // empresa activa habitual en dev
const COMPANY = '76076013-0000-4000-8000-000000000001';
const COMPANY_NAME = 'Distribuidora del Sur SA';
const id = (suffix) => `76076013-0000-4000-8000-${suffix.padStart(12, '0')}`;
const ACC = (n) => id(`a${n.toString(16).padStart(2, '0')}`);
const FY1 = id('f1');
const PERIOD = (m) => id(`2${m.toString(16).padStart(2, '0')}`); // MONTHLY 2025
const OPENING = id('2e0');
const CLOSING = id('2e1');
const ENTRY = (n) => id(`1${n.toString(16).padStart(3, '0')}`);
const CATEGORY = id('c1');
const EXPENSE_1 = id('e1');
const EXPENSE_2 = id('e2');
const MEMBER = id('d1');
const SETTINGS = id('b1');

const SETTINGS_URL = '/dashboard/company/accounting/settings';
const ENTRIES_URL = '/dashboard/company/accounting/entries';
const CLOSE_URL = '/dashboard/company/accounting/fiscal-year-close';
const REPORTS_URL = '/dashboard/company/accounting/reports';
const EXPENSES_URL = '/dashboard/commercial/expenses';
/** Nada de esto puede verse en una captura para la clienta. */
const FORBIDDEN = /TSK|demo|test|no usar|verificaci[oó]n interna|prueba|dbg/i;

mkdirSync(OUT, { recursive: true });

const psql = (sql) =>
  execSync(
    'docker exec -i contable-pms-db psql -U postgres -d contable_pms -v ON_ERROR_STOP=1 -qtAX',
    { input: sql, encoding: 'utf8' }
  ).trim();

const failures = [];
const check = (ok, message) => {
  console.log(`  ${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
};
const ar = (n) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// =====================================================================
// Limpieza (al inicio, al final y ante cualquier fallo)
// =====================================================================
const cleanup = () => {
  psql(`
    BEGIN;
    -- Solo dentro de esta transacción: permite borrar asientos POSTED/REVERSED de la empresa sembrada.
    SET LOCAL session_replication_role = 'replica';
    DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE company_id = '${COMPANY}');
    DELETE FROM accounting_periods WHERE fiscal_year_id IN (SELECT id FROM fiscal_years WHERE company_id = '${COMPANY}');
    DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT c.table_name FROM information_schema.columns c
               JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
               WHERE c.column_name = 'company_id' AND c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      LOOP
        EXECUTE format('DELETE FROM %I WHERE company_id = %L', r.table_name, '${COMPANY}');
      END LOOP;
    END $$;
    DELETE FROM companies WHERE id = '${COMPANY}';
    UPDATE user_preferences SET active_company_id = '${FALLBACK_COMPANY}', updated_at = now()
      WHERE user_id = '${USER_ID}' AND (active_company_id IS NULL OR active_company_id = '${COMPANY}');
    COMMIT;
  `);
  const left = psql(`
    SELECT (SELECT count(*) FROM companies WHERE id = '${COMPANY}')
         + (SELECT count(*) FROM journal_entries WHERE company_id = '${COMPANY}')
         + (SELECT count(*) FROM fiscal_years WHERE company_id = '${COMPANY}')
         + (SELECT count(*) FROM accounts WHERE company_id = '${COMPANY}')`);
  return Number(left);
};

// =====================================================================
// Siembra: ejercicio 2025 con enero y febrero cerrados y borradores en marzo
// =====================================================================
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const SALES = [3250000, 2980000, 3410000, 3120000, 3560000, 3890000, 4120000, 3760000, 3640000,
  3980000, 4250000, 4870000];

/** Asientos de 2025 en orden cronológico; el número sale del orden. */
const buildEntries = () => {
  const list = [
    {
      date: '2025-01-02',
      description: 'Aporte inicial de capital',
      lines: [[3, 8000000, 0], [6, 0, 8000000]],
    },
  ];
  SALES.forEach((sale, i) => {
    const m = i + 1;
    const mm = String(m).padStart(2, '0');
    const mes = MONTHS[i];
    const purchase = Math.round(sale * 0.55 / 1000) * 1000;
    const collected = Math.round(sale * 0.92 / 1000) * 1000;
    const wages = m === 6 || m === 12 ? 1770000 : 1180000;
    const march = m === 3;
    list.push({ date: `2025-${mm}-05`, description: `Compra de mercadería de ${mes}`,
      lines: [[9, purchase, 0], [3, 0, purchase]] });
    list.push({ date: `2025-${mm}-10`, description: `Ventas de ${mes} – facturación mostrador`,
      lines: [[4, sale, 0], [8, 0, sale]], draft: march });
    if (march) {
      list.push({ date: '2025-03-14', description: 'Reposición de fondo fijo', wrong: true,
        lines: [[1, 45000, 0], [2, 0, 45000]], draft: true });
    }
    list.push({ date: `2025-${mm}-20`, description: `Cobranzas de clientes de ${mes}`,
      lines: [[3, collected, 0], [4, 0, collected]] });
    list.push({ date: `2025-${mm}-28`, description: `Sueldos y cargas sociales de ${mes}`,
      lines: [[10, wages, 0], [3, 0, wages]], draft: march });
  });
  return list.map((e, i) => ({ ...e, number: i + 1 }));
};
const ENTRIES = buildEntries();
const WRONG = ENTRIES.find((e) => e.wrong);
const MARCH_DRAFTS = ENTRIES.filter((e) => e.draft);

const seed = () => {
  const accounts = [
    [1, '1.1.1/00/00', 'Disponibilidades', 'ASSET', 'DEBIT', false, null],
    [2, '1.1.1/01/01', 'Caja', 'ASSET', 'DEBIT', true, 1],
    [3, '1.1.1/02/01', 'Banco Nación cta. cte.', 'ASSET', 'DEBIT', true, 1],
    [4, '1.1.3/01/01', 'Deudores por ventas', 'ASSET', 'DEBIT', true, null],
    [5, '2.1.1/01/01', 'Proveedores', 'LIABILITY', 'CREDIT', true, null],
    [6, '3.1.1/01/01', 'Capital social', 'EQUITY', 'CREDIT', true, null],
    [7, '3.3.1/01/01', 'Resultado del ejercicio', 'EQUITY', 'CREDIT', true, null],
    [8, '4.1.1/01/01', 'Ventas', 'REVENUE', 'CREDIT', true, null],
    [9, '5.1.1/01/01', 'Costo de mercadería vendida', 'EXPENSE', 'DEBIT', true, null],
    [10, '5.2.1/01/01', 'Sueldos y cargas sociales', 'EXPENSE', 'DEBIT', true, null],
    [11, '5.2.1/02/01', 'Gastos de oficina', 'EXPENSE', 'DEBIT', true, null],
  ];
  const periods = [
    `('${OPENING}', '${FY1}', 2025, 1, 'OPENING', false, NULL, NULL, now())`,
    `('${CLOSING}', '${FY1}', 2025, 12, 'CLOSING', false, NULL, NULL, now())`,
    ...Array.from({ length: 12 }, (_, i) => {
      const closed = i < 2;
      return `('${PERIOD(i + 1)}', '${FY1}', 2025, ${i + 1}, 'MONTHLY', ${closed}, ${closed ? "now()" : 'NULL'}, ${closed ? `'${USER_ID}'` : 'NULL'}, now())`;
    }),
  ];
  const entrySql = ENTRIES.map((e) => {
    const status = e.draft ? 'DRAFT' : 'POSTED';
    const month = Number(e.date.slice(5, 7));
    const lines = e.lines
      .map(([acc, debit, credit]) =>
        `('${ENTRY(e.number)}', '${ACC(acc)}', '${e.description.replace(/'/g, "''")}', ${debit}, ${credit})`)
      .join(',\n');
    return `
      INSERT INTO journal_entries (id, company_id, number, date, description, status, post_date, created_by, updated_at, fiscal_year_id, period_id)
      VALUES ('${ENTRY(e.number)}', '${COMPANY}', ${e.number}, '${e.date}', '${e.description.replace(/'/g, "''")}', '${status}',
              ${status === 'POSTED' ? `'${e.date}'` : 'NULL'}, '${USER_ID}', now(), '${FY1}', '${PERIOD(month)}');
      INSERT INTO journal_entry_lines (entry_id, account_id, description, debit, credit) VALUES ${lines};`;
  }).join('\n');

  psql(`
    BEGIN;
    INSERT INTO companies (id, name, tax_id, industry, is_active, is_single_company, created_at, updated_at, active_modules, onboarding_completed)
    VALUES ('${COMPANY}', '${COMPANY_NAME}', '30-71583264-9', 'Desarrollo de software', true, false, now(), now(), '{}', true);
    INSERT INTO company_members (id, user_id, is_owner, is_active, created_at, updated_at, company_id)
    VALUES ('${MEMBER}', '${USER_ID}', true, true, now(), now(), '${COMPANY}');
    INSERT INTO accounts (id, company_id, code, name, type, nature, is_leaf, parent_id, updated_at) VALUES
    ${accounts.map(([n, code, name, type, nature, leaf, parent]) =>
      `('${ACC(n)}', '${COMPANY}', '${code}', '${name}', '${type}', '${nature}', ${leaf}, ${parent ? `'${ACC(parent)}'` : 'NULL'}, now())`).join(',\n')};
    INSERT INTO fiscal_years (id, company_id, number, start_date, end_date, is_closed, updated_at)
    VALUES ('${FY1}', '${COMPANY}', 1, '2025-01-01 00:00:00', '2025-12-31 23:59:59.999', false, now());
    INSERT INTO accounting_periods (id, fiscal_year_id, year, month, type, is_closed, closed_at, closed_by, updated_at) VALUES
    ${periods.join(',\n')};
    ${entrySql}
    INSERT INTO accounting_settings (id, company_id, fiscal_year_start, fiscal_year_end, last_entry_number, updated_at,
                                     result_account_id, expenses_account_id, payables_account_id, default_bank_account_id,
                                     default_cash_account_id, locked_until_date)
    VALUES ('${SETTINGS}', '${COMPANY}', '2025-01-01 00:00:00', '2025-12-31 23:59:59.999', ${ENTRIES.length}, now(),
            '${ACC(7)}', '${ACC(11)}', '${ACC(5)}', '${ACC(3)}', '${ACC(2)}', '2025-02-28 23:59:59.999');
    INSERT INTO expense_categories (id, name, company_id, updated_at) VALUES ('${CATEGORY}', 'Gastos de oficina', '${COMPANY}', now());
    INSERT INTO expenses (id, number, full_number, description, amount, date, status, category_id, company_id, created_by, updated_at)
    VALUES ('${EXPENSE_1}', 1, 'GTO-00001', 'Librería y artículos de oficina', 85000, '2025-02-20', 'DRAFT', '${CATEGORY}', '${COMPANY}', '${USER_ID}', now());
    INSERT INTO user_preferences (user_id, active_company_id, updated_at) VALUES ('${USER_ID}', '${COMPANY}', now())
      ON CONFLICT (user_id) DO UPDATE SET active_company_id = EXCLUDED.active_company_id, updated_at = now();
    COMMIT;
  `);
  console.log(`  sembrada "${COMPANY_NAME}": ${ENTRIES.length} asientos de 2025 (${MARCH_DRAFTS.length} borradores en marzo), egreso GTO-00001`);
};

/** Abril a diciembre cerrados por SQL (el cierre de un mes ya se mostró en 01-08). */
const closeRestOfYear = () => {
  psql(`
    BEGIN;
    UPDATE accounting_periods SET is_closed = true, closed_at = now(), closed_by = '${USER_ID}', updated_at = now()
      WHERE fiscal_year_id = '${FY1}' AND type = 'MONTHLY' AND month BETWEEN 4 AND 12;
    UPDATE accounting_settings SET locked_until_date = '2025-12-31 23:59:59.999', updated_at = now() WHERE company_id = '${COMPANY}';
    COMMIT;`);
};

/** Ejercicio 2026 (lo creó el cierre): un asiento manual y un egreso confirmado con su asiento. */
const seedStageC = () => {
  const period = psql(`
    SELECT p.id FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
    WHERE f.company_id = '${COMPANY}' AND f.number = 2 AND p.type = 'MONTHLY' AND p.year = 2026 AND p.month = 9`);
  const fy2 = psql(`SELECT id FROM fiscal_years WHERE company_id = '${COMPANY}' AND number = 2`);
  const last = Number(psql(`SELECT last_entry_number FROM accounting_settings WHERE company_id = '${COMPANY}'`));
  const manual = last + 1;
  const expense = last + 2;
  psql(`
    BEGIN;
    INSERT INTO journal_entries (id, company_id, number, date, description, status, post_date, created_by, updated_at, fiscal_year_id, period_id)
    VALUES ('${ENTRY(900)}', '${COMPANY}', ${manual}, '2026-09-12', 'Reposición de caja chica', 'POSTED', '2026-09-12', '${USER_ID}', now(), '${fy2}', '${period}'),
           ('${ENTRY(901)}', '${COMPANY}', ${expense}, '2026-09-15', 'Gasto GTO-00002 - Servicio de limpieza del depósito', 'POSTED', '2026-09-15', 'system', now(), '${fy2}', '${period}');
    INSERT INTO journal_entry_lines (entry_id, account_id, description, debit, credit) VALUES
      ('${ENTRY(900)}', '${ACC(2)}', 'Reposición de caja chica', 120000, 0),
      ('${ENTRY(900)}', '${ACC(3)}', 'Reposición de caja chica', 0, 120000),
      ('${ENTRY(901)}', '${ACC(11)}', 'Gasto GTO-00002 - Servicio de limpieza del depósito', 240000, 0),
      ('${ENTRY(901)}', '${ACC(5)}', 'Gasto GTO-00002', 0, 240000);
    INSERT INTO expenses (id, number, full_number, description, amount, date, status, category_id, company_id, created_by, updated_at, journal_entry_id)
    VALUES ('${EXPENSE_2}', 2, 'GTO-00002', 'Servicio de limpieza del depósito', 240000, '2026-09-15', 'CONFIRMED', '${CATEGORY}', '${COMPANY}', '${USER_ID}', now(), '${ENTRY(901)}');
    UPDATE accounting_settings SET last_entry_number = ${expense}, updated_at = now() WHERE company_id = '${COMPANY}';
    COMMIT;`);
  return { manual, expense };
};

// =====================================================================
// Navegador
// =====================================================================
let browser;
const run = async () => {
  browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await context.newPage();

  const hideDevBadges = (p = page) =>
    p.evaluate(() => {
      document
        .querySelectorAll('nextjs-portal, [data-next-badge-root], #next-logo, .tsqd-parent-container')
        .forEach((el) => el.remove());
    }).catch(() => {});

  /** Captura y verifica que no se vea ninguna marca técnica en la página. */
  const shot = async (name, locator, p = page, wait = 700) => {
    await p.waitForTimeout(wait);
    await hideDevBadges(p);
    const visible = await p.locator('body').innerText();
    const mark = visible.match(FORBIDDEN);
    check(!mark, `${name}: sin marcas técnicas en pantalla${mark ? ` (aparece "${mark[0]}")` : ''}`);
    await (locator ?? p).screenshot({ path: `${OUT}/tsk760-${name}.png` });
    console.log(`  → ${OUT}/tsk760-${name}.png`);
  };

  /** Captura el rectángulo que va desde el primer hasta el último elemento indicado. */
  const spanShot = async (name, first, last, p = page) => {
    await p.waitForTimeout(700);
    await hideDevBadges(p);
    const mark = (await p.locator('body').innerText()).match(FORBIDDEN);
    check(!mark, `${name}: sin marcas técnicas en pantalla${mark ? ` (aparece "${mark[0]}")` : ''}`);
    await first.scrollIntoViewIfNeeded();
    const a = await first.boundingBox();
    const b = await last.boundingBox();
    const scroll = await p.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const x = Math.min(a.x, b.x) - 8;
    const y = a.y - 8;
    await p.screenshot({
      path: `${OUT}/tsk760-${name}.png`,
      fullPage: true, // el recorte puede pasar el alto de la ventana
      clip: { x: x + scroll.x, y: y + scroll.y, width: Math.max(a.x + a.width, b.x + b.width) - x + 8, height: b.y + b.height - y + 8 },
    });
    console.log(`  → ${OUT}/tsk760-${name}.png`);
  };
  /** Título de la página hasta la última tarjeta. */
  const pageShot = (name, p = page) =>
    spanShot(name, p.locator('main h1').first(), p.locator('main [data-slot="card"]').last(), p);

  const login = async (p) => {
    await p.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    await p.fill('input[type="email"]', EMAIL);
    await p.fill('input[type="password"]', PASSWORD);
    await p.click('button[type="submit"]');
    await p.waitForURL(/dashboard/, { timeout: 30000 });
    await p.waitForTimeout(1500);
  };

  const go = async (path, p = page) => {
    await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
  };

  /**
   * Espera el último toast, lo captura en el acto (se anima y se cierra solo a los pocos
   * segundos) y, si se pide, también la pantalla completa. Devuelve su texto.
   */
  const lastToast = async (name, { full = null, p = page } = {}) => {
    const toast = p.locator('[data-sonner-toast]').last();
    await toast.waitFor({ state: 'visible', timeout: 20000 });
    await hideDevBadges(p);
    // Animación de entrada: se espera a que la caja del toast quede quieta.
    let box = await toast.boundingBox();
    for (let i = 0; i < 20; i++) {
      await p.waitForTimeout(150);
      const next = await toast.boundingBox();
      const still = next && box && Math.abs(next.y - box.y) < 0.5 && Math.abs(next.height - box.height) < 0.5;
      box = next;
      if (still && i >= 2) break;
    }
    const text = (await toast.innerText()).replace(/\s+/g, ' ').trim();
    // Primero la pantalla completa: la captura del elemento puede desplazar contenedores.
    if (full) await p.screenshot({ path: `${OUT}/tsk760-${full}.png` });
    await toast.screenshot({ path: `${OUT}/tsk760-${name}.png`, animations: 'disabled', timeout: 8000 });
    const mark = (await p.locator('body').innerText()).match(FORBIDDEN);
    check(!mark, `${name}: sin marcas técnicas en pantalla${mark ? ` (aparece "${mark[0]}")` : ''}`);
    console.log(`  → tsk760-${name}.png${full ? ` + tsk760-${full}.png` : ''}`);
    return { toast, text };
  };
  const dismissToasts = async (p = page) => {
    await p.evaluate(() => document.querySelectorAll('[data-sonner-toast]').forEach((t) => t.remove()));
  };

  const lockCard = (p = page) => p.locator('#bloqueo-periodos');
  const monthCell = (m, p = page) => p.locator(`[data-testid="period-month-2025-${m}"]`);
  const db = {
    monthClosed: (m) => psql(`SELECT is_closed FROM accounting_periods WHERE id = '${PERIOD(m)}'`) === 't',
    status: (n) => psql(`SELECT status FROM journal_entries WHERE company_id = '${COMPANY}' AND number = ${n}`),
    lockedUntil: () => psql(`SELECT to_char(locked_until_date, 'YYYY-MM-DD') FROM accounting_settings WHERE company_id = '${COMPANY}'`),
  };

  const entryRow = (number) =>
    page.locator('table tbody tr').filter({ has: page.locator(`button[aria-label="Acciones del asiento ${number}"]`) }).first();
  const entryAction = async (number, item) => {
    const row = entryRow(number);
    await row.scrollIntoViewIfNeeded();
    await page.locator(`button[aria-label="Acciones del asiento ${number}"]`).click();
    await page.waitForTimeout(400);
    await page.getByRole('menuitem', { name: item }).click();
    await page.waitForTimeout(800);
    return page.getByRole('alertdialog');
  };

  await login(page);

  // ---------------------------------------------------------------
  console.log('\n01. Bloqueo de Períodos: enero y febrero cerrados, marzo con 3 borradores');
  await go(SETTINGS_URL);
  await lockCard().scrollIntoViewIfNeeded();
  const card = await lockCard().innerText();
  check(card.includes('Cerrado hasta el 28/02/2025'), 'grilla: "Cerrado hasta el 28/02/2025"');
  check(/Mar 2025\s*3 borradores\s*Cerrar/.test(card), 'marzo muestra "3 borradores" y "Cerrar"');
  check(card.includes('Ejercicio N° 1'), 'grilla del ejercicio N° 1');
  await shot('01-bloqueo-meses', lockCard());

  // ---------------------------------------------------------------
  console.log('\n12. Cierre anual: requisitos pendientes (meses abiertos y borradores)');
  await go(CLOSE_URL);
  const closeText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  check(closeText.includes('Faltan cerrar 10 meses'), 'checklist: faltan cerrar 10 meses');
  check(closeText.includes(`Hay 3 borradores sin registrar: 03/2025: N° ${MARCH_DRAFTS.map((e) => e.number).join(', ')}`), 'checklist: 3 borradores de marzo');
  check(await page.getByRole('button', { name: 'Cerrar ejercicio N° 1' }).isDisabled(), 'botón deshabilitado');
  await pageShot('12-cierre-anual-pendiente');

  // Pantalla que queda desactualizada para el paso 07 (abierta antes de cerrar marzo). Va en otra
  // ventana (contexto propio): una pestaña de la misma ventana dejaría a `page` en segundo plano y
  // el navegador congela sus animaciones (los toasts no terminan de entrar).
  const staleContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const stale = await staleContext.newPage();
  await login(stale);
  await go(SETTINGS_URL, stale);

  // ---------------------------------------------------------------
  console.log('\n02. Diálogo de cierre con borradores');
  await go(SETTINGS_URL);
  await monthCell(3).click();
  let dialog = page.getByRole('alertdialog');
  await dialog.waitFor();
  const dlgText = (await dialog.innerText()).replace(/\s+/g, ' ');
  check(dlgText.includes('Marzo 2025 tiene 3 borradores sin registrar'), 'título "Marzo 2025 tiene 3 borradores sin registrar"');
  check(dlgText.includes('Registrar los 3 borradores y cerrar'), 'botón "Registrar los 3 borradores y cerrar"');
  await shot('02-dialogo-borradores', dialog);

  // ---------------------------------------------------------------
  console.log('\n03. Todo o nada: un borrador no se puede registrar');
  await dialog.getByRole('button', { name: 'Registrar los 3 borradores y cerrar' }).click();
  let t = await lastToast('03-todo-o-nada-toast', { full: '03b-todo-o-nada-pantalla' });
  console.log(`  toast: ${t.text}`);
  check(t.text.includes(`No se cerró 03/2025: el borrador N° ${WRONG.number} no se puede registrar`), 'toast nombra el borrador trabado');
  check(t.text.includes('no es imputable'), 'toast explica la causa (cuenta no imputable)');
  check(t.text.includes('podés eliminarlo desde Asientos'), 'toast sugiere eliminarlo');
  check(!db.monthClosed(3), 'DB: marzo sigue abierto');
  check(MARCH_DRAFTS.every((e) => db.status(e.number) === 'DRAFT'), 'DB: los 3 borradores siguen en borrador');
  await dismissToasts();

  // ---------------------------------------------------------------
  console.log('\n04-05. Eliminar el borrador trabado');
  await go(ENTRIES_URL);
  dialog = await entryAction(WRONG.number, 'Eliminar borrador');
  const delText = (await dialog.innerText()).replace(/\s+/g, ' ');
  check(delText.includes(`¿Eliminar el borrador N° ${WRONG.number}?`), 'diálogo de eliminar borrador');
  await shot('04-eliminar-borrador', dialog);
  await dialog.getByRole('button', { name: 'Eliminar borrador' }).click();
  t = await lastToast('05-eliminar-borrador-toast');
  console.log(`  toast: ${t.text}`);
  check(t.text.includes(`Borrador N° ${WRONG.number} eliminado`), 'toast "Borrador N° X eliminado"');
  check(db.status(WRONG.number) === '', 'DB: el borrador ya no existe');
  await dismissToasts();

  // ---------------------------------------------------------------
  console.log('\n06. Registrar los 2 borradores y cerrar marzo');
  await go(SETTINGS_URL);
  await monthCell(3).click();
  dialog = page.getByRole('alertdialog');
  await dialog.waitFor();
  check((await dialog.innerText()).includes('Registrar los 2 borradores y cerrar'), 'ahora ofrece "Registrar los 2 borradores y cerrar"');
  await dialog.getByRole('button', { name: 'Registrar los 2 borradores y cerrar' }).click();
  t = await lastToast('06-registrar-y-cerrar-toast');
  console.log(`  toast: ${t.text}`);
  check(t.text.includes('Se registraron 2 borradores y se cerró marzo 2025'), 'toast de éxito');
  check(db.monthClosed(3), 'DB: marzo cerrado');
  check(db.lockedUntil() === '2025-03-31', 'DB: bloqueo hasta 2025-03-31');
  check(MARCH_DRAFTS.filter((e) => !e.wrong).every((e) => db.status(e.number) === 'POSTED'), 'DB: los 2 borradores quedaron registrados');
  await page.waitForTimeout(1500);
  await lockCard().scrollIntoViewIfNeeded();
  check((await lockCard().innerText()).includes('Cerrado hasta el 31/03/2025'), 'grilla: "Cerrado hasta el 31/03/2025"');
  await shot('06-registrar-y-cerrar', null);
  await dismissToasts();

  // ---------------------------------------------------------------
  console.log('\n07. Fuera de orden: la otra ventana todavía muestra marzo como primer mes abierto');
  await monthCell(3, stale).click();
  const staleDialog = stale.getByRole('alertdialog');
  await staleDialog.waitFor();
  await staleDialog.getByRole('button', { name: /y cerrar|Cerrar mes/ }).click();
  t = await lastToast('07-fuera-de-orden-toast', { p: stale });
  console.log(`  toast: ${t.text}`);
  check(t.text.includes('Solo se puede cerrar el primer mes abierto: 04/2025.'), 'toast "Solo se puede cerrar el primer mes abierto: 04/2025."');
  await staleContext.close();

  // ---------------------------------------------------------------
  console.log('\n08. Reabrir el último mes cerrado (se cancela)');
  await go(SETTINGS_URL);
  await monthCell(3).click();
  dialog = page.getByRole('alertdialog');
  await dialog.waitFor();
  check((await dialog.innerText()).includes('¿Reabrir marzo 2025?'), 'diálogo "¿Reabrir marzo 2025?"');
  await shot('08-reabrir-dialogo', dialog);
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  // ---------------------------------------------------------------
  console.log('\n09. Asiento manual con fecha de un mes cerrado');
  await go(ENTRIES_URL);
  await page.getByRole('button', { name: 'Nuevo Asiento' }).click();
  const modal = page.getByRole('dialog');
  await modal.waitFor();
  await modal.locator('#date').fill('2025-02-15');
  await modal.locator('#description').fill('Pago de servicios de febrero');
  const pick = async (index, search) => {
    await modal.getByRole('combobox').nth(index).click();
    await page.waitForTimeout(300);
    await page.getByPlaceholder('Buscar por código o nombre...').fill(search);
    await page.waitForTimeout(300);
    await page.getByRole('option').filter({ hasText: search }).first().click();
    await page.waitForTimeout(300);
  };
  await pick(0, 'Gastos de oficina');
  await pick(1, 'Banco Nación');
  const amounts = modal.locator('input[placeholder="0.00"]');
  await amounts.nth(0).fill('64000');
  await amounts.nth(3).fill('64000');
  await modal.getByRole('button', { name: 'Crear Asiento' }).click();
  t = await lastToast('09b-asiento-manual-toast', { full: '09-asiento-manual-mes-cerrado' });
  console.log(`  toast: ${t.text}`);
  check(t.text.includes('No se puede registrar con fecha 15/02/2025: el período está cerrado (mes 02/2025 cerrado)'), 'toast de período cerrado en el asiento manual');
  check(psql(`SELECT count(*) FROM journal_entries WHERE company_id = '${COMPANY}' AND description = 'Pago de servicios de febrero'`) === '0', 'DB: el asiento no se creó');
  await dismissToasts();

  // ---------------------------------------------------------------
  console.log('\n10. Confirmar un egreso con fecha de un mes cerrado');
  await go(EXPENSES_URL);
  const expRow = page.locator('table tbody tr').filter({ hasText: 'GTO-00001' }).first();
  await expRow.getByRole('button', { name: 'Abrir menú' }).click();
  await page.getByRole('menuitem', { name: 'Confirmar' }).click();
  dialog = page.getByRole('alertdialog');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  t = await lastToast('10b-egreso-toast', { full: '10-egreso-mes-cerrado' });
  console.log(`  toast: ${t.text}`);
  check(t.text.includes('el período está cerrado (mes 02/2025 cerrado)'), 'toast de período cerrado al confirmar el egreso');
  check(psql(`SELECT status FROM expenses WHERE id = '${EXPENSE_1}'`) === 'DRAFT', 'DB: el egreso sigue en borrador');
  await dismissToasts();

  // ---------------------------------------------------------------
  console.log('\n11. Ajustes: fechas del ejercicio de solo lectura');
  await go(SETTINGS_URL);
  const fyCard = page.locator('[data-slot="card"]').filter({ hasText: 'Ejercicio Fiscal' }).first();
  const fyText = await fyCard.innerText();
  check(fyText.includes('Las fechas salen del ejercicio N° 1'), 'leyenda de solo lectura');
  check((await fyCard.locator('input[type="date"]').count()) === 0, 'sin campos de fecha editables');
  await shot('11-ajustes-fechas-solo-lectura', fyCard);

  // ---------------------------------------------------------------
  console.log('\n(SQL) se cierran abril a diciembre');
  closeRestOfYear();

  console.log('\n13-16. Cierre anual');
  await go(CLOSE_URL);
  const ready = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  check(ready.includes('Todos los meses del ejercicio están cerrados.'), 'checklist: todos los meses cerrados');
  const closeBtn = page.getByRole('button', { name: 'Cerrar ejercicio N° 1' });
  check(await closeBtn.isEnabled(), 'botón habilitado');
  await pageShot('13-cierre-anual-listo');
  await closeBtn.click();
  dialog = page.getByRole('alertdialog');
  await dialog.waitFor();
  await dialog.getByText('Al confirmar se registran la refundición').waitFor({ timeout: 20000 });
  const expected = psql(`
    SELECT sum(CASE WHEN a.type = 'REVENUE' THEN l.credit - l.debit ELSE 0 END) - sum(CASE WHEN a.type = 'EXPENSE' THEN l.debit - l.credit ELSE 0 END)
    FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE e.company_id = '${COMPANY}' AND e.status = 'POSTED'`);
  const result = Number(expected);
  console.log(`  resultado esperado (SQL): ${ar(result)}`);
  check((await dialog.innerText()).includes(ar(result)), 'vista previa muestra el resultado del ejercicio');
  await shot('14-cierre-anual-vista-previa', dialog);
  await dialog.getByRole('button', { name: 'Confirmar cierre' }).click();
  t = await lastToast('15-cierre-anual-toast');
  console.log(`  toast: ${t.text}`);
  check(/Ejercicio N° 1 cerrado: refundición N° \d+ y apertura N° \d+\. Queda abierto el ejercicio N° 2\./.test(t.text), 'toast de cierre anual');
  check(psql(`SELECT is_closed FROM fiscal_years WHERE id = '${FY1}'`) === 't', 'DB: ejercicio N° 1 cerrado');
  await dismissToasts();
  await go(CLOSE_URL);
  const after = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  check(after.includes('Ejercicio N° 1 cerrado') && after.includes('Ejercicio N° 2'), 'estado: N° 1 cerrado y N° 2 abierto');
  await pageShot('16-cierre-anual-despues');

  // ---------------------------------------------------------------
  console.log('\n17. Balance al 31/12/2025 y al 31/01/2026');
  const balanceAt = async (date) => {
    await go(`${REPORTS_URL}?report=balance-sheet`);
    await page.locator('#asOfDate').fill(date);
    await page.getByRole('button', { name: 'Generar', exact: true }).click();
    await page.waitForTimeout(3000);
    const text = await page.locator('main').innerText();
    return text.match(/Total Activo\s*([^\n]+)/)?.[1]?.trim();
  };
  const assetsDec = await balanceAt('2025-12-31');
  const assetsJan = await balanceAt('2026-01-31');
  const assetsSql = Number(psql(`
    SELECT sum(l.debit - l.credit) FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE e.company_id = '${COMPANY}' AND e.status = 'POSTED' AND a.type = 'ASSET' AND e.date < '2026-01-01'`));
  console.log(`  Total Activo 31/12/2025: ${assetsDec} · 31/01/2026: ${assetsJan} · SQL: ${ar(assetsSql)}`);
  check(assetsDec === assetsJan, 'el activo al 31/01/2026 es igual al del 31/12/2025 (la apertura no duplica)');
  check(assetsJan?.includes(ar(assetsSql)), 'el activo coincide con la suma de la base');
  // El aviso "no está equilibrado" y la fila "Diferencia" son un defecto previo del informe (compara
  // activo con pasivo + patrimonio con signos opuestos; anotado en la Fase 9, ticket aparte): se
  // capturan solo las tablas de Activo, Pasivo y Patrimonio Neto.
  const sections = page.locator('main div.space-y-6').last().locator(':scope > div.rounded-md.border');
  await spanShot('17-balance-despues-del-cierre', sections.nth(0), sections.nth(2));

  console.log('\n18. Estado de Resultados 2025');
  await go(`${REPORTS_URL}?report=income-statement`);
  await page.locator('#fromDate').fill('2025-01-01');
  await page.locator('#toDate').fill('2025-12-31');
  await page.getByRole('button', { name: 'Generar', exact: true }).click();
  await page.waitForTimeout(3000);
  const income = await page.locator('main').innerText();
  check(income.includes(ar(result)), 'Estado de Resultados 2025 = resultado del ejercicio (no cero)');
  await shot('18-estado-de-resultados', page.locator('[data-slot="card"]').filter({ hasText: 'Estado de Resultados' }).last());

  console.log('\n19. Bloqueo de Períodos después del cierre');
  await go(SETTINGS_URL);
  await lockCard().scrollIntoViewIfNeeded();
  const lockAfter = await lockCard().innerText();
  check(lockAfter.includes('El ejercicio N° 1 está cerrado'), 'nota: el ejercicio N° 1 está cerrado');
  check(lockAfter.includes('Ejercicio N° 2'), 'grilla del ejercicio N° 2');
  await shot('19-bloqueo-despues-del-cierre', lockCard());

  // ---------------------------------------------------------------
  console.log('\n20-22. Anulación desde Asientos');
  const numbers = seedStageC();
  const today = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date());
  await go(ENTRIES_URL);
  dialog = await entryAction(numbers.manual, 'Anular');
  await dialog.getByText('La anulación se registra con fecha de hoy').waitFor({ timeout: 15000 });
  check((await dialog.innerText()).includes(`La anulación se registra con fecha de hoy (${today}).`), `diálogo: fecha de hoy (${today}, Argentina)`);
  await shot('20-anular-manual', dialog);
  await dialog.getByRole('button', { name: 'Anular' }).click();
  t = await lastToast('21-anular-manual-toast');
  console.log(`  toast: ${t.text}`);
  check(new RegExp(`Asiento N° ${numbers.manual} anulado con el asiento N° \\d+`).test(t.text), 'toast de anulación');
  check(db.status(numbers.manual) === 'REVERSED', 'DB: el original quedó anulado');
  await dismissToasts();

  await go(ENTRIES_URL);
  dialog = await entryAction(numbers.expense, 'Anular');
  await dialog.locator('text=no se puede anular desde Asientos').waitFor({ timeout: 15000 });
  const blocked = (await dialog.innerText()).replace(/\s+/g, ' ');
  check(blocked.includes('pertenece al egreso GTO-00002'), 'bloqueo nombra el egreso GTO-00002');
  check(await dialog.getByRole('button', { name: 'Anular' }).isDisabled(), 'botón Anular deshabilitado');
  await shot('22-anular-comprobante-bloqueado', dialog);
  await dialog.getByRole('button', { name: 'Cerrar' }).click();

  // ---------------------------------------------------------------
  console.log('\n23-24. Móvil 375');
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  await login(m);
  await go(SETTINGS_URL, m);
  await lockCard(m).scrollIntoViewIfNeeded();
  const width = await m.evaluate(() => document.documentElement.scrollWidth);
  console.log(`  scrollWidth: ${width}`);
  await shot('23-movil-bloqueo', lockCard(m), m);
  await go(CLOSE_URL, m);
  check((await m.locator('main').innerText()).includes('Ejercicio N° 2'), 'móvil: cierre anual del ejercicio N° 2');
  await pageShot('24-movil-cierre-anual', m);
  await mobile.close();
};

// =====================================================================
const onSignal = (signal) => {
  console.log(`\n${signal}: limpiando antes de salir...`);
  try { cleanup(); } catch (error) { console.error(error); }
  process.exit(1);
};
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

console.log('Limpieza inicial...');
check(cleanup() === 0, 'limpieza inicial: no queda nada de la empresa sembrada');
if (CLEAN_ONLY) process.exit(failures.length ? 1 : 0);

try {
  console.log('Siembra...');
  seed();
  await run();
} catch (error) {
  failures.push(`excepción: ${error instanceof Error ? error.message : String(error)}`);
  console.error(error);
} finally {
  await browser?.close().catch(() => {});
  console.log('\nLimpieza final...');
  check(cleanup() === 0, 'limpieza final: no queda nada de la empresa sembrada');
  console.log(`  empresa activa del usuario: ${psql(`SELECT c.name FROM user_preferences u JOIN companies c ON c.id = u.active_company_id WHERE u.user_id = '${USER_ID}'`)}`);
}

if (failures.length) {
  console.error(`\n${failures.length} chequeo(s) fallaron:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('\nTodos los chequeos pasaron.');
