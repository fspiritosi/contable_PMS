/**
 * Convierte una guía de presentación en HTML a PDF.
 *
 * Uso: node scripts/guia-presentacion/generar-pdf.mjs entrada.html salida.pdf
 *
 * Usa Playwright, que ya es dependencia del proyecto. Queda reutilizable para
 * las guías de los próximos tickets: un HTML por ticket, un PDF por ticket.
 *
 * Nota sobre el navegador: intenta primero el Chromium que gestiona Playwright
 * (`npx playwright install chromium`). Si no está disponible —por ejemplo en
 * un sistema operativo demasiado nuevo para el build que Playwright publica—
 * cae automáticamente al Google Chrome del sistema (`channel: 'chrome'`), que
 * Playwright también sabe controlar. Cualquiera de los dos sirve: lo que
 * importa es que sea un navegador propio, no el perfil del usuario.
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [input, output] = process.argv.slice(2);

if (!input || !output) {
  console.error('Uso: node generar-pdf.mjs <entrada.html> <salida.pdf>');
  process.exit(1);
}

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    console.warn(
      'No se pudo lanzar el Chromium de Playwright, se usa Google Chrome del sistema.'
    );
    console.warn(`  (motivo: ${error instanceof Error ? error.message : error})`);
    return chromium.launch({ channel: 'chrome' });
  }
}

const browser = await launchBrowser();
const page = await browser.newPage();

await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: 'networkidle' });
await page.pdf({
  path: resolve(output),
  format: 'A4',
  printBackground: true,
  margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' },
});

await browser.close();
console.log(`PDF generado en ${output}`);
