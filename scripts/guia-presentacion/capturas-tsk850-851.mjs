/**
 * Capturas y verificación del TSK-850 (buscador en el plan de cuentas) y del TSK-851 (el "."
 * del teclado numérico escribe la coma decimal en los importes).
 *
 * Datos de dev: plan de cuentas modelo cargado en «Dev Local - Empresa» (283 cuentas, con
 * 1.1.1/01/07 «Tarjeta de crédito empresa» y 4.2.1/07/06 «Impuesto débitos y créditos
 * bancarios»), y un concepto de «Gastos e impuestos bancarios» activo.
 *
 * 1. Contabilidad → Plan de cuentas: buscar «tarj» deja solo la rama hasta la tarjeta, abierta;
 *    «imp deb» (sin acento, en otro orden) encuentra la cuenta del impuesto; Esc limpia.
 * 2. Tesorería → Movimientos de fondos → Nuevo → Gastos e impuestos bancarios: 2 4 [Num .] 5
 *    queda «24,5»; con el «.» del teclado principal 24.000 sigue siendo veinticuatro mil.
 *
 * Uso: node scripts/guia-presentacion/capturas-tsk850-851.mjs [baseUrl] [email] [password]
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
const hideDevOverlay = () =>
  page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {});

async function goto(path, readyText) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(readyText).first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(3000); // hidratación
  await hideDevOverlay();
}

/** Captura solo el bloque de conceptos del modal (de «Conceptos» a «Total»). */
async function shootConcepts(dialog, file) {
  const top = await dialog.getByText('Conceptos *').boundingBox();
  const bottom = await dialog.getByText(/^Total/).boundingBox();
  const box = await dialog.boundingBox();
  await page.screenshot({
    path: file,
    clip: { x: box.x, y: top.y - 16, width: box.width, height: bottom.y + bottom.height + 16 - (top.y - 16) },
  });
}

const rowCodes = () =>
  page.locator('table tbody tr td:first-child').evaluateAll((cells) =>
    cells.map((c) => c.textContent.trim()).filter(Boolean)
  );

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 60000 });

  // ── TSK-850: buscador del plan de cuentas ──
  console.log('TSK-850');
  await goto('/dashboard/company/accounting/accounts', 'Cuentas Contables');
  const before = await rowCodes();
  console.log(`  filas visibles sin buscar: ${before.join(', ')}`);
  check(!before.includes('1.1.1/01/07'), 'sin buscar, la tarjeta está escondida dentro de su sumatoria');
  await page.screenshot({ path: `${OUT}/tsk850-1-sin-buscar.png` });

  const search = page.getByRole('searchbox', { name: 'Buscar cuenta' });
  await search.fill('tarj');
  await page.waitForTimeout(600);
  const tarj = await rowCodes();
  console.log(`  «tarj»: ${tarj.join(', ')}`);
  check(
    JSON.stringify(tarj) === JSON.stringify(['1.0.0/00/00', '1.1.0/00/00', '1.1.1/00/00', '1.1.1/01/00', '1.1.1/01/07']),
    '«tarj» muestra la rama abierta hasta «Tarjeta de crédito empresa»'
  );
  check(await page.getByText('1 cuenta coincide').isVisible(), 'muestra el contador de coincidencias');
  await page.screenshot({ path: `${OUT}/tsk850-2-buscar-tarjeta.png` });

  await search.fill('imp deb');
  await page.waitForTimeout(600);
  const deb = await rowCodes();
  console.log(`  «imp deb»: ${deb.join(', ')}`);
  check(deb.includes('4.2.1/07/06'), '«imp deb» encuentra «Impuesto débitos y créditos bancarios»');
  await page.screenshot({ path: `${OUT}/tsk850-3-buscar-sin-acentos.png` });

  await search.fill('1.1.1/02');
  await page.waitForTimeout(600);
  const byCode = await rowCodes();
  console.log(`  «1.1.1/02»: ${byCode.join(', ')}`);
  check(byCode.length > 0 && byCode.slice(3).every((c) => c.startsWith('1.1.1/02')), 'busca por código');

  await search.fill('xyzinexistente');
  await page.waitForTimeout(600);
  check(await page.getByText('No hay cuentas que coincidan').isVisible(), 'avisa cuando no hay coincidencias');

  await search.press('Escape');
  await page.waitForTimeout(600);
  check(JSON.stringify(await rowCodes()) === JSON.stringify(before), 'Esc limpia y vuelve el árbol como estaba');

  // ── TSK-851: punto del teclado numérico ──
  console.log('TSK-851');
  await goto('/dashboard/commercial/treasury/fund-movements', 'Nuevo Movimiento');
  await page.getByRole('button', { name: 'Nuevo Movimiento' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Tipo de movimiento').waitFor();
  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Gastos e impuestos bancarios' }).click();
  await page.waitForTimeout(800);
  await dialog.getByRole('button', { name: 'Agregar concepto' }).click();
  await page.waitForTimeout(400);
  const amount = dialog.getByPlaceholder('0,00').first();
  await amount.click();
  await page.keyboard.press('2');
  await page.keyboard.press('4');
  await page.keyboard.press('NumpadDecimal');
  await page.keyboard.press('5');
  const value = await amount.inputValue();
  console.log(`  2 4 [Num .] 5 → «${value}»`);
  check(value === '24,5', 'el punto del numérico escribe la coma decimal');
  const totalText = await dialog.getByText(/^Total/).innerText();
  console.log(`  ${totalText}`);
  check(totalText.includes('24,50'), 'el total toma 24,50');
  await shootConcepts(dialog, `${OUT}/tsk851-1-punto-numerico.png`);

  await amount.fill('');
  await amount.pressSequentially('24.000');
  const thousands = await amount.inputValue();
  console.log(`  24.000 con el punto del teclado principal → «${thousands}»`);
  check(thousands === '24.000', 'el punto del teclado principal sigue separando miles');
  await page.keyboard.press('NumpadDecimal');
  await page.keyboard.press('7');
  await page.keyboard.press('5');
  const mixed = await amount.inputValue();
  console.log(`  + [Num .] 7 5 → «${mixed}»`);
  check(mixed === '24.000,75', 'combina miles con la coma del numérico');
  await page.keyboard.press('NumpadDecimal');
  check((await amount.inputValue()) === '24.000,75', 'no agrega una segunda coma');
  await shootConcepts(dialog, `${OUT}/tsk851-2-miles-y-decimales.png`);

  // En el medio: 2450, cursor antes del 0, [Num .] 5 → 245,50 (el cursor queda tras la coma).
  await amount.fill('');
  await amount.pressSequentially('2450');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('NumpadDecimal');
  await page.keyboard.press('5');
  const middle = await amount.inputValue();
  console.log(`  2450, ← , [Num .] 5 → «${middle}»`);
  check(middle === '245,50', 'en el medio del número parte enteros y decimales');
} catch (error) {
  console.error(error);
  failures++;
  await page.screenshot({ path: `${OUT}/tsk850-851-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
