/**
 * Capturas para la guía de presentación del TSK-692.
 *
 * Abre la tabla de Roles, hace clic en el contador de la columna Usuarios y
 * captura el popover con los miembros del rol: el caso con usuarios (incluido
 * el propietario), el caso vacío y el link "Gestionar en Usuarios".
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk692.mjs [baseUrl]
 * Requiere `npm run dev` corriendo (por defecto en localhost:3000).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';

mkdirSync(OUT, { recursive: true });

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
  await (locator ?? page).screenshot({
    path: `${OUT}/tsk692-${name}.png`,
    ...(locator ? {} : { fullPage: false }),
    ...opts,
  });
  console.log(`  ✓ ${name}`);
};

// --- Login ---
await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.fill('input[type="email"], input[name="email"]', EMAIL);
await page.fill('input[type="password"], input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);

// --- Tabla de roles ---
console.log('Tabla de roles...');
await page.goto(`${BASE}/dashboard/company/general/roles`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const triggers = page.locator('[data-testid^="role-members-"]:not([data-testid*="manage"])');
const count = await triggers.count();
console.log(`  contadores encontrados: ${count}`);
for (let i = 0; i < count; i++) {
  const t = triggers.nth(i);
  const label = await t.getAttribute('aria-label');
  const disabled = await t.isDisabled();
  const n = (await t.innerText()).trim();
  console.log(`   - ${label} → ${n} ${disabled ? '(deshabilitado)' : ''}`);
}

const table = page.locator('table').first();
await shot('01-tabla-roles', table);

// --- Un popover por rol con miembros ---
const slug = (t) => t.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
let opened = 0;
for (let i = 0; i < count; i++) {
  const t = triggers.nth(i);
  if (await t.isDisabled()) continue;
  const roleName = (await t.getAttribute('aria-label')).replace('Ver usuarios del rol ', '');
  await t.click();
  await page.waitForTimeout(900);
  const popover = page.locator('[data-radix-popper-content-wrapper]').first();
  if (!(await popover.isVisible().catch(() => false))) {
    console.log(`  ⚠ no abrió: ${roleName}`);
    continue;
  }
  console.log(`  popover: ${roleName}`);
  console.log((await popover.innerText()).split('\n').map((l) => '     ' + l).join('\n'));
  await shot(`popover-${slug(roleName)}`, popover);
  if (opened === 0) {
    // La tabla completa con el primer popover abierto, para dar contexto
    const b = await table.boundingBox();
    await shot('02-tabla-con-popover', null, {
      clip: { x: Math.max(b.x - 8, 0), y: Math.max(b.y - 8, 0), width: b.width + 16, height: Math.min(b.height + 380, 950 - b.y) },
    });
  }
  opened++;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
if (!opened) console.log('  ⚠ ningún popover se pudo abrir');

// --- Rol sin usuarios: contador deshabilitado ---
for (let i = 0; i < count; i++) {
  const t = triggers.nth(i);
  if (await t.isDisabled()) {
    await shot('05-rol-sin-usuarios', t.locator('xpath=ancestor::tr'));
    break;
  }
}

// --- Pantalla de Usuarios: adonde lleva "Gestionar en Usuarios" ---
console.log('Tabla de usuarios...');
await page.goto(`${BASE}/dashboard/company/general/users`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await shot('06-tabla-usuarios', page.locator('table').first());

await browser.close();
console.log('Listo.');
