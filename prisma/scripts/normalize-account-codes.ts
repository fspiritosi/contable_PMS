/**
 * Ticket #376 — Fase 1: Normalización de códigos de cuenta al formato `x.x.x/xx/xx`.
 *
 * Script IDEMPOTENTE de datos: recorre todas las cuentas agrupadas por empresa,
 * calcula el código normalizado con `validateAccountCodeFormat` (misma lógica que
 * usará el form y el import en runtime) y actualiza el `code` solo si cambia.
 *
 * Manejo de colisiones con el unique (company_id, code):
 *   - Si el código normalizado ya está tomado por OTRA cuenta de la misma empresa
 *     (ya sea porque ese código ya existe, o porque dos códigos distintos normalizan
 *     al mismo string), NO se reescribe ese registro: se LOGUEA el conflicto y se deja
 *     el código original intacto (sigue siendo válido por unicidad) para resolución manual.
 *   - El script NO aborta ante colisiones; procesa el resto y reporta el resumen.
 *
 * Códigos que ya están en formato canónico o que fallan la validación (segmentos no
 * numéricos, primer segmento 0) se saltan y se reportan; el script no destruye datos.
 *
 * === Cómo correrlo ===
 *   Aplicar PRIMERO la migración 20260701120000_account_disable_by_fiscal_year, luego:
 *
 *     npx tsx prisma/scripts/normalize-account-codes.ts
 *
 *   Es re-ejecutable sin efectos: en una segunda corrida no habrá cambios.
 *   Carga automáticamente las variables de `.env` (DATABASE_URL) vía dotenv.
 */

import 'dotenv/config';
import { prisma } from '../../src/shared/lib/prisma';
import {
  validateAccountCodeFormat,
  AccountCodeFormatError,
} from '../../src/modules/accounting/shared/utils/account-code';

interface NormalizationResult {
  updated: number;
  unchanged: number;
  collisions: Array<{ companyId: string; accountId: string; code: string; normalized: string }>;
  invalid: Array<{ companyId: string; accountId: string; code: string; error: string }>;
}

async function main(): Promise<void> {
  const accounts = await prisma.account.findMany({
    select: { id: true, companyId: true, code: true },
    orderBy: [{ companyId: 'asc' }, { code: 'asc' }],
  });

  // Agrupar por empresa
  const byCompany = new Map<string, Array<{ id: string; code: string }>>();
  for (const acc of accounts) {
    const list = byCompany.get(acc.companyId) ?? [];
    list.push({ id: acc.id, code: acc.code });
    byCompany.set(acc.companyId, list);
  }

  const result: NormalizationResult = {
    updated: 0,
    unchanged: 0,
    collisions: [],
    invalid: [],
  };

  for (const [companyId, companyAccounts] of Array.from(byCompany.entries())) {
    // Conjunto de códigos vigentes de la empresa (para detectar colisiones).
    const takenCodes = new Set(companyAccounts.map((a) => a.code));

    for (const acc of companyAccounts) {
      let normalized: string;
      try {
        normalized = validateAccountCodeFormat(acc.code);
      } catch (error) {
        if (error instanceof AccountCodeFormatError) {
          result.invalid.push({
            companyId,
            accountId: acc.id,
            code: acc.code,
            error: error.message,
          });
          continue;
        }
        throw error;
      }

      // Ya está en formato canónico -> nada que hacer
      if (normalized === acc.code) {
        result.unchanged++;
        continue;
      }

      // ¿El código normalizado ya lo tiene OTRA cuenta de esta empresa?
      if (takenCodes.has(normalized)) {
        result.collisions.push({ companyId, accountId: acc.id, code: acc.code, normalized });
        // eslint-disable-next-line no-console
        console.warn(
          `[COLISIÓN] company=${companyId} account=${acc.id} code="${acc.code}" -> "${normalized}" ya existe. Se deja sin normalizar.`
        );
        continue;
      }

      // Aplicar la normalización y actualizar el conjunto de códigos tomados.
      await prisma.account.update({
        where: { id: acc.id },
        data: { code: normalized },
      });
      takenCodes.delete(acc.code);
      takenCodes.add(normalized);
      result.updated++;
      // eslint-disable-next-line no-console
      console.log(`[OK] company=${companyId} account=${acc.id} "${acc.code}" -> "${normalized}"`);
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n=== Resumen de normalización de códigos ===');
  // eslint-disable-next-line no-console
  console.log(`Actualizadas:      ${result.updated}`);
  // eslint-disable-next-line no-console
  console.log(`Sin cambios:       ${result.unchanged}`);
  // eslint-disable-next-line no-console
  console.log(`Colisiones:        ${result.collisions.length}`);
  // eslint-disable-next-line no-console
  console.log(`Inválidas (skip):  ${result.invalid.length}`);

  if (result.invalid.length > 0) {
    // eslint-disable-next-line no-console
    console.log('\nCódigos inválidos (requieren corrección manual):');
    for (const inv of result.invalid) {
      // eslint-disable-next-line no-console
      console.log(`  - company=${inv.companyId} account=${inv.accountId} code="${inv.code}": ${inv.error}`);
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error('Error ejecutando la normalización:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
