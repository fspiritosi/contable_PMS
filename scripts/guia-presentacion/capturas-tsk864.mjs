/**
 * Captura y verificación del TSK-864: reutilizar el código de una cuenta eliminada que sigue
 * asignada a un cheque avisa dónde está asignada, en lugar de borrarla y dejar el cheque sin cuenta.
 *
 * Datos de dev: en «Dev Local - Empresa», la cuenta 1.1.1/02/09 «Banco Nación cheques» eliminada
 * (is_active = false) y un cheque de tercero 00012345 asignado a ella.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk864.mjs [baseUrl] [email] [password]
 * Sale con código ≠ 0 si algún chequeo falla.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [BASE = 'http://localhost:3010', EMAIL = 'dev@local.test', PASSWORD = 'Contable2026!'] =
  process.argv.slice(2);
const OUT = 'scripts/guia-presentacion/assets';

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  await page.goto(`${BASE}/dashboard/company/accounting/accounts`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Cuentas Contables').first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});

  await page.getByRole('button', { name: 'Nueva Cuenta' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#code').fill('1.1.1/02/09');
  await dialog.locator('#name').fill('Banco Nación');
  const typeTrigger = dialog.getByRole('combobox').first();
  if ((await typeTrigger.innerText()).includes('Seleccionar tipo')) {
    await typeTrigger.click();
    await page.getByRole('option', { name: 'Activo' }).first().click();
  }
  await dialog.getByRole('button', { name: 'Crear Cuenta' }).click();

  const toast = page.locator('[data-sonner-toast]').filter({ hasText: '1.1.1/02/09' });
  await toast.waitFor({ timeout: 20000 });
  const text = await toast.innerText();
  console.log(`  aviso: ${text.replace(/\s+/g, ' ').trim()}`);
  check(text.includes('Banco Nación cheques') && text.includes('Cheques'), 'el aviso nombra la cuenta y dice que está en Cheques');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/tsk864-1-aviso-cheques.png` });
} catch (error) {
  console.error(error);
  failures++;
  await page.screenshot({ path: `${OUT}/tsk864-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
