/**
 * Capturas y verificación del TSK-822 (no deja crear una cuenta con el código de una eliminada).
 *
 * Empresa demo: BANCOS (1.1.1/02/00) con 1.1.1/02/01 activa y 1.1.1/02/04 «Banco Nación (eliminada)»
 * (is_active = false, sin movimientos), sembrada a mano en la base de dev.
 * 1. Alta con el código de una cuenta ACTIVA (1.1.1/02/01): el aviso dice qué cuenta lo tiene.
 * 2. Alta con el código de la ELIMINADA (1.1.1/02/04, «Mercado Pago»): se crea.
 *
 * Correr contra un build de producción (`npm run build && npm run start`): en dev el mensaje
 * del error llega igual aunque el arreglo no esté, y la prueba no demostraría nada.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk822.mjs [baseUrl]
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3011';
const OUT = 'scripts/guia-presentacion/assets';
const EMAIL = 'fspiritosi@codecontrol.com.ar';
const PASSWORD = 'Contable2026!';

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const context = await browser.newContext({
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
await page.addInitScript(() => {
  const style = document.createElement('style');
  style.textContent = 'nextjs-portal { display: none !important; }';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
});

async function openNewAccount() {
  await page.goto(`${BASE}/dashboard/company/accounting/accounts`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Nueva Cuenta' }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000); // hidratación
  await page.getByRole('button', { name: 'Nueva Cuenta' }).click();
  await page.getByRole('dialog').waitFor();
}

async function fillBankAccount(code, name) {
  const dialog = page.getByRole('dialog');
  await dialog.locator('#code').fill(code);
  await dialog.locator('#name').fill(name);
  await dialog.locator('#type').click();
  await page.getByRole('option', { name: 'Activo', exact: true }).click();
  await page.waitForTimeout(300);
  await dialog.getByRole('combobox').filter({ hasText: 'Seleccionar cuenta' }).click();
  await page.getByPlaceholder('Buscar por código o nombre...').fill('1.1.1/02/00');
  await page.getByRole('option', { name: /1\.1\.1\/02\/00/ }).click();
  await page.waitForTimeout(300);
}

async function toastText() {
  const toast = page.locator('[data-sonner-toast]').first();
  await toast.waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  return (await toast.innerText()).trim();
}

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  // 1. Código de una cuenta activa
  await openNewAccount();
  await fillBankAccount('1.1.1/02/01', 'Duplicada');
  await page.getByRole('dialog').getByRole('button', { name: 'Crear Cuenta' }).click();
  const duplicate = await toastText();
  console.log(`  toast: ${duplicate}`);
  check(
    duplicate.includes('Ya existe una cuenta con el código 1.1.1/02/01'),
    'el aviso del duplicado llega con su motivo y nombra la cuenta'
  );
  check(!duplicate.includes('Server Components'), 'no aparece el error genérico de Next');
  await page.screenshot({ path: `${OUT}/tsk822-1-codigo-activo.png` });

  // 2. Código de una cuenta eliminada
  await openNewAccount();
  await fillBankAccount('1.1.1/02/04', 'Mercado Pago');
  await page.screenshot({ path: `${OUT}/tsk822-2-formulario.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Crear Cuenta' }).click();
  const created = await toastText();
  console.log(`  toast: ${created}`);
  check(created.includes('Cuenta creada correctamente'), 'se crea la cuenta con el código de la eliminada');
  await page.screenshot({ path: `${OUT}/tsk822-3-creada.png` });
} catch (error) {
  console.error(error);
  failures++;
  await page.screenshot({ path: `${OUT}/tsk822-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

process.exit(failures === 0 ? 0 : 1);
